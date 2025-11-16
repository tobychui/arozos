package websocket

import (
	"testing"
)

func TestNewWebSocketHandler(t *testing.T) {
	handler := NewWebSocketHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
