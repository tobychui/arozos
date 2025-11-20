package mediaserver

import (
	"testing"
)

func TestNewMediaServer(t *testing.T) {
	server := NewMediaServer(nil)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
