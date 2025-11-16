package localversion

import (
	"testing"
)

func TestNewVersionHandler(t *testing.T) {
	handler := NewVersionHandler("")
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
