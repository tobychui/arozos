package renderer

import (
	"os"
	"path/filepath"
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

func TestRenderModel_ObjUnsupportedFormat(t *testing.T) {
	opt := RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           100,
		Height:          100,
	}
	r := NewRenderer(opt)

	// Test with unsupported extension (not .stl or .obj)
	_, err := r.RenderModel("model.3ds")
	if err == nil {
		t.Error("Expected error for unsupported .3ds format")
	}
	if err != nil && err.Error() != "Not supported model format" {
		t.Errorf("Expected 'Not supported model format', got %q", err.Error())
	}
}

func TestRenderModel_NonExistentObjFile(t *testing.T) {
	opt := RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           100,
		Height:          100,
	}
	r := NewRenderer(opt)

	// Test with non-existent .obj file
	_, err := r.RenderModel("nonexistent.obj")
	if err == nil {
		t.Error("Expected error for non-existent .obj file")
	}
}

func TestFileExists_ExistingFile(t *testing.T) {
	// Create a temp file and verify fileExists returns true
	f, err := os.CreateTemp("", "renderer_test_*.txt")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	f.Close()
	defer os.Remove(f.Name())

	if !fileExists(f.Name()) {
		t.Errorf("Expected fileExists(%q) to return true", f.Name())
	}
}

func TestFileExists_NonExistentFile(t *testing.T) {
	if fileExists("/nonexistent/path/file.txt") {
		t.Error("Expected fileExists to return false for non-existent file")
	}
}

func TestFileExists_Directory(t *testing.T) {
	dir := t.TempDir()
	// A directory should return false (fileExists checks !info.IsDir())
	if fileExists(dir) {
		t.Errorf("Expected fileExists(%q) to return false for a directory", dir)
	}
}

// minimalSTLContent is a valid ASCII STL file with one triangle.
const minimalSTLContent = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test
`

// minimalOBJContent is a valid OBJ file with one triangle.
const minimalOBJContent = `v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`

func newTestRenderer() *Renderer {
	return NewRenderer(RenderOption{
		Color:           "#42f5b3",
		BackgroundColor: "#e0e0e0",
		Width:           50,
		Height:          50,
	})
}

// TestRenderModel_ValidSTL exercises the full STL rendering pipeline.
func TestRenderModel_ValidSTL(t *testing.T) {
	dir := t.TempDir()
	stlPath := filepath.Join(dir, "test.stl")
	if err := os.WriteFile(stlPath, []byte(minimalSTLContent), 0644); err != nil {
		t.Fatalf("failed to write STL file: %v", err)
	}

	r := newTestRenderer()
	img, err := r.RenderModel(stlPath)
	if err != nil {
		t.Fatalf("RenderModel(%q) returned error: %v", stlPath, err)
	}
	if img == nil {
		t.Fatal("RenderModel returned nil image")
	}
	bounds := img.Bounds()
	if bounds.Dx() == 0 || bounds.Dy() == 0 {
		t.Errorf("expected non-zero image dimensions, got %v", bounds)
	}
}

// TestRenderModel_ValidSTL_CaseInsensitive verifies uppercase extension is accepted.
func TestRenderModel_ValidSTL_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()
	stlPath := filepath.Join(dir, "test.STL")
	if err := os.WriteFile(stlPath, []byte(minimalSTLContent), 0644); err != nil {
		t.Fatalf("failed to write STL file: %v", err)
	}

	r := newTestRenderer()
	img, err := r.RenderModel(stlPath)
	if err != nil {
		t.Fatalf("RenderModel(%q) returned error: %v", stlPath, err)
	}
	if img == nil {
		t.Fatal("RenderModel returned nil image")
	}
}

// TestRenderModel_ValidOBJ exercises the full OBJ rendering pipeline.
func TestRenderModel_ValidOBJ(t *testing.T) {
	dir := t.TempDir()
	objPath := filepath.Join(dir, "test.obj")
	if err := os.WriteFile(objPath, []byte(minimalOBJContent), 0644); err != nil {
		t.Fatalf("failed to write OBJ file: %v", err)
	}

	r := newTestRenderer()
	img, err := r.RenderModel(objPath)
	if err != nil {
		t.Fatalf("RenderModel(%q) returned error: %v", objPath, err)
	}
	if img == nil {
		t.Fatal("RenderModel returned nil image")
	}
	bounds := img.Bounds()
	if bounds.Dx() == 0 || bounds.Dy() == 0 {
		t.Errorf("expected non-zero image dimensions, got %v", bounds)
	}
}

// TestRenderModel_ValidOBJ_CaseInsensitive verifies uppercase extension is accepted.
func TestRenderModel_ValidOBJ_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()
	objPath := filepath.Join(dir, "test.OBJ")
	if err := os.WriteFile(objPath, []byte(minimalOBJContent), 0644); err != nil {
		t.Fatalf("failed to write OBJ file: %v", err)
	}

	r := newTestRenderer()
	img, err := r.RenderModel(objPath)
	if err != nil {
		t.Fatalf("RenderModel(%q) returned error: %v", objPath, err)
	}
	if img == nil {
		t.Fatal("RenderModel returned nil image")
	}
}
