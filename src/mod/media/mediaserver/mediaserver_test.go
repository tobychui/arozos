package mediaserver

import (
	"testing"
)

func TestNewMediaServer(t *testing.T) {
	server := NewMediaServer(nil, "", 0)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
