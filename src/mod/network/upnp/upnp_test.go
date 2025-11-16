package upnp

import (
	"testing"
)

func TestNewUPnPHandler(t *testing.T) {
	handler := NewUPnPHandler()
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
