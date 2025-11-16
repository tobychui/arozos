package dpcore

import (
	"testing"
)

func TestNewProxyCore(t *testing.T) {
	core := NewProxyCore()
	if core == nil {
		t.Error("Core should not be nil")
	}
}
