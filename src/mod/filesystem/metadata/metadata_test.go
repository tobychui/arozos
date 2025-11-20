package metadata

import (
	"testing"
)

func TestNewRenderHandler(t *testing.T) {
	handler := NewRenderHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
