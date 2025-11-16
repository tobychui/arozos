package transcoder

import (
	"testing"
)

func TestNewTranscoder(t *testing.T) {
	transcoder := NewTranscoder("")
	if transcoder == nil {
		t.Error("Transcoder should not be nil")
	}
}
