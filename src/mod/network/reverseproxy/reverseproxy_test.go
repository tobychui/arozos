package reverseproxy

import (
	"testing"
)

func TestNewReverseProxyHandler(t *testing.T) {
	handler := NewReverseProxyHandler(nil)
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
