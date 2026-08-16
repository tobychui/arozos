package transcoder

import (
	"os"
	"testing"
)

// readDirNames lists the plain file names in a directory, used to assert that
// scratch files are cleaned up.
func readDirNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names, nil
}

// TestIsTextualSubtitleCodec verifies text formats are accepted for SubRip
// conversion while bitmap formats, which would need OCR, are rejected.
func TestIsTextualSubtitleCodec(t *testing.T) {
	cases := []struct {
		codec string
		want  bool
	}{
		{"subrip", true},
		{"ass", true},
		{"ssa", true},
		{"webvtt", true},
		{"mov_text", true},
		{"ASS", true},        // muxers disagree on case
		{"  subrip  ", true}, // and on padding
		{"hdmv_pgs_subtitle", false},
		{"dvd_subtitle", false},
		{"dvb_subtitle", false},
		{"xsub", false},
		{"", false},
	}

	for _, tc := range cases {
		t.Run(tc.codec, func(t *testing.T) {
			if got := IsTextualSubtitleCodec(tc.codec); got != tc.want {
				t.Errorf("codec %q: expected %v, got %v", tc.codec, tc.want, got)
			}
		})
	}
}

// TestIsFontAttachment verifies fonts are detected by mimetype, falling back to
// the filename extension when a container omits the mimetype.
func TestIsFontAttachment(t *testing.T) {
	cases := []struct {
		name     string
		mimetype string
		filename string
		want     bool
	}{
		{"ttf mimetype", "font/ttf", "A.ttf", true},
		{"legacy truetype mimetype", "application/x-truetype-font", "B.ttf", true},
		{"opentype mimetype", "application/vnd.ms-opentype", "C.otf", true},
		{"sfnt mimetype", "application/font-sfnt", "D.ttf", true},
		{"extension only", "", "FOT-Pearl Std L.ttf", true},
		{"otf extension only", "", "汉仪旗黑.otf", true},
		{"uppercase extension", "", "FONT.TTF", true},
		{"cover image", "image/jpeg", "cover.jpg", false},
		{"unknown binary", "application/octet-stream", "notes.txt", false},
		{"nothing to go on", "", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsFontAttachment(tc.mimetype, tc.filename); got != tc.want {
				t.Errorf("expected %v, got %v", tc.want, got)
			}
		})
	}
}

// TestParseEmbeddedTracks maps a realistic ffprobe payload — modelled on a
// fansubbed MKV with two subtitle tracks, a cover image and font attachments.
func TestParseEmbeddedTracks(t *testing.T) {
	probe := []byte(`{"streams":[
		{"index":0,"codec_name":"hevc","codec_type":"video"},
		{"index":1,"codec_name":"aac","codec_type":"audio","tags":{"language":"jpn"}},
		{"index":2,"codec_name":"ass","codec_type":"subtitle",
		 "tags":{"language":"chi","title":"cht&jpn[XKsub]"},
		 "disposition":{"default":1,"forced":0}},
		{"index":3,"codec_name":"hdmv_pgs_subtitle","codec_type":"subtitle",
		 "tags":{"language":"eng"},"disposition":{"default":0,"forced":1}},
		{"index":4,"codec_name":"mjpeg","codec_type":"attachment",
		 "tags":{"filename":"cover.jpg","mimetype":"image/jpeg"}},
		{"index":5,"codec_name":"ttf","codec_type":"attachment",
		 "tags":{"filename":"FOT-Pearl Std L.ttf","mimetype":"font/ttf"}},
		{"index":6,"codec_name":"ttf","codec_type":"attachment",
		 "tags":{"filename":"HYZhengYuan-55S.ttf","mimetype":"font/ttf"}}
	]}`)

	info, err := parseEmbeddedTracks(probe)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(info.Subtitles) != 2 {
		t.Fatalf("expected 2 subtitle tracks, got %d", len(info.Subtitles))
	}

	ass := info.Subtitles[0]
	if ass.Index != 2 || ass.Codec != "ass" || ass.Language != "chi" {
		t.Errorf("unexpected first track: %+v", ass)
	}
	if ass.Title != "cht&jpn[XKsub]" {
		t.Errorf("expected the container title to survive, got %q", ass.Title)
	}
	if !ass.Default || ass.Forced || !ass.Textual {
		t.Errorf("expected a default, non-forced, textual track: %+v", ass)
	}

	pgs := info.Subtitles[1]
	if pgs.Textual {
		t.Error("a PGS bitmap track must not be reported as textual")
	}
	if !pgs.Forced {
		t.Error("expected the forced disposition to be carried through")
	}

	// The cover image must be skipped, but it still consumes an attachment
	// ordinal — ffmpeg's -dump_attachment:t:<n> counts every attachment.
	if len(info.Fonts) != 2 {
		t.Fatalf("expected 2 fonts, got %d", len(info.Fonts))
	}
	if info.Fonts[0].Index != 1 || info.Fonts[0].Filename != "FOT-Pearl Std L.ttf" {
		t.Errorf("unexpected first font: %+v", info.Fonts[0])
	}
	if info.Fonts[1].Index != 2 {
		t.Errorf("expected the second font at attachment ordinal 2, got %d", info.Fonts[1].Index)
	}
}

