package utils

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// statFile writes content to a file with the given modification time and
// returns its info.
func statFile(t *testing.T, path string, content string, mod time.Time) os.FileInfo {
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
	return info
}

// TestFileETag verifies that the tag changes with either the time or the size,
// including two saves inside the same second, which Last-Modified cannot tell
// apart.
func TestFileETag(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.pdf")
	base := time.Date(2026, 11, 7, 14, 48, 1, 0, time.UTC)

	cases := []struct {
		name    string
		content string
		mod     time.Time
		same    bool
	}{
		{"unchanged file", "aaaa", base, true},
		{"different size", "aaaaa", base, false},
		{"same size, later second", "aaaa", base.Add(time.Second), false},
		{"same size, same second", "aaaa", base.Add(500 * time.Millisecond), false},
	}

	want := FileETag(statFile(t, path, "aaaa", base))
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := FileETag(statFile(t, path, c.content, c.mod))
			if (got == want) != c.same {
				t.Errorf("etag %s against %s, want same=%v", got, want, c.same)
			}
		})
	}
}

// TestSetRevalidationHeaders verifies the check is always forced, and that an
// ETag is only sent when there is a usable file version to build it from.
func TestSetRevalidationHeaders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.pdf")
	info := statFile(t, path, "aaaa", time.Date(2026, 11, 7, 14, 48, 1, 0, time.UTC))

	cases := []struct {
		name     string
		info     os.FileInfo
		wantETag string
	}{
		{"local file", info, FileETag(info)},
		{"no file info", nil, ""},
		{"no modification time", zeroTimeInfo{info}, ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			SetRevalidationHeaders(w, c.info)
			if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
				t.Errorf("Cache-Control = %q", got)
			}
			if got := w.Header().Get("ETag"); got != c.wantETag {
				t.Errorf("ETag = %q, want %q", got, c.wantETag)
			}
		})
	}
}

type zeroTimeInfo struct{ os.FileInfo }

func (zeroTimeInfo) ModTime() time.Time { return time.Time{} }

// TestRevalidationOverServeFile runs the headers through http.ServeFile, which
// is how a local file is sent: an unchanged file costs a 304, a file
// overwritten under the same name is sent in full, and a range asked for
// against the old version is never cut out of the new one.
func TestRevalidationOverServeFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.pdf")
	mod := time.Date(2026, 11, 7, 14, 48, 1, 0, time.UTC)
	oldTag := FileETag(statFile(t, path, "old content", mod))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		SetRevalidationHeaders(w, info)
		http.ServeFile(w, r, path)
	})
	request := func(headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/media/?file=a.pdf", nil)
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}

	if got := request(map[string]string{"If-None-Match": oldTag}).Code; got != http.StatusNotModified {
		t.Fatalf("unchanged file: status %d, want 304", got)
	}

	statFile(t, path, "the new longer content", mod.Add(time.Minute))

	cases := []struct {
		name     string
		headers  map[string]string
		wantCode int
		wantBody string
	}{
		{"revalidation sees the overwrite", map[string]string{"If-None-Match": oldTag}, http.StatusOK, "the new longer content"},
		{"range of the old version falls back to the whole file", map[string]string{"Range": "bytes=0-2", "If-Range": oldTag}, http.StatusOK, "the new longer content"},
		{"plain range still works", map[string]string{"Range": "bytes=0-2"}, http.StatusPartialContent, "the"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := request(c.headers)
			if w.Code != c.wantCode {
				t.Fatalf("status %d, want %d", w.Code, c.wantCode)
			}
			if got := w.Body.String(); got != c.wantBody {
				t.Errorf("body %q, want %q", got, c.wantBody)
			}
			if got := w.Header().Get("ETag"); got == oldTag || got == "" {
				t.Errorf("ETag %q should be the new version", got)
			}
		})
	}
}
