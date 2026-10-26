package wallpaper

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// buildWallpaperRoot creates a wallpaper root holding the given theme folders
// and the files inside each of them
func buildWallpaperRoot(t *testing.T, themes map[string][]string) string {
	t.Helper()
	wallpaperRoot := t.TempDir()
	for themeName, files := range themes {
		themeFolder := filepath.Join(wallpaperRoot, themeName)
		if err := os.MkdirAll(themeFolder, 0755); err != nil {
			t.Fatalf("unable to create theme folder %s: %v", themeName, err)
		}
		for _, file := range files {
			if err := os.WriteFile(filepath.Join(themeFolder, file), []byte("x"), 0644); err != nil {
				t.Fatalf("unable to create wallpaper %s: %v", file, err)
			}
		}
	}
	return wallpaperRoot
}

func TestIsSupportedWallpaper(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     bool
	}{
		{"jpg", "bg.jpg", true},
		{"png", "bg.png", true},
		{"gif", "bg.gif", true},
		{"uppercase extension", "BG.PNG", true},
		{"mixed case extension", "bg.JpG", true},
		{"unsupported format", "bg.bmp", false},
		{"webp is not accepted", "bg.webp", false},
		{"no extension", "bg", false},
		{"extension only", ".png", true},
		{"empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsSupportedWallpaper(tt.filename); got != tt.want {
				t.Errorf("IsSupportedWallpaper(%q) = %v, want %v", tt.filename, got, tt.want)
			}
		})
	}
}

func TestListThemes(t *testing.T) {
	wallpaperRoot := buildWallpaperRoot(t, map[string][]string{
		"default": {"bg1.jpg", "bg2.png", "notes.txt"},
		"winxp":   {"bliss.jpg"},
		"empty":   {},
	})
	//A loose file at the root is not a theme and must be ignored
	if err := os.WriteFile(filepath.Join(wallpaperRoot, "readme.md"), []byte("x"), 0644); err != nil {
		t.Fatalf("unable to create loose file: %v", err)
	}

	themes, err := ListThemes(wallpaperRoot)
	if err != nil {
		t.Fatalf("ListThemes() returned error: %v", err)
	}

	want := []Theme{
		{Theme: "default", Bglist: []string{"bg1.jpg", "bg2.png"}},
		{Theme: "empty", Bglist: nil},
		{Theme: "winxp", Bglist: []string{"bliss.jpg"}},
	}
	if !reflect.DeepEqual(themes, want) {
		t.Errorf("ListThemes() = %+v, want %+v", themes, want)
	}
}

func TestListThemesEmptyRoot(t *testing.T) {
	themes, err := ListThemes(t.TempDir())
	if err != nil {
		t.Fatalf("ListThemes() returned error: %v", err)
	}
	if len(themes) != 0 {
		t.Errorf("ListThemes() = %+v, want an empty list", themes)
	}
}

func TestListThemesMissingRoot(t *testing.T) {
	if _, err := ListThemes(filepath.Join(t.TempDir(), "does-not-exist")); err == nil {
		t.Error("ListThemes() = nil error for a missing root, want an error")
	}
}
