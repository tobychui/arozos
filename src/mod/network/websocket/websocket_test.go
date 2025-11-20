package websocket

import (
	"testing"
)

func TestNewRouter(t *testing.T) {
	router := NewRouter()
	if router == nil {
		t.Error("Router should not be nil")
	}
}
