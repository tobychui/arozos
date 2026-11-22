package utils

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsActiveUserContent(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"evil.html", true},
		{"EVIL.HTM", true},
		{"page.xhtml", true},
		{"drawing.svg", true},
		{"feed.xml", true},
		{"style.xsl", true},
		{"no_extension", true},
		{"data.unknownext123", true},
		{"photo.png", false},
		{"photo.JPG", false},
		{"clip.mp4", false},
		{"song.mp3", false},
		{"report.pdf", false},
		{"notes.txt", false},
		{"style.css", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsActiveUserContent(tt.name); got != tt.want {
				t.Errorf("IsActiveUserContent(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

// What a browser gets for a user file served the way /media serves it
func serveUserFile(t *testing.T, name string, content string) *http.Response {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media?file=user:/"+name, nil)
	SetUserContentHeaders(rec, name)
	http.ServeFile(rec, req, path)
	return rec.Result()
}

func TestSetUserContentHeaders(t *testing.T) {
	script := "<!DOCTYPE html><html><script>fetch('/system/users/list')</script></html>"
	tests := []struct {
		name        string
		file        string
		content     string
		wantSandbox bool
		wantType    string // prefix of the Content-Type, "" to skip
	}{
		{"html page", "evil.html", script, true, "text/html"},
		{"svg with script", "evil.svg", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`, true, "image/svg+xml"},
		{"html without extension", "evil", script, true, ""},
		{"html named as an unknown type", "evil.aopart", script, true, ""},
		{"html named as a png", "evil.png", script, false, "image/png"},
		{"html named as text", "evil.txt", script, false, "text/plain"},
		{"real picture", "photo.jpg", "\xff\xd8\xff\xe0", false, "image/jpeg"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := serveUserFile(t, tt.file, tt.content)
			csp := res.Header.Get("Content-Security-Policy")
			if tt.wantSandbox {
				if !strings.HasPrefix(csp, "sandbox") || strings.Contains(csp, "allow-same-origin") {
					t.Errorf("Content-Security-Policy = %q, want a sandbox without allow-same-origin", csp)
				}
				if res.Header.Get("X-Content-Type-Options") != "nosniff" {
					t.Error("nosniff is missing")
				}
			} else if csp != "" {
				t.Errorf("Content-Security-Policy = %q, want none", csp)
			}
			if tt.wantType != "" && !strings.HasPrefix(res.Header.Get("Content-Type"), tt.wantType) {
				t.Errorf("Content-Type = %q, want %s", res.Header.Get("Content-Type"), tt.wantType)
			}
			if strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") && !tt.wantSandbox {
				t.Error("an HTML page went out without the sandbox")
			}
		})
	}
}

func TestSetUserContentHeadersKeepsAGivenType(t *testing.T) {
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "image/jpeg")
	SetUserContentHeaders(rec, "photo.arw")
	if got := rec.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("Content-Type = %q, want the one already set", got)
	}
}
