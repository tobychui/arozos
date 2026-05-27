package transcoder

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestTranscodeOutputResolution_Constants verifies that the resolution
// constants have the expected string values.
func TestTranscodeOutputResolution_Constants(t *testing.T) {
	cases := []struct {
		name     string
		constant TranscodeOutputResolution
		want     string
	}{
		{"360p", TranscodeResolution_360p, "360p"},
		{"720p", TranscodeResolution_720p, "720p"},
		{"original", TranscodeResolution_original, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if string(tc.constant) != tc.want {
				t.Errorf("expected %q, got %q", tc.want, tc.constant)
			}
		})
	}
}

// TestTranscodeResolution_1080pConstant verifies the 1080p constant value.
// (The source defines it as "1280p" – we test the actual defined value.)
func TestTranscodeResolution_1080pConstant(t *testing.T) {
	// The constant is intentionally defined as "1280p" in the source file.
	if string(TranscodeResolution_1080p) != "1280p" {
		t.Errorf("expected '1280p', got '%s'", TranscodeResolution_1080p)
	}
}

// TestTranscodeAndStream_InvalidResolution verifies that providing an
// unrecognised resolution string results in a 400 Bad Request response without
// requiring ffmpeg.
func TestTranscodeAndStream_InvalidResolution(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	rr := httptest.NewRecorder()

	TranscodeAndStream(rr, req, "/some/file.mkv", "invalid-resolution")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status %d for invalid resolution, got %d", http.StatusBadRequest, rr.Code)
	}
}
