package samba

import (
	"testing"
)

func TestNewSambaServer(t *testing.T) {
	server := NewSambaServer(nil, "")
	if server == nil {
		t.Error("Server should not be nil")
	}
}
