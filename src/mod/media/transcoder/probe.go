package transcoder

/*
	Probe.go

	Reports what codecs a media file actually contains.

	A container extension says nothing about decodability: an .mp4 may hold
	HEVC, AV1 or 10-bit H.264, none of which most browsers can decode. Choosing
	direct playback from the extension alone is what makes such a file fail with
	a bare decode error instead of being transcoded. This lets the caller ask
	first.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const codecProbeTimeout = 30 * time.Second

// MediaCodecInfo describes the primary video and audio streams of a file.
type MediaCodecInfo struct {
	VideoCodec   string `json:"videoCodec"`   // h264, hevc, vp9, av1, …
	VideoProfile string `json:"videoProfile"` // "High", "Main 10", …
	PixelFormat  string `json:"pixelFormat"`  // yuv420p, yuv420p10le, …
	AudioCodec   string `json:"audioCodec"`   // aac, opus, ac3, …
	Width        int    `json:"width"`
	Height       int    `json:"height"`

	// DirectPlay is the server's verdict on whether a mainstream browser can
	// decode this without transcoding. The client still has the final say via
	// canPlayType, but this catches the common cases up front.
	DirectPlay bool `json:"directPlay"`
	// Reason explains a false verdict, for logs and diagnostics.
	Reason string `json:"reason,omitempty"`
}

// browserVideoCodecs are the video codecs a current mainstream browser can be
// expected to decode. HEVC is deliberately absent: Safari plays it, but Firefox
// has no support at all and Chrome's is platform-dependent, so treating it as
// playable is what produced decode failures.
var browserVideoCodecs = map[string]bool{
	"h264": true,
	"vp8":  true,
	"vp9":  true,
	"av1":  true,
}

// browserAudioCodecs are the audio codecs safe to hand a browser directly.
var browserAudioCodecs = map[string]bool{
	"aac": true, "mp3": true, "opus": true, "vorbis": true, "flac": true,
	"": true, // a file with no audio track is fine
}

// tenBitPixelFormats are the high-depth formats browsers generally refuse for
// H.264. Even where the codec is supported, 10-bit H.264 (High 10) is not.
func isHighBitDepth(pixFmt string) bool {
	f := strings.ToLower(pixFmt)
	return strings.Contains(f, "10le") || strings.Contains(f, "10be") ||
		strings.Contains(f, "12le") || strings.Contains(f, "12be") ||
		strings.Contains(f, "p010") || strings.Contains(f, "16le")
}

// ProbeMediaCodecs inspects a file and reports its primary streams.
func ProbeMediaCodecs(inputFile string) (*MediaCodecInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), codecProbeTimeout)
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
			return nil, errors.New("codec probe timed out")
		}
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}
	return parseMediaCodecs(output)
}

// parseMediaCodecs maps ffprobe output onto a playability verdict. Separated
// from the exec call so the rules can be unit-tested without ffmpeg present.
func parseMediaCodecs(probeJSON []byte) (*MediaCodecInfo, error) {
	var parsed struct {
		Streams []struct {
			CodecName string `json:"codec_name"`
			CodecType string `json:"codec_type"`
			Profile   string `json:"profile"`
			PixFmt    string `json:"pix_fmt"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			// An attached cover image is a video stream by codec_type; its
			// disposition is what tells it apart from the real picture.
			Disposition map[string]int `json:"disposition"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(probeJSON, &parsed); err != nil {
		return nil, fmt.Errorf("could not parse ffprobe output: %w", err)
	}

	info := &MediaCodecInfo{}
	haveVideo := false
	haveAudio := false

	for i := range parsed.Streams {
		s := &parsed.Streams[i]
		switch strings.ToLower(s.CodecType) {
		case "video":
			// Skip embedded cover art, which would otherwise be mistaken for
			// the video track and reported as an mjpeg still.
			if s.Disposition["attached_pic"] == 1 {
				continue
			}
			if haveVideo {
				continue
			}
			haveVideo = true
			info.VideoCodec = strings.ToLower(s.CodecName)
			info.VideoProfile = s.Profile
			info.PixelFormat = s.PixFmt
			info.Width = s.Width
			info.Height = s.Height
		case "audio":
			if haveAudio {
				continue
			}
			haveAudio = true
			info.AudioCodec = strings.ToLower(s.CodecName)
		}
	}

	if !haveVideo {
		info.DirectPlay = false
		info.Reason = "no video stream"
		return info, nil
	}

	switch {
	case !browserVideoCodecs[info.VideoCodec]:
		info.Reason = "video codec " + info.VideoCodec + " is not broadly supported by browsers"
	case info.VideoCodec == "h264" && isHighBitDepth(info.PixelFormat):
		info.Reason = "10-bit H.264 is not decodable in most browsers"
	case !browserAudioCodecs[info.AudioCodec]:
		info.Reason = "audio codec " + info.AudioCodec + " is not broadly supported by browsers"
	default:
		info.DirectPlay = true
	}

	return info, nil
}