// TestParseEmbeddedTracks_NoTracks verifies a plain file yields empty slices
// rather than an error or nil, so the JSON response stays well formed.
func TestParseEmbeddedTracks_NoTracks(t *testing.T) {
	info, err := parseEmbeddedTracks([]byte(`{"streams":[
		{"index":0,"codec_name":"h264","codec_type":"video"},
		{"index":1,"codec_name":"aac","codec_type":"audio"}
	]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.Subtitles == nil || len(info.Subtitles) != 0 {
		t.Errorf("expected an empty subtitle slice, got %#v", info.Subtitles)
	}
	if info.Fonts == nil || len(info.Fonts) != 0 {
		t.Errorf("expected an empty font slice, got %#v", info.Fonts)
	}
}

// TestParseEmbeddedTracks_CaseInsensitiveTags verifies tag lookup tolerates the
// casing differences between muxers.
func TestParseEmbeddedTracks_CaseInsensitiveTags(t *testing.T) {
	info, err := parseEmbeddedTracks([]byte(`{"streams":[
		{"index":0,"codec_name":"subrip","codec_type":"subtitle",
		 "tags":{"LANGUAGE":"eng","Title":"English"}},
		{"index":1,"codec_name":"ttf","codec_type":"attachment",
		 "tags":{"FileName":"X.ttf","MIMEType":"font/ttf"}}
	]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(info.Subtitles) != 1 || info.Subtitles[0].Language != "eng" || info.Subtitles[0].Title != "English" {
		t.Errorf("expected case-insensitive subtitle tags, got %+v", info.Subtitles)
	}
	if len(info.Fonts) != 1 || info.Fonts[0].Filename != "X.ttf" {
		t.Errorf("expected case-insensitive attachment tags, got %+v", info.Fonts)
	}
}

// TestParseEmbeddedTracks_MissingDisposition verifies streams without a
// disposition block do not panic and default to false.
func TestParseEmbeddedTracks_MissingDisposition(t *testing.T) {
	info, err := parseEmbeddedTracks([]byte(`{"streams":[
		{"index":0,"codec_name":"subrip","codec_type":"subtitle"}
	]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(info.Subtitles) != 1 {
		t.Fatalf("expected 1 subtitle track, got %d", len(info.Subtitles))
	}
	if info.Subtitles[0].Default || info.Subtitles[0].Forced {
		t.Error("expected dispositions to default to false")
	}
}

// TestParseEmbeddedTracks_InvalidJSON verifies malformed probe output surfaces
// as an error rather than an empty listing.
func TestParseEmbeddedTracks_InvalidJSON(t *testing.T) {
	if _, err := parseEmbeddedTracks([]byte(`not json`)); err == nil {
		t.Error("expected an error for malformed ffprobe output, got nil")
	}
}

// TestExtractSubtitleTrack_NegativeIndex verifies the guard runs before ffmpeg
// is invoked, so the call is safe on hosts without it.
func TestExtractSubtitleTrack_NegativeIndex(t *testing.T) {
	if _, err := ExtractSubtitleTrack("nonexistent.mkv", -1); err == nil {
		t.Error("expected an error for a negative stream index, got nil")
	}
}

// TestExtractFontAttachment_NegativeIndex verifies the same guard for fonts.
func TestExtractFontAttachment_NegativeIndex(t *testing.T) {
	if _, err := ExtractFontAttachment("nonexistent.mkv", -1, t.TempDir()); err == nil {
		t.Error("expected an error for a negative attachment index, got nil")
	}
}

// TestExtractFontAttachment_LeavesNoScratchFiles verifies the scratch file used
// to bridge ffmpeg's native-only dump is cleaned up even when extraction fails.
func TestExtractFontAttachment_LeavesNoScratchFiles(t *testing.T) {
	workDir := t.TempDir()

	if _, err := ExtractFontAttachment("nonexistent.mkv", 0, workDir); err == nil {
		t.Skip("ffmpeg unexpectedly succeeded on a missing input")
	}

	entries, err := readDirNames(workDir)
	if err != nil {
		t.Fatalf("could not inspect scratch dir: %v", err)
	}
	for _, name := range entries {
		t.Errorf("scratch file %q was left behind", name)
	}
}
