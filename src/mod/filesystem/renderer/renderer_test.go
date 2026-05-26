package renderer

import (
	"testing"
)

func TestNewRenderer(t *testing.T) {
	opt := RenderOption{
		Color:           "#ff0000",
		BackgroundColor: "#ffffff",
		Width:           100,
		Height:          100,
	}
	r := NewRenderer(opt)
	if r == nil {
		t.Fatal("Expected non-nil Renderer")
	}
	if r.Option.Color != "#ff0000" {
		t.Errorf("Expected Color %q, got %q", "#ff0000", r.Option.Color)
	}
	if r.Option.Width != 100 {
		t.Errorf("Expected Width 100, got %d", r.Option.Width)
	}
}

func TestRenderModel_UnsupportedFormat(t *testing.T) {
	opt := RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           100,
		Height:          100,
	}
	r := NewRenderer(opt)

	// Test with unsupported file format
	_, err := r.RenderModel("test.jpg")
	if err == nil {
		t.Error("Expected error for unsupported file format")
	}
}

func TestRenderModel_NonExistentFile(t *testing.T) {
	opt := RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           100,
		Height:          100,
	}
	r := NewRenderer(opt)

	// Test with non-existent STL file
	_, err := r.RenderModel("nonexistent.stl")
	if err == nil {
		t.Error("Expected error for non-existent file")
	}
}

func TestRenderOption_Defaults(t *testing.T) {
	// Test that zero-value RenderOption can be passed
	opt := RenderOption{}
	r := NewRenderer(opt)
	if r == nil {
		t.Fatal("Expected non-nil Renderer with zero-value option")
	}
	if r.Option.Color != "" {
		t.Errorf("Expected empty Color by default, got %q", r.Option.Color)
	}
}
