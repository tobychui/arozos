package transcoder

import (
	"strings"
	"testing"
)

// TestParseMediaCodecs_DirectPlayable covers the files that should stream
// straight to the browser with no transcode.
func TestParseMediaCodecs_DirectPlayable(t *testing.T) {
	cases := []struct {
		name  string
		probe string
	}{
		{"h264 + aac mp4", `{"streams":[
			{"codec_type":"video","codec_name":"h264","profile":"High","pix_fmt":"yuv420p","width":1920,"height":1080},
			{"codec_type":"audio","codec_name":"aac"}]}`},
		{"vp9 + opus webm", `{"streams":[
			{"codec_type":"video","codec_name":"vp9","pix_fmt":"yuv420p"},
			{"codec_type":"audio","codec_name":"opus"}]}`},
		{"av1 + flac", `{"streams":[
			{"codec_type":"video","codec_name":"av1","pix_fmt":"yuv420p"},
			{"codec_type":"audio","codec_name":"flac"}]}`},
		{"video with no audio track", `{"streams":[
			{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p"}]}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := parseMediaCodecs([]byte(tc.probe))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !info.DirectPlay {
				t.Errorf("expected direct play, got false (reason: %s)", info.Reason)
			}
		})
	}
}

// TestParseMediaCodecs_RequiresTranscode covers what must not be handed to the
// browser directly. The HEVC case is the one that produced the original bug
// report: an .mp4 the player direct-played and Firefox could not decode.
func TestParseMediaCodecs_RequiresTranscode(t *testing.T) {
	cases := []struct {
		name       string
		probe      string
		wantReason string
	}{
		{
			name: "hevc 10-bit in mp4",
			probe: `{"streams":[
				{"codec_type":"video","codec_name":"hevc","profile":"Main 10","pix_fmt":"yuv420p10le"},
				{"codec_type":"audio","codec_name":"aac"}]}`,
			wantReason: "hevc",
		},
		{
			name: "hevc 8-bit",
			probe: `{"streams":[
				{"codec_type":"video","codec_name":"hevc","profile":"Main","pix_fmt":"yuv420p"},
				{"codec_type":"audio","codec_name":"aac"}]}`,
			wantReason: "hevc",
		},
		{
			name: "10-bit h264",
			probe: `{"streams":[
				{"codec_type":"video","codec_name":"h264","profile":"High 10","pix_fmt":"yuv420p10le"},
				{"codec_type":"audio","codec_name":"aac"}]}`,
			wantReason: "10-bit",
		},
		{
			name: "unsupported audio codec",
			probe: `{"streams":[
				{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p"},
				{"codec_type":"audio","codec_name":"ac3"}]}`,
			wantReason: "ac3",
		},
		{
			name:       "no video stream at all",
			probe:      `{"streams":[{"codec_type":"audio","codec_name":"aac"}]}`,
			wantReason: "no video stream",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := parseMediaCodecs([]byte(tc.probe))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if info.DirectPlay {
				t.Error("expected a transcode to be required, got direct play")
			}
			if !strings.Contains(info.Reason, tc.wantReason) {
				t.Errorf("reason %q does not mention %q", info.Reason, tc.wantReason)
			}
		})
	}
}

// TestParseMediaCodecs_SkipsCoverArt verifies an attached cover image is not
// mistaken for the video track, which would report the file as an mjpeg still.
func TestParseMediaCodecs_SkipsCoverArt(t *testing.T) {
	info, err := parseMediaCodecs([]byte(`{"streams":[
		{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},
		{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p","width":1280,"height":720},
		{"codec_type":"audio","codec_name":"aac"}]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.VideoCodec != "h264" {
		t.Errorf("expected the real video track, got %q", info.VideoCodec)
	}
	if info.Width != 1280 || info.Height != 720 {
		t.Errorf("expected 1280x720, got %dx%d", info.Width, info.Height)
	}
	if !info.DirectPlay {
		t.Errorf("expected direct play, got false (reason: %s)", info.Reason)
	}
}

// TestParseMediaCodecs_FirstStreamWins verifies only the primary tracks are
// considered when a file carries several.
func TestParseMediaCodecs_FirstStreamWins(t *testing.T) {
	info, err := parseMediaCodecs([]byte(`{"streams":[
		{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p"},
		{"codec_type":"video","codec_name":"hevc","pix_fmt":"yuv420p10le"},
		{"codec_type":"audio","codec_name":"aac"},
		{"codec_type":"audio","codec_name":"ac3"}]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.VideoCodec != "h264" || info.AudioCodec != "aac" {
		t.Errorf("expected the first streams, got %s / %s", info.VideoCodec, info.AudioCodec)
	}
	if !info.DirectPlay {
		t.Errorf("expected direct play, got false (reason: %s)", info.Reason)
	}
}

// TestParseMediaCodecs_CaseInsensitive verifies codec names are normalised, as
// ffprobe output casing is not guaranteed.
func TestParseMediaCodecs_CaseInsensitive(t *testing.T) {
	info, err := parseMediaCodecs([]byte(`{"streams":[
		{"codec_type":"VIDEO","codec_name":"H264","pix_fmt":"yuv420p"},
		{"codec_type":"Audio","codec_name":"AAC"}]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !info.DirectPlay {
		t.Errorf("expected direct play, got false (reason: %s)", info.Reason)
	}
}

// TestParseMediaCodecs_InvalidJSON verifies malformed probe output is an error
// rather than a silent "not playable".
func TestParseMediaCodecs_InvalidJSON(t *testing.T) {
	if _, err := parseMediaCodecs([]byte("not json")); err == nil {
		t.Error("expected an error for malformed ffprobe output, got nil")
	}
}

// TestIsHighBitDepth covers the pixel formats that rule out direct H.264 play.
func TestIsHighBitDepth(t *testing.T) {
	cases := []struct {
		pixFmt string
		want   bool
	}{
		{"yuv420p", false},
		{"yuvj420p", false},
		{"nv12", false},
		{"", false},
		{"yuv420p10le", true},
		{"yuv422p10le", true},
		{"yuv420p12le", true},
		{"p010le", true},
		{"YUV420P10LE", true}, // casing is not guaranteed
	}

	for _, tc := range cases {
		t.Run(tc.pixFmt, func(t *testing.T) {
			if got := isHighBitDepth(tc.pixFmt); got != tc.want {
				t.Errorf("isHighBitDepth(%q) = %v, want %v", tc.pixFmt, got, tc.want)
			}
		})
	}
}
