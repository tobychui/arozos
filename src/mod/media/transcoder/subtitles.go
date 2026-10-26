package transcoder

/*
	Subtitles.go

	Discovery and extraction of subtitle tracks and font attachments that are
	muxed inside a container (typically MKV).

	Text tracks are converted to SubRip on the way out so the player has a single
	format to parse. Note that converting ASS/SSA discards styling, positioning
	and karaoke timing — only the dialogue text and its timings survive. Font
	attachments are exposed separately so the player can still render that text in
	the typeface the release intended.
*/

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	// Probing and extraction are bounded so a damaged container cannot hang a
	// request forever.
	subtitleProbeTimeout   = 30 * time.Second
	subtitleExtractTimeout = 5 * time.Minute
	// Guards against a malicious or broken file advertising an enormous track.
	maxSubtitleBytes = 32 << 20 // 32 MiB
	maxFontBytes     = 32 << 20 // 32 MiB
)

// EmbeddedSubtitle describes one subtitle track found inside a container.
type EmbeddedSubtitle struct {
	Index    int    `json:"index"`    // absolute stream index, used for -map
	Codec    string `json:"codec"`    // subrip, ass, hdmv_pgs_subtitle, …
	Language string `json:"language"` // ISO code from the container, may be empty
	Title    string `json:"title"`    // human label from the container, may be empty
	Default  bool   `json:"default"`
	Forced   bool   `json:"forced"`
	Textual  bool   `json:"textual"` // false for bitmap tracks, which cannot be converted
}

// EmbeddedFont describes one font attachment found inside a container.
type EmbeddedFont struct {
	Index    int    `json:"index"`    // ordinal among attachment streams, used for -dump_attachment
	Filename string `json:"filename"` // original name, e.g. "FOT-Pearl Std L.ttf"
	Mimetype string `json:"mimetype"` // font/ttf, application/x-truetype-font, …
	Family   string `json:"family"`   // internal family name from the font's name table
}

// MediaSubtitleInfo is the full picture of what a container carries.
type MediaSubtitleInfo struct {
	Subtitles []EmbeddedSubtitle `json:"subtitles"`
	Fonts     []EmbeddedFont     `json:"fonts"`
}

// textualSubtitleCodecs are the codecs ffmpeg can turn into SubRip. Everything
// else (PGS, VobSub, …) is a bitmap format that would need OCR.
var textualSubtitleCodecs = map[string]bool{
	"subrip":   true,
	"srt":      true,
	"ass":      true,
	"ssa":      true,
	"webvtt":   true,
	"mov_text": true,
	"text":     true,
	"microdvd": true,
}

// fontMimeHints are the attachment mimetypes that identify a font.
var fontMimeHints = []string{"font", "truetype", "opentype", "sfnt"}

// fontFileExtensions are the fallback signal when a container omits a mimetype.
var fontFileExtensions = map[string]bool{
	".ttf": true, ".otf": true, ".ttc": true, ".woff": true, ".woff2": true,
}

// IsTextualSubtitleCodec reports whether a subtitle codec carries text that can
// be converted to SubRip, as opposed to a bitmap format needing OCR.
func IsTextualSubtitleCodec(codec string) bool {
	return textualSubtitleCodecs[strings.ToLower(strings.TrimSpace(codec))]
}

// IsFontAttachment reports whether an attachment stream looks like a font,
// judged by mimetype first and filename extension second.
func IsFontAttachment(mimetype string, filename string) bool {
	lowerMime := strings.ToLower(mimetype)
	for _, hint := range fontMimeHints {
		if strings.Contains(lowerMime, hint) {
			return true
		}
	}
	return fontFileExtensions[strings.ToLower(filepath.Ext(filename))]
}

// ffprobeStream is the subset of ffprobe's stream output we care about.
type ffprobeStream struct {
	Index       int               `json:"index"`
	CodecName   string            `json:"codec_name"`
	CodecType   string            `json:"codec_type"`
	Tags        map[string]string `json:"tags"`
	Disposition map[string]int    `json:"disposition"`
}

