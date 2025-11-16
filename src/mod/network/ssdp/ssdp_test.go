package ssdp

import (
	"testing"
)

func TestNewSSDPHandler(t *testing.T) {
	handler := NewSSDPHandler("")
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
