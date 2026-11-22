package share

import (
	"mime"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// A share link is opened on this site by anyone, often while signed in: a
// shared file that could be a page must come back sandboxed
func TestSetPreviewContentType(t *testing.T) {
	tests := []struct {
		file        string
		wantSandbox bool
		wantType    string
	}{
		{"index.html", true, "text/html"},
		{"logo.svg", true, "image/svg+xml"},
		{"README", true, ""},
		{"photo.png", false, "image/png"},
		{"report.pdf", false, "application/pdf"},
	}
	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			rec := httptest.NewRecorder()
			setPreviewContentType(rec, mime.TypeByExtension(filepath.Ext(tt.file)), "/data/"+tt.file)
			csp := rec.Header().Get("Content-Security-Policy")
			if tt.wantSandbox != strings.HasPrefix(csp, "sandbox") {
				t.Errorf("Content-Security-Policy = %q, want sandbox %v", csp, tt.wantSandbox)
			}
			if strings.Contains(csp, "allow-same-origin") {
				t.Errorf("the sandbox keeps the site's origin: %q", csp)
			}
			if tt.wantType != "" && !strings.HasPrefix(rec.Header().Get("Content-Type"), tt.wantType) {
				t.Errorf("Content-Type = %q, want %s", rec.Header().Get("Content-Type"), tt.wantType)
			}
			if tt.wantType == "" && rec.Header().Get("Content-Type") != "" {
				t.Errorf("Content-Type = %q set for a file of unknown type", rec.Header().Get("Content-Type"))
			}
		})
	}
}