// tag reads a container tag case-insensitively, since muxers disagree on case.
func (s *ffprobeStream) tag(name string) string {
	for k, v := range s.Tags {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}

// ProbeEmbeddedTracksWithFontNames lists embedded tracks and additionally reads
// each font attachment's internal family name.
//
// ASS styles reference fonts by that internal name, so the player cannot match
// a style to an attachment without it. Every attachment is dumped in a single
// ffmpeg call, which costs about the same as dumping one (measured at ~65ms for
// 14 fonts) because attachments are written while the input is opened.
//
// Name resolution is best effort: a font that cannot be parsed simply keeps an
// empty Family and the caller falls back to the filename.
func ProbeEmbeddedTracksWithFontNames(inputFile string, workDir string) (*MediaSubtitleInfo, error) {
	info, err := ProbeEmbeddedTracks(inputFile)
	if err != nil {
		return nil, err
	}
	if len(info.Fonts) == 0 {
		return info, nil
	}

	fonts, err := extractAllFontAttachments(inputFile, info.Fonts, workDir)
	if err != nil {
		return info, nil // listing is still useful without family names
	}
	for i := range info.Fonts {
		data, ok := fonts[info.Fonts[i].Index]
		if !ok {
			continue
		}
		if family, err := FontFamilyName(data); err == nil {
			info.Fonts[i].Family = family
		}
	}
	return info, nil
}

// extractAllFontAttachments dumps every listed attachment in one ffmpeg pass and
// returns the bytes keyed by attachment ordinal.
func extractAllFontAttachments(inputFile string, fonts []EmbeddedFont, workDir string) (map[int][]byte, error) {
	if strings.TrimSpace(workDir) == "" {
		workDir = os.TempDir()
	}
	scratchDir, err := os.MkdirTemp(workDir, "subfonts-")
	if err != nil {
		return nil, fmt.Errorf("scratch directory unavailable: %w", err)
	}
	defer os.RemoveAll(scratchDir)

	args := []string{"-y", "-v", "error"}
	paths := map[int]string{}
	for _, font := range fonts {
		path := filepath.Join(scratchDir, fmt.Sprintf("%d.bin", font.Index))
		paths[font.Index] = path
		args = append(args, fmt.Sprintf("-dump_attachment:t:%d", font.Index), path)
	}
	// As in ExtractFontAttachment, no output is given on purpose: the dump
	// completes while the input is opened, and adding one would make ffmpeg
	// process the entire video first.
	args = append(args, "-i", inputFile)

	ctx, cancel := context.WithTimeout(context.Background(), subtitleExtractTimeout)
	defer cancel()
	exec.CommandContext(ctx, "ffmpeg", args...).Run() // exit status is not the signal

	out := map[int][]byte{}
	for index, path := range paths {
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 && len(data) <= maxFontBytes {
			out[index] = data
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no attachments could be read")
	}
	return out, nil
}

// ExtractRawSubtitleTrack copies a subtitle track out in its native format,
// preserving ASS styling, positioning and layering.
//
// This is a stream copy rather than a re-encode, so it is dramatically cheaper
// than converting to SubRip — measured at 0.24s versus 5.3s on a 614MB file.
func ExtractRawSubtitleTrack(inputFile string, streamIndex int, format string) ([]byte, error) {
	if streamIndex < 0 {
		return nil, errors.New("invalid subtitle stream index")
	}
	if format != "ass" && format != "srt" && format != "webvtt" {
		return nil, errors.New("unsupported raw subtitle format")
	}

	ctx, cancel := context.WithTimeout(context.Background(), subtitleExtractTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-v", "error",
		"-i", inputFile,
		"-map", fmt.Sprintf("0:%d", streamIndex),
		"-vn", "-an",
		"-c:s", "copy",
		"-f", format,
		"pipe:1",
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, errors.New("subtitle extraction timed out")
		}
		return nil, fmt.Errorf("ffmpeg failed: %w (%s)", err, lastLines(stderr.String(), 2))
	}
	if stdout.Len() == 0 {
		return nil, errors.New("subtitle track is empty")
	}
	if stdout.Len() > maxSubtitleBytes {
		return nil, errors.New("subtitle track is unexpectedly large")
	}
	return stdout.Bytes(), nil
}

// ProbeEmbeddedTracks lists the subtitle tracks and font attachments inside a
// container. A file with neither returns empty slices rather than an error.
func ProbeEmbeddedTracks(inputFile string) (*MediaSubtitleInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), subtitleProbeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		inputFile,
	)
	output, err := cmd.Output()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, errors.New("subtitle probe timed out")
		}
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	return parseEmbeddedTracks(output)
}

