package gzipmiddleware

import (
	"testing"
)

func TestNewGzipHandler(t *testing.T) {
	handler := NewGzipHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
