package shortcut

import (
	"strings"
	"testing"
)

func TestReadShortcut_Valid(t *testing.T) {
	content := []byte("link\nMy Shortcut\n/path/to/target\n/path/to/icon.png\n")
	data, err := ReadShortcut(content)
	if err != nil {
		t.Fatalf("ReadShortcut returned unexpected error: %v", err)
	}
	if data == nil {
		t.Fatal("ReadShortcut returned nil data")
	}
	if data.Type != "link" {
		t.Errorf("Type = %q, want %q", data.Type, "link")
	}
	if data.Name != "My Shortcut" {
		t.Errorf("Name = %q, want %q", data.Name, "My Shortcut")
	}
	if data.Path != "/path/to/target" {
		t.Errorf("Path = %q, want %q", data.Path, "/path/to/target")
	}
	if data.Icon != "/path/to/icon.png" {
		t.Errorf("Icon = %q, want %q", data.Icon, "/path/to/icon.png")
	}
}

func TestReadShortcut_ExactlyFourLines(t *testing.T) {
	// Exactly 4 lines (minimum required), no trailing newline
	content := []byte("module\nApp Name\n/apps/myapp\n/img/icon.png")
	data, err := ReadShortcut(content)
	if err != nil {
		t.Fatalf("ReadShortcut returned unexpected error: %v", err)
	}
	if data.Type != "module" {
		t.Errorf("Type = %q, want %q", data.Type, "module")
	}
	if data.Name != "App Name" {
		t.Errorf("Name = %q, want %q", data.Name, "App Name")
	}
	if data.Path != "/apps/myapp" {
		t.Errorf("Path = %q, want %q", data.Path, "/apps/myapp")
	}
	if data.Icon != "/img/icon.png" {
		t.Errorf("Icon = %q, want %q", data.Icon, "/img/icon.png")
	}
}

func TestReadShortcut_CorruptedLessThanFourLines(t *testing.T) {
	cases := []struct {
		name    string
		content []byte
	}{
		{"empty", []byte("")},
		{"one line", []byte("link")},
		{"two lines", []byte("link\nMy Shortcut")},
		{"three lines", []byte("link\nMy Shortcut\n/path/to/target")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := ReadShortcut(tc.content)
			if err == nil {
				t.Errorf("expected error for corrupted shortcut, got nil; data=%v", data)
			}
			if data != nil {
				t.Errorf("expected nil data for corrupted shortcut, got %v", data)
			}
			if !strings.Contains(err.Error(), "Corrupted") {
				t.Errorf("error message = %q, want it to contain 'Corrupted'", err.Error())
			}
		})
	}
}

func TestReadShortcut_WindowsLineEndings(t *testing.T) {
	// Windows-style \r\n line endings should be handled
	content := []byte("link\r\nMy Shortcut\r\n/path/to/target\r\n/path/to/icon.png\r\n")
	data, err := ReadShortcut(content)
	if err != nil {
		t.Fatalf("ReadShortcut returned unexpected error with CRLF: %v", err)
	}
	if data.Type != "link" {
		t.Errorf("Type = %q, want %q", data.Type, "link")
	}
	if data.Name != "My Shortcut" {
		t.Errorf("Name = %q, want %q", data.Name, "My Shortcut")
	}
	if data.Path != "/path/to/target" {
		t.Errorf("Path = %q, want %q", data.Path, "/path/to/target")
	}
	if data.Icon != "/path/to/icon.png" {
		t.Errorf("Icon = %q, want %q", data.Icon, "/path/to/icon.png")
	}
}

func TestReadShortcut_WithLeadingTrailingWhitespace(t *testing.T) {
	// Lines with surrounding whitespace should be trimmed
	content := []byte("  link  \n  My Shortcut  \n  /path/to/target  \n  /path/to/icon.png  \n")
	data, err := ReadShortcut(content)
	if err != nil {
		t.Fatalf("ReadShortcut returned unexpected error: %v", err)
	}
	if data.Type != "link" {
		t.Errorf("Type = %q, want %q (whitespace not trimmed)", data.Type, "link")
	}
}

func TestGenerateShortcutBytes_NonModule(t *testing.T) {
	result := GenerateShortcutBytes("/apps/myapp", "link", "My App", "/img/icon.png")
	content := string(result)
	// Should be: type\nname\ntarget\nicon
	parts := strings.Split(content, "\n")
	if len(parts) != 4 {
		t.Fatalf("expected 4 parts, got %d: %v", len(parts), parts)
	}
	if parts[0] != "link" {
		t.Errorf("parts[0] (type) = %q, want %q", parts[0], "link")
	}
	// Name may have illegal chars filtered; "My App" has none
	if parts[1] != "My App" {
		t.Errorf("parts[1] (name) = %q, want %q", parts[1], "My App")
	}
	if parts[2] != "/apps/myapp" {
		t.Errorf("parts[2] (target) = %q, want %q", parts[2], "/apps/myapp")
	}
	if parts[3] != "/img/icon.png" {
		t.Errorf("parts[3] (icon) = %q, want %q", parts[3], "/img/icon.png")
	}
}

func TestGenerateShortcutBytes_ModuleNoDesktopIcon(t *testing.T) {
	// When shortcutType == "module" but desktop_icon.png doesn't exist, icon should remain unchanged
	result := GenerateShortcutBytes("/apps/myapp", "module", "My Module", "/web/myapp/icon.png")
	content := string(result)
	parts := strings.Split(content, "\n")
	if len(parts) != 4 {
		t.Fatalf("expected 4 parts, got %d: %v", len(parts), parts)
	}
	if parts[0] != "module" {
		t.Errorf("parts[0] (type) = %q, want %q", parts[0], "module")
	}
	// Icon should be the original since no desktop_icon.png exists at that path
	if parts[3] != "/web/myapp/icon.png" {
		t.Errorf("parts[3] (icon) = %q, want %q", parts[3], "/web/myapp/icon.png")
	}
}

func TestGenerateShortcutBytes_FilterIllegalChars(t *testing.T) {
	// Name with illegal characters should be filtered
	result := GenerateShortcutBytes("/apps/myapp", "link", "My:App<Name>", "/img/icon.png")
	content := string(result)
	parts := strings.Split(content, "\n")
	if len(parts) != 4 {
		t.Fatalf("expected 4 parts, got %d: %v", len(parts), parts)
	}
	// Illegal chars (:, <, >) should be replaced with spaces
	if strings.Contains(parts[1], ":") || strings.Contains(parts[1], "<") || strings.Contains(parts[1], ">") {
		t.Errorf("illegal characters not filtered from name: %q", parts[1])
	}
}

func TestGenerateShortcutBytes_RoundTrip(t *testing.T) {
	// Generate a shortcut then read it back to verify consistency
	target := "/apps/testapp"
	shortcutType := "link"
	name := "Test App"
	icon := "/img/test.png"

	generated := GenerateShortcutBytes(target, shortcutType, name, icon)
	data, err := ReadShortcut(generated)
	if err != nil {
		t.Fatalf("ReadShortcut failed on generated shortcut: %v", err)
	}

	if data.Type != shortcutType {
		t.Errorf("Type = %q, want %q", data.Type, shortcutType)
	}
	if data.Name != name {
		t.Errorf("Name = %q, want %q", data.Name, name)
	}
	if data.Path != target {
		t.Errorf("Path = %q, want %q", data.Path, target)
	}
	if data.Icon != icon {
		t.Errorf("Icon = %q, want %q", data.Icon, icon)
	}
}
