package share

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/utils"
)

// writeSharedFile writes content with the given modification time and returns
// the ETag that version should be served with.
func writeSharedFile(t *testing.T, path string, content string, mod time.Time) string {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return utils.FileETag(info)
}

// TestSetShareRevalidation verifies a local file gets an ETag, while a file
// system that needs buffering is spared the remote stat but still forces the
// browser to check.
func TestSetShareRevalidation(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a.pdf")
	tag := writeSharedFile(t, path, "aaaa", time.Date(2026, 11, 7, 14, 48, 1, 0, time.UTC))
	abstraction := localfs.NewLocalFileSystemAbstraction("t", root, "user", false)

	cases := []struct {
		name     string
		fsh      *filesystem.FileSystemHandler
		path     string
		wantETag string
	}{
		{"local file", &filesystem.FileSystemHandler{FileSystemAbstraction: abstraction}, path, tag},
		{"file that cannot be stat", &filesystem.FileSystemHandler{FileSystemAbstraction: abstraction}, filepath.Join(root, "missing.pdf"), ""},
		{"buffered file system", &filesystem.FileSystemHandler{FileSystemAbstraction: abstraction, RequireBuffer: true}, path, ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			setShareRevalidation(w, c.fsh, c.path)
			if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
				t.Errorf("Cache-Control = %q", got)
			}
			if got := w.Header().Get("ETag"); got != c.wantETag {
				t.Errorf("ETag = %q, want %q", got, c.wantETag)
			}
		})
	}
}

// TestServePreviewRevalidation runs a shared file through the real preview
// handler: unchanged it costs a 304 that keeps the headers cross-origin readers
// depend on, overwritten under the same name it is sent again, and a range asked
// for against the old version is never cut out of the new one.
func TestServePreviewRevalidation(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a.pdf")
	mod := time.Date(2026, 11, 7, 14, 48, 1, 0, time.UTC)
	oldTag := writeSharedFile(t, path, "old content", mod)

	fsh := &filesystem.FileSystemHandler{FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("t", root, "user", false)}
	manager := &Manager{}
	preview := func(headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/share/preview/id", nil)
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		manager.servePreview(w, r, fsh, path)
		return w
	}

	unchanged := preview(map[string]string{"If-None-Match": oldTag})
	if unchanged.Code != http.StatusNotModified {
		t.Fatalf("unchanged file: status %d, want 304", unchanged.Code)
	}
	if got := unchanged.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("304 lost Access-Control-Allow-Origin: %q", got)
	}

	newTag := writeSharedFile(t, path, "the new longer content", mod.Add(time.Minute))

	cases := []struct {
		name     string
		headers  map[string]string
		wantCode int
		wantBody string
	}{
		{"revalidation sees the overwrite", map[string]string{"If-None-Match": oldTag}, http.StatusOK, "the new longer content"},
		{"range of the old version falls back to the whole file", map[string]string{"Range": "bytes=0-2", "If-Range": oldTag}, http.StatusOK, "the new longer content"},
		{"range of the current version", map[string]string{"Range": "bytes=0-2", "If-Range": newTag}, http.StatusPartialContent, "the"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := preview(c.headers)
			if w.Code != c.wantCode {
				t.Fatalf("status %d, want %d", w.Code, c.wantCode)
			}
			if got := w.Body.String(); got != c.wantBody {
				t.Errorf("body %q, want %q", got, c.wantBody)
			}
			if got := w.Header().Get("ETag"); got != newTag {
				t.Errorf("ETag %q, want %q", got, newTag)
			}
		})
	}
}
