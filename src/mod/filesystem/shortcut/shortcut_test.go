package shortcut

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem/arozfs"
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

func TestReadShortcut_LaunchOptions(t *testing.T) {
	cases := []struct {
		name       string
		content    string
		wantTitle  string
		wantOpenIn string
		wantWidth  int
		wantHeight int
		wantExtra  map[string]string
	}{
		{"no options", "url\nSite\nhttps://a\nicon.png", "", "", 0, 0, nil},
		{"all options", "url\nSite\nhttps://a\nicon.png\ntitle=My Site\nopenin=tab\nwidth=1080\nheight=640", "My Site", "tab", 1080, 640, nil},
		{"case and spaces", "url\nSite\nhttps://a\nicon.png\n TITLE = Hi \nOpenIn=FLOAT", "Hi", "float", 0, 0, nil},
		{"invalid values", "url\nSite\nhttps://a\nicon.png\nopenin=popup\nwidth=abc\nheight=-5", "", "", 0, 0, nil},
		{"clamped size", "url\nSite\nhttps://a\nicon.png\nwidth=10\nheight=99999", "", "", MinWindowSize, MaxWindowSize, nil},
		{"value with equals", "url\nSite\nhttps://a\nicon.png\ntitle=a=b", "a=b", "", 0, 0, nil},
		{"unknown kept", "url\nSite\nhttps://a\nicon.png\nfoo=bar\nnot an option", "", "", 0, 0, map[string]string{"foo": "bar"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := ReadShortcut([]byte(tc.content))
			if err != nil {
				t.Fatalf("ReadShortcut returned unexpected error: %v", err)
			}
			if data.WindowTitle != tc.wantTitle {
				t.Errorf("WindowTitle = %q, want %q", data.WindowTitle, tc.wantTitle)
			}
			if data.OpenIn != tc.wantOpenIn {
				t.Errorf("OpenIn = %q, want %q", data.OpenIn, tc.wantOpenIn)
			}
			if data.WindowWidth != tc.wantWidth || data.WindowHeight != tc.wantHeight {
				t.Errorf("size = %dx%d, want %dx%d", data.WindowWidth, data.WindowHeight, tc.wantWidth, tc.wantHeight)
			}
			if len(data.Extra) != len(tc.wantExtra) {
				t.Fatalf("Extra = %v, want %v", data.Extra, tc.wantExtra)
			}
			for k, v := range tc.wantExtra {
				if data.Extra[k] != v {
					t.Errorf("Extra[%q] = %q, want %q", k, data.Extra[k], v)
				}
			}
		})
	}
}

func TestEncodeShortcut_RoundTrip(t *testing.T) {
	original := &arozfs.ShortcutData{
		Type:         "url",
		Name:         "My\nSite",
		Path:         "https://example.com",
		Icon:         "https://example.com/favicon.ico",
		WindowTitle:  "Example",
		OpenIn:       "tab",
		WindowWidth:  1200,
		WindowHeight: 700,
		Extra:        map[string]string{"zeta": "1", "alpha": "2"},
	}
	encoded := string(EncodeShortcut(original))
	want := "url\nMy Site\nhttps://example.com\nhttps://example.com/favicon.ico\ntitle=Example\nopenin=tab\nwidth=1200\nheight=700\nalpha=2\nzeta=1"
	if encoded != want {
		t.Fatalf("EncodeShortcut =\n%q\nwant\n%q", encoded, want)
	}

	decoded, err := ReadShortcut([]byte(encoded))
	if err != nil {
		t.Fatalf("ReadShortcut returned unexpected error: %v", err)
	}
	if decoded.Name != "My Site" || decoded.WindowTitle != "Example" || decoded.OpenIn != "tab" ||
		decoded.WindowWidth != 1200 || decoded.WindowHeight != 700 || decoded.Extra["alpha"] != "2" {
		t.Errorf("round trip mismatch: %+v", decoded)
	}
}

func TestEncodeShortcut_OmitsDefaults(t *testing.T) {
	data := &arozfs.ShortcutData{Type: "folder", Name: "Docs", Path: "user:/Documents", Icon: "img/system/folder-shortcut.png"}
	got := string(EncodeShortcut(data))
	want := "folder\nDocs\nuser:/Documents\nimg/system/folder-shortcut.png"
	if got != want {
		t.Errorf("EncodeShortcut = %q, want %q", got, want)
	}
}

func TestClearLaunchOptions(t *testing.T) {
	data := &arozfs.ShortcutData{WindowTitle: "a", OpenIn: "tab", WindowWidth: 500, WindowHeight: 400}
	ClearLaunchOptions(data)
	if data.WindowTitle != "" || data.OpenIn != "" || data.WindowWidth != 0 || data.WindowHeight != 0 {
		t.Errorf("ClearLaunchOptions left options behind: %+v", data)
	}
}

func TestIsWebURL(t *testing.T) {
	cases := []struct {
		target string
		want   bool
	}{
		{"https://example.com", true},
		{"http://192.168.1.10:8081/path?q=1", true},
		{"  https://example.com  ", true},
		{"HTTPS://example.com", true},
		{"javascript:alert(1)", false},
		{"ftp://example.com", false},
		{"example.com", false},
		{"https://", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := IsWebURL(tc.target); got != tc.want {
			t.Errorf("IsWebURL(%q) = %v, want %v", tc.target, got, tc.want)
		}
	}
}
