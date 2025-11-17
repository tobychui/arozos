package webdav

import (
	"testing"
)

func TestNewServer(t *testing.T) {
	server := NewServer("", "/webdav", "/tmp", false, nil)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
