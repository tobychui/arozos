package icons

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// writeTestPNG writes a solid square PNG of the given size and color
func writeTestPNG(t *testing.T, hostPath string, size int, fill color.NRGBA) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(hostPath), 0755); err != nil {
		t.Fatalf("unable to create folder for %s: %v", hostPath, err)
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, solidIcon(size, fill)); err != nil {
		t.Fatalf("unable to encode test PNG: %v", err)
	}
	if err := os.WriteFile(hostPath, encoded.Bytes(), 0644); err != nil {
		t.Fatalf("unable to write test PNG: %v", err)
	}
}

func TestResolveWebAssetPath(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		expectErr bool
	}{
		{"plain path", "Photo/img/module_icon.png", "Photo/img/module_icon.png", false},
		{"windows separator", "Photo\\img\\module_icon.png", "Photo/img/module_icon.png", false},
		{"redundant segments", "Photo/./img//module_icon.png", "Photo/img/module_icon.png", false},
		{"leading traversal", "../../etc/passwd", "etc/passwd", false},
		{"embedded traversal", "Photo/img/../../Music/img/icon.png", "Music/img/icon.png", false},
		{"leading slash", "/Photo/img/icon.png", "Photo/img/icon.png", false},
		{"double leading slash", "//Photo/img/icon.png", "Photo/img/icon.png", false},
		{"empty", "", "", true},
		{"whitespace only", "   ", "", true},
		{"root only", "/", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveWebAssetPath(tt.input)
			if tt.expectErr {
				if err == nil {
					t.Fatalf("ResolveWebAssetPath(%q) = %q, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveWebAssetPath(%q) returned unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("ResolveWebAssetPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestEnsureDesktopIconGeneratesMissingIcon(t *testing.T) {
	webRoot := t.TempDir()
	writeTestPNG(t, filepath.Join(webRoot, "Photo", "img", "module_icon.png"), 64, color.NRGBA{R: 20, G: 20, B: 20, A: 255})

	generator := NewGenerator(webRoot)
	iconPath, generated, err := generator.EnsureDesktopIcon("Photo/img/module_icon.png")
	if err != nil {
		t.Fatalf("EnsureDesktopIcon() returned error: %v", err)
	}
	if !generated {
		t.Error("EnsureDesktopIcon() reported generated = false on first call, want true")
	}
	if iconPath != "Photo/img/desktop_icon.png" {
		t.Errorf("EnsureDesktopIcon() = %q, want %q", iconPath, "Photo/img/desktop_icon.png")
	}

	writtenIcon, err := os.Open(filepath.Join(webRoot, "Photo", "img", "desktop_icon.png"))
	if err != nil {
		t.Fatalf("generated desktop icon was not written: %v", err)
	}
	defer writtenIcon.Close()

	decodedIcon, format, err := image.Decode(writtenIcon)
	if err != nil {
		t.Fatalf("generated desktop icon could not be decoded: %v", err)
	}
	if format != "png" {
		t.Errorf("generated desktop icon format = %q, want png", format)
	}
	if decodedIcon.Bounds().Dx() != DefaultIconSize || decodedIcon.Bounds().Dy() != DefaultIconSize {
		t.Errorf("generated desktop icon size = %dx%d, want %dx%d",
			decodedIcon.Bounds().Dx(), decodedIcon.Bounds().Dy(), DefaultIconSize, DefaultIconSize)
	}
}

func TestEnsureDesktopIconKeepsExistingIcon(t *testing.T) {
	webRoot := t.TempDir()
	writeTestPNG(t, filepath.Join(webRoot, "Photo", "img", "module_icon.png"), 64, color.NRGBA{R: 20, G: 20, B: 20, A: 255})

	//A hand drawn desktop icon that must never be overwritten
	desktopIconHostPath := filepath.Join(webRoot, "Photo", "img", "desktop_icon.png")
	writeTestPNG(t, desktopIconHostPath, 16, color.NRGBA{R: 1, G: 2, B: 3, A: 255})
	originalContent, err := os.ReadFile(desktopIconHostPath)
	if err != nil {
		t.Fatalf("unable to read the pre-existing desktop icon: %v", err)
	}

	generator := NewGenerator(webRoot)
	iconPath, generated, err := generator.EnsureDesktopIcon("Photo/img/module_icon.png")
	if err != nil {
		t.Fatalf("EnsureDesktopIcon() returned error: %v", err)
	}
	if generated {
		t.Error("EnsureDesktopIcon() reported generated = true, want false for an existing icon")
	}
	if iconPath != "Photo/img/desktop_icon.png" {
		t.Errorf("EnsureDesktopIcon() = %q, want %q", iconPath, "Photo/img/desktop_icon.png")
	}

	currentContent, err := os.ReadFile(desktopIconHostPath)
	if err != nil {
		t.Fatalf("unable to re-read the desktop icon: %v", err)
	}
	if !bytes.Equal(originalContent, currentContent) {
		t.Error("the pre-existing desktop icon was overwritten, want it left untouched")
	}
}

func TestEnsureDesktopIconErrors(t *testing.T) {
	webRoot := t.TempDir()
	writeTestPNG(t, filepath.Join(webRoot, "Photo", "img", "module_icon.png"), 64, color.NRGBA{A: 255})
	if err := os.MkdirAll(filepath.Join(webRoot, "Broken", "img"), 0755); err != nil {
		t.Fatalf("unable to create test folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(webRoot, "Broken", "img", "module_icon.png"), []byte("not an image"), 0644); err != nil {
		t.Fatalf("unable to write corrupted test icon: %v", err)
	}

	tests := []struct {
		name  string
		input string
	}{
		{"missing module icon", "Missing/img/module_icon.png"},
		{"corrupted module icon", "Broken/img/module_icon.png"},
		{"cannot generate from itself", "Missing/img/desktop_icon.png"},
		{"empty path", ""},
	}

	generator := NewGenerator(webRoot)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, generated, err := generator.EnsureDesktopIcon(tt.input)
			if err == nil {
				t.Errorf("EnsureDesktopIcon(%q) = nil error, want an error", tt.input)
			}
			if generated {
				t.Errorf("EnsureDesktopIcon(%q) reported generated = true on failure", tt.input)
			}
		})
	}
}

func TestEnsureDesktopIconDoesNotEscapeWebRoot(t *testing.T) {
	parentDir := t.TempDir()
	webRoot := filepath.Join(parentDir, "web")
	writeTestPNG(t, filepath.Join(webRoot, "Photo", "img", "module_icon.png"), 64, color.NRGBA{A: 255})

	generator := NewGenerator(webRoot)
	//The traversal is collapsed, so this resolves inside the web root and the
	//lookup fails rather than reaching into the parent folder
	iconPath, _, err := generator.EnsureDesktopIcon("../../Photo/img/module_icon.png")
	if err != nil {
		t.Fatalf("EnsureDesktopIcon() returned error: %v", err)
	}
	if iconPath != "Photo/img/desktop_icon.png" {
		t.Errorf("EnsureDesktopIcon() = %q, want the traversal collapsed to %q", iconPath, "Photo/img/desktop_icon.png")
	}
	if _, err := os.Stat(filepath.Join(parentDir, "Photo")); err == nil {
		t.Error("an icon was written outside the web root")
	}
}

func TestGeneratorLoadWebImage(t *testing.T) {
	webRoot := t.TempDir()
	writeTestPNG(t, filepath.Join(webRoot, "Photo", "img", "module_icon.png"), 40, color.NRGBA{R: 10, G: 200, B: 30, A: 255})
	if err := os.MkdirAll(filepath.Join(webRoot, "Vector", "img"), 0755); err != nil {
		t.Fatalf("unable to create test folder: %v", err)
	}
	svgSource := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
		<rect x="0" y="0" width="32" height="32" fill="#ff0000"/>
	</svg>`)
	if err := os.WriteFile(filepath.Join(webRoot, "Vector", "img", "icon.svg"), svgSource, 0644); err != nil {
		t.Fatalf("unable to write test SVG: %v", err)
	}

	generator := NewGenerator(webRoot)

	tests := []struct {
		name      string
		input     string
		wantSize  int
		expectErr bool
	}{
		{"png is decoded at its native size", "Photo/img/module_icon.png", 40, false},
		{"svg is rasterized at the render size", "Vector/img/icon.svg", DefaultSVGRenderSize, false},
		{"missing file errors", "Photo/img/nope.png", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			loaded, err := generator.LoadWebImage(tt.input)
			if tt.expectErr {
				if err == nil {
					t.Fatalf("LoadWebImage(%q) = nil error, want an error", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadWebImage(%q) returned error: %v", tt.input, err)
			}
			if loaded.Bounds().Dx() != tt.wantSize {
				t.Errorf("LoadWebImage(%q) width = %d, want %d", tt.input, loaded.Bounds().Dx(), tt.wantSize)
			}
		})
	}
}

func TestOptionsWithDefaults(t *testing.T) {
	defaults := DefaultOptions()

	tests := []struct {
		name  string
		input Options
		want  Options
	}{
		{"empty options fall back entirely", Options{}, defaults},
		{
			"set fields are kept",
			Options{SquircleFactor: 0.5, IconSize: 256},
			Options{
				SquircleFactor: 0.5,
				IconSize:       256,
				BackplateRatio: defaults.BackplateRatio,
				ContentRatio:   defaults.ContentRatio,
				SampleSteps:    defaults.SampleSteps,
				LumaThreshold:  defaults.LumaThreshold,
				SVGRenderSize:  defaults.SVGRenderSize,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.input.withDefaults(); got != tt.want {
				t.Errorf("withDefaults() = %+v, want %+v", got, tt.want)
			}
		})
	}

	//The generator must expose the filled in options, not the raw ones
	generator := NewGeneratorWithOptions(t.TempDir(), Options{IconSize: 64})
	if generator.Options().SquircleFactor != defaults.SquircleFactor {
		t.Errorf("generator SquircleFactor = %v, want the default %v",
			generator.Options().SquircleFactor, defaults.SquircleFactor)
	}
	if generator.Options().IconSize != 64 {
		t.Errorf("generator IconSize = %v, want the overridden 64", generator.Options().IconSize)
	}
}
