package emptyfs

import (
	"testing"
)

func TestNewEmptyFS(t *testing.T) {
	fs := NewEmptyFS()
	if fs == nil {
		t.Error("FS should not be nil")
	}
}
