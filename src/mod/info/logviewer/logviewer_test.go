package logviewer

import (
	"testing"
)

func TestNewLogViewer(t *testing.T) {
	option := &ViewerOption{
		RootFolder: "/tmp",
		Extension:  ".log",
	}
	viewer := NewLogViewer(option)
	if viewer == nil {
		t.Error("Viewer should not be nil")
	}
}
