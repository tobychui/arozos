package sortfile

import (
	"testing"
)

func TestNewLargeFileScanner(t *testing.T) {
	scanner := NewLargeFileScanner(nil)
	if scanner == nil {
		t.Error("Scanner should not be nil")
	}
}
