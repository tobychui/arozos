package metadata

import (
	"testing"
)

func TestNewMetadataHandler(t *testing.T) {
	handler := NewMetadataHandler(nil)
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
