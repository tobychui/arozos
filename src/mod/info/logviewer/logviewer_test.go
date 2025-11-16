package logviewer

import (
	"testing"
)

func TestNewLogViewer(t *testing.T) {
	viewer := NewLogViewer("")
	if viewer == nil {
		t.Error("Viewer should not be nil")
	}
}
