package dynamicproxy

import (
	"testing"
)

func TestNewDynamicProxy(t *testing.T) {
	router, err := NewDynamicProxy(8080)
	if err != nil {
		t.Error("Error creating dynamic proxy:", err)
	}
	if router == nil {
		t.Error("Router should not be nil")
	}
}
