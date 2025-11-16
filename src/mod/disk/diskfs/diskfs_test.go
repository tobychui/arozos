package diskfs

import (
	"testing"
)

func TestNewDiskFsHandler(t *testing.T) {
	handler := NewDiskFsHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
