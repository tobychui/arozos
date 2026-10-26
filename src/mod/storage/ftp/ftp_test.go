package ftp

import (
	"testing"
)

// TestHandlerFields verifies the Handler struct fields are accessible and
// correctly typed without requiring a live user handler or network socket.
func TestHandlerFields(t *testing.T) {
	h := &Handler{
		ServerName:    "test-ftp",
		Port:          21,
		ServerRunning: false,
		UPNPEnabled:   false,
		userHandler:   nil,
		server:        nil,
	}

	if h.ServerName != "test-ftp" {
		t.Errorf("expected ServerName='test-ftp', got %q", h.ServerName)
	}
	if h.Port != 21 {
		t.Errorf("expected Port=21, got %d", h.Port)
	}
	if h.ServerRunning {
		t.Error("expected ServerRunning=false initially")
	}
	if h.UPNPEnabled {
		t.Error("expected UPNPEnabled=false initially")
	}
}

// TestHandlerClose_NilServer ensures Close does not panic when server is nil.
func TestHandlerClose_NilServer(t *testing.T) {
	h := &Handler{
		server: nil,
	}
	// Should be a no-op without panicking
	h.Close()
}

// TestHandlerStart_NilServer ensures Start returns an error when server is nil.
func TestHandlerStart_NilServer(t *testing.T) {
	h := &Handler{
		server: nil,
	}
	err := h.Start()
	if err == nil {
		t.Error("expected error when starting with nil server")
	}
}
