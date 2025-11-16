package renderer

import (
	"testing"
)

func TestNewRenderer(t *testing.T) {
	option := RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           1000,
		Height:          1000,
	}
	renderer := NewRenderer(option)
	if renderer == nil {
		t.Error("Renderer should not be nil")
	}
}
