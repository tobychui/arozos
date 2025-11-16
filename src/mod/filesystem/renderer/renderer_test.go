package renderer

import (
	"testing"
)

func TestNewRenderer(t *testing.T) {
	renderer := NewRenderer()
	if renderer == nil {
		t.Error("Renderer should not be nil")
	}
}
