package dynamicproxy

import (
	"testing"
)

func TestNewDynamicProxyHandler(t *testing.T) {
	handler := NewDynamicProxyHandler(nil, nil)
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
