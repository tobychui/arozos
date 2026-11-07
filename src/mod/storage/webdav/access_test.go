package webdav

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
)

// allowAllWrites is the write check of a user who may change everything
func allowAllWrites(vpath string) bool {
	return true
}

// readOnlyDrives returns the write check of a user who may only read the given
// drives
func readOnlyDrives(uuids ...string) WriteChecker {
	return func(vpath string) bool {
		for _, uuid := range uuids {
			if strings.HasPrefix(vpath, uuid+":") {
				return false
			}
		}
		return true
	}
}

// newAccessTestHandler serves "media", which the user may only read and which
// holds a.txt, and "scratch", which the user may change
func newAccessTestHandler(t *testing.T) (http.Handler, string, string) {
	t.Helper()
	mediaFsh, mediaDir := newLocalTestFsh(t, "media")
	scratchFsh, scratchDir := newLocalTestFsh(t, "scratch")
	if err := os.WriteFile(filepath.Join(mediaDir, "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	if err := os.WriteFile(filepath.Join(scratchDir, "note.txt"), []byte("note"), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	s := newTestServer()
	h := s.getRootFs([]*filesystem.FileSystemHandler{mediaFsh, scratchFsh}, "alice", readOnlyDrives("media"))
	return h, mediaDir, scratchDir
}

func TestReadOnlyDriveRefusesChanges(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		target  string
		body    string
		headers map[string]string
	}{
		{name: "upload", method: http.MethodPut, target: "/webdav/media/b.txt", body: "new"},
		{name: "overwrite", method: http.MethodPut, target: "/webdav/media/a.txt", body: "new"},
		{name: "new folder", method: "MKCOL", target: "/webdav/media/folder"},
		{name: "delete", method: http.MethodDelete, target: "/webdav/media/a.txt"},
		{
			name:    "rename",
			method:  "MOVE",
			target:  "/webdav/media/a.txt",
			headers: map[string]string{"Destination": "/webdav/media/c.txt"},
		},
		{
			name:    "move to a writable drive",
			method:  "MOVE",
			target:  "/webdav/media/a.txt",
			headers: map[string]string{"Destination": "/webdav/scratch/a.txt"},
		},
		{
			name:    "copy into it",
			method:  "COPY",
			target:  "/webdav/scratch/note.txt",
			headers: map[string]string{"Destination": "/webdav/media/d.txt"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mediaDir, _ := newAccessTestHandler(t)
			w := serveTestRequest(h, tt.method, tt.target, tt.body, tt.headers)
			if w.Code >= 200 && w.Code < 300 {
				t.Fatalf("status = %d, want a refusal", w.Code)
			}

			entries, err := os.ReadDir(mediaDir)
			if err != nil {
				t.Fatalf("ReadDir() = %v", err)
			}
			if len(entries) != 1 || entries[0].Name() != "a.txt" {
				t.Fatalf("the drive changed, it now holds %v", entries)
			}
			content, _ := os.ReadFile(filepath.Join(mediaDir, "a.txt"))
			if string(content) != "hello" {
				t.Fatalf("a.txt changed: %q", content)
			}
		})
	}
}

func TestReadOnlyDriveCanBeRead(t *testing.T) {
	h, _, _ := newAccessTestHandler(t)
	w := serveTestRequest(h, http.MethodGet, "/webdav/media/a.txt", "", nil)
	if w.Code != http.StatusOK || w.Body.String() != "hello" {
		t.Fatalf("GET = %d %q", w.Code, w.Body.String())
	}
}

func TestReadOnlyDriveCanBeCopiedFrom(t *testing.T) {
	h, _, scratchDir := newAccessTestHandler(t)
	w := serveTestRequest(h, "COPY", "/webdav/media/a.txt", "", map[string]string{
		"Destination": "/webdav/scratch/a.txt",
	})
	if w.Code < 200 || w.Code >= 300 {
		t.Fatalf("COPY = %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(scratchDir, "a.txt")); err != nil {
		t.Fatalf("copy not found: %v", err)
	}
}

func TestWritableDriveStillTakesChanges(t *testing.T) {
	h, _, scratchDir := newAccessTestHandler(t)
	w := serveTestRequest(h, http.MethodPut, "/webdav/scratch/b.txt", "new", nil)
	if w.Code < 200 || w.Code >= 300 {
		t.Fatalf("PUT = %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(scratchDir, "b.txt")); err != nil {
		t.Fatalf("upload not found: %v", err)
	}
}