// parseEmbeddedTracks turns ffprobe JSON into the track listing. Split out from
// the exec call so the mapping rules can be unit-tested without ffmpeg.
func parseEmbeddedTracks(probeJSON []byte) (*MediaSubtitleInfo, error) {
	var parsed struct {
		Streams []ffprobeStream `json:"streams"`
	}
	if err := json.Unmarshal(probeJSON, &parsed); err != nil {
		return nil, fmt.Errorf("could not parse ffprobe output: %w", err)
	}

	info := &MediaSubtitleInfo{
		Subtitles: []EmbeddedSubtitle{},
		Fonts:     []EmbeddedFont{},
	}

	attachmentOrdinal := 0
	for i := range parsed.Streams {
		stream := &parsed.Streams[i]
		switch strings.ToLower(stream.CodecType) {
		case "subtitle":
			info.Subtitles = append(info.Subtitles, EmbeddedSubtitle{
				Index:    stream.Index,
				Codec:    stream.CodecName,
				Language: stream.tag("language"),
				Title:    stream.tag("title"),
				Default:  stream.Disposition["default"] == 1,
				Forced:   stream.Disposition["forced"] == 1,
				Textual:  IsTextualSubtitleCodec(stream.CodecName),
			})
		case "attachment":
			filename := stream.tag("filename")
			mimetype := stream.tag("mimetype")
			// The ordinal counts every attachment, font or not, because that is
			// what ffmpeg's -dump_attachment:t:<n> specifier indexes on.
			current := attachmentOrdinal
			attachmentOrdinal++
			if !IsFontAttachment(mimetype, filename) {
				continue
			}
			info.Fonts = append(info.Fonts, EmbeddedFont{
				Index:    current,
				Filename: filename,
				Mimetype: mimetype,
			})
		}
	}

	return info, nil
}

// ExtractSubtitleTrack pulls one subtitle track out of a container and returns
// it as SubRip text.
//
// streamIndex is the absolute stream index reported by ProbeEmbeddedTracks. The
// conversion flattens ASS/SSA styling to plain text; callers wanting full
// styling would need to extract the native format and render it with libass.
func ExtractSubtitleTrack(inputFile string, streamIndex int) ([]byte, error) {
	if streamIndex < 0 {
		return nil, errors.New("invalid subtitle stream index")
	}

	ctx, cancel := context.WithTimeout(context.Background(), subtitleExtractTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-v", "error",
		"-i", inputFile,
		"-map", fmt.Sprintf("0:%d", streamIndex),
		"-vn", "-an", // subtitle stream only
		"-c:s", "srt",
		"-f", "srt",
		"pipe:1",
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, errors.New("subtitle extraction timed out")
		}
		return nil, fmt.Errorf("ffmpeg failed: %w (%s)", err, lastLines(stderr.String(), 2))
	}

	if stdout.Len() == 0 {
		return nil, errors.New("subtitle track is empty")
	}
	if stdout.Len() > maxSubtitleBytes {
		return nil, errors.New("subtitle track is unexpectedly large")
	}
	return stdout.Bytes(), nil
}

// ExtractFontAttachment pulls one font attachment out of a container.
//
// fontIndex is the attachment ordinal reported by ProbeEmbeddedTracks. ffmpeg
// can only dump attachments to a real path, so this renders into scratch space
// under workDir and returns the bytes for the caller to serve or store.
func ExtractFontAttachment(inputFile string, fontIndex int, workDir string) ([]byte, error) {
	if fontIndex < 0 {
		return nil, errors.New("invalid font attachment index")
	}

	if strings.TrimSpace(workDir) == "" {
		workDir = os.TempDir()
	}
	if err := os.MkdirAll(workDir, 0775); err != nil {
		return nil, fmt.Errorf("scratch directory unavailable: %w", err)
	}

	scratch, err := os.CreateTemp(workDir, "subfont-*.bin")
	if err != nil {
		return nil, fmt.Errorf("could not create scratch file: %w", err)
	}
	scratchPath := scratch.Name()
	scratch.Close()
	defer os.Remove(scratchPath)

	ctx, cancel := context.WithTimeout(context.Background(), subtitleExtractTimeout)
	defer cancel()

	// -dump_attachment is an input option, so it has to precede -i.
	//
	// No output is specified on purpose. Attachments are written while ffmpeg
	// opens the input, so the dump is already complete by the time it complains
	// that no output file was given and exits non-zero. Adding "-f null -" to
	// silence that error would make ffmpeg process every video and audio packet
	// in the container first: measured at 74s versus 0.06s on a 614MB HEVC file.
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y",
		"-v", "error",
		fmt.Sprintf("-dump_attachment:t:%d", fontIndex), scratchPath,
		"-i", inputFile,
	)

	// Hence the written file, not the exit status, is the success signal.
	out, runErr := cmd.CombinedOutput()

	data, err := os.ReadFile(scratchPath)
	if err != nil || len(data) == 0 {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, errors.New("font extraction timed out")
		}
		if runErr != nil {
			return nil, fmt.Errorf("ffmpeg failed: %w (%s)", runErr, lastLines(string(out), 2))
		}
		return nil, errors.New("font attachment is empty")
	}
	if len(data) > maxFontBytes {
		return nil, errors.New("font attachment is unexpectedly large")
	}
	return data, nil
}
