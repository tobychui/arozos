package share

import (
	"testing"
)

func TestNewShareManager(t *testing.T) {
	handler := NewShareManager(nil, nil, "", "")
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
