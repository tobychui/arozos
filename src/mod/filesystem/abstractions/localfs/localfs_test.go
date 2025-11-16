package localfs

import (
	"testing"
)

func TestNewLocalFileSystemHandler(t *testing.T) {
	handler := NewLocalFileSystemHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
