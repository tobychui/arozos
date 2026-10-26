package tftp

import (
	"testing"
)

// TestHandlerFields verifies the Handler struct fields without requiring a live
// user handler or network socket.
func TestHandlerFields(t *testing.T) {
	h := &Handler{
		ServerName:    "test-tftp",
		Port:          69,
		ServerRunning: false,
		userHandler:   nil,
		server:        nil,
		cancelFunc:    nil,
	}

	if h.ServerName != "test-tftp" {
		t.Errorf("expected ServerName='test-tftp', got %q", h.ServerName)
	}
	if h.Port != 69 {
		t.Errorf("expected Port=69, got %d", h.Port)
	}
	if h.ServerRunning {
		t.Error("expected ServerRunning=false initially")
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

// TestMaxFileSizeConstant verifies the constant is defined at the expected value.
func TestMaxFileSizeConstant(t *testing.T) {
	expected := int64(32 * 1024 * 1024)
	if MAX_FILE_SIZE != expected {
		t.Errorf("MAX_FILE_SIZE: expected %d, got %d", expected, MAX_FILE_SIZE)
	}
}
