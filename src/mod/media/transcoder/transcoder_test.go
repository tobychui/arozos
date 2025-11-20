package transcoder

import (
	"testing"
)

func TestTranscodeResolutionConstants(t *testing.T) {
	// Test that constants are defined correctly
	if TranscodeResolution_360p != "360p" {
		t.Error("360p constant mismatch")
	}
	if TranscodeResolution_720p != "720p" {
		t.Error("720p constant mismatch")
	}
}
