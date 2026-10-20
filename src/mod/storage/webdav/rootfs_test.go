package webdav

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// newLocalTestFsh builds a public local storage named uuid over a temp dir.
func newLocalTestFsh(t *testing.T, uuid string) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	return &filesystem.FileSystemHandler{
		Name:                  uuid,
		UUID:                  uuid,
		Hierarchy:             "public",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction(uuid, dir, "public", false),
	}, dir
}

// newRootFsTestHandler serves two local storages, "user" and "tmp", under
// the virtual root of /webdav.
func newRootFsTestHandler(t *testing.T) (http.Handler, string, string) {
	t.Helper()
	userFsh, userDir := newLocalTestFsh(t, "user")
	tmpFsh, tmpDir := newLocalTestFsh(t, "tmp")
	s := newTestServer()
	h := s.getRootFs([]*filesystem.FileSystemHandler{userFsh, tmpFsh}, "alice")
	return h, userDir, tmpDir
}

func serveTestRequest(h http.Handler, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestSplitRootPath(t *testing.T) {
	tests := []struct {
		name        string
		wantUUID    string
		wantSubpath string
	}{
		{"/", "", "/"},
		{"", "", "/"},
		{"/user", "user", "/"},
		{"/user/", "user", "/"},
		{"/user/Video/a.mp4", "user", "/Video/a.mp4"},
		{"user/Video", "user", "/Video"},
		{"/user/../tmp/a", "tmp", "/a"},
		{"/../../etc", "etc", "/"},
	}
	for _, tt := range tests {
		uuid, subpath := splitRootPath(tt.name)
		if uuid != tt.wantUUID || subpath != tt.wantSubpath {
			t.Errorf("splitRootPath(%q) = (%q, %q), want (%q, %q)", tt.name, uuid, subpath, tt.wantUUID, tt.wantSubpath)
		}
	}
}

func TestRootFs_ListsEveryStorage(t *testing.T) {
	h, _, _ := newRootFsTestHandler(t)
	w := serveTestRequest(h, "PROPFIND", "/webdav/", "", map[string]string{"Depth": "1"})
	if w.Code != http.StatusMultiStatus {
		t.Fatalf("PROPFIND root: expected 207, got %d", w.Code)
	}
	body := w.Body.String()
	for _, href := range []string{"/webdav/", "/webdav/user/", "/webdav/tmp/"} {
		if !strings.Contains(body, "<D:href>"+href+"</D:href>") {
			t.Errorf("root listing is missing %s:\n%s", href, body)
		}
	}
	if !strings.Contains(body, "<D:displayname>user</D:displayname>") {
		t.Errorf("expected the storage folder to be named by its UUID:\n%s", body)
	}
}

func TestRootFs_StatStorageUsesUUID(t *testing.T) {
	userFsh, _ := newLocalTestFsh(t, "user")
	rootfs := NewRootFsWebDAVAdapter([]*filesystem.FileSystemHandler{userFsh}, "alice")
	s, err := rootfs.Stat(context.Background(), "/user")
	if err != nil {
		t.Fatalf("Stat /user: %v", err)
	}
	if s.Name() != "user" || !s.IsDir() {
		t.Errorf("Stat /user = (%q, dir %v), want (\"user\", dir true)", s.Name(), s.IsDir())
	}
	if _, err := rootfs.Stat(context.Background(), "/missing"); !os.IsNotExist(err) {
		t.Errorf("Stat /missing: expected not exist, got %v", err)
	}
}

func TestRootFs_ReadWriteInsideStorage(t *testing.T) {
	h, userDir, _ := newRootFsTestHandler(t)

	w := serveTestRequest(h, http.MethodPut, "/webdav/user/a.txt", "hello", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("PUT: expected 201, got %d", w.Code)
	}
	got, err := os.ReadFile(filepath.Join(userDir, "a.txt"))
	if err != nil || string(got) != "hello" {
		t.Fatalf("uploaded file = %q, %v; want \"hello\"", got, err)
	}

	w = serveTestRequest(h, http.MethodGet, "/webdav/user/a.txt", "", nil)
	if w.Code != http.StatusOK || w.Body.String() != "hello" {
		t.Errorf("GET: got %d %q, want 200 \"hello\"", w.Code, w.Body.String())
	}

	w = serveTestRequest(h, "MKCOL", "/webdav/user/folder", "", nil)
	if w.Code != http.StatusCreated {
		t.Errorf("MKCOL in storage: expected 201, got %d", w.Code)
	}
}

func TestRootFs_RootIsReadOnly(t *testing.T) {
	h, userDir, _ := newRootFsTestHandler(t)
	tests := []struct {
		method  string
		target  string
		headers map[string]string
	}{
		{http.MethodPut, "/webdav/a.txt", nil},
		{"MKCOL", "/webdav/newfolder", nil},
		{http.MethodDelete, "/webdav/user", nil},
		{"MOVE", "/webdav/user", map[string]string{"Destination": "/webdav/renamed"}},
		{"COPY", "/webdav/user", map[string]string{"Destination": "/webdav/copied"}},
	}
	for _, tt := range tests {
		w := serveTestRequest(h, tt.method, tt.target, "", tt.headers)
		if w.Code < 400 {
			t.Errorf("%s %s: expected an error status, got %d", tt.method, tt.target, w.Code)
		}
	}
	if _, err := os.Stat(userDir); err != nil {
		t.Errorf("storage folder should be untouched: %v", err)
	}
}

func TestRootFs_UnknownStorage(t *testing.T) {
	h, _, _ := newRootFsTestHandler(t)
	w := serveTestRequest(h, http.MethodGet, "/webdav/missing/a.txt", "", nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET on unknown storage: expected 404, got %d", w.Code)
	}
}

func TestRootFs_MoveAcrossStorages(t *testing.T) {
	h, userDir, tmpDir := newRootFsTestHandler(t)
	os.WriteFile(filepath.Join(userDir, "a.txt"), []byte("file"), 0644)
	os.MkdirAll(filepath.Join(userDir, "dir", "sub"), 0755)
	os.WriteFile(filepath.Join(userDir, "dir", "sub", "b.txt"), []byte("nested"), 0644)

	tests := []struct {
		src, dest string
		check     string
		want      string
	}{
		{"/webdav/user/a.txt", "/webdav/tmp/a.txt", filepath.Join(tmpDir, "a.txt"), "file"},
		{"/webdav/user/dir", "/webdav/tmp/dir", filepath.Join(tmpDir, "dir", "sub", "b.txt"), "nested"},
	}
	for _, tt := range tests {
		w := serveTestRequest(h, "MOVE", tt.src, "", map[string]string{"Destination": tt.dest})
		if w.Code != http.StatusCreated {
			t.Errorf("MOVE %s: expected 201, got %d", tt.src, w.Code)
			continue
		}
		got, err := os.ReadFile(tt.check)
		if err != nil || string(got) != tt.want {
			t.Errorf("MOVE %s: moved content = %q, %v; want %q", tt.src, got, err, tt.want)
		}
	}
	for _, gone := range []string{"a.txt", "dir"} {
		if _, err := os.Stat(filepath.Join(userDir, gone)); !os.IsNotExist(err) {
			t.Errorf("source %s should be removed after the move, got %v", gone, err)
		}
	}
}

func TestRootFs_VirtualPath(t *testing.T) {
	userFsh, _ := newLocalTestFsh(t, "user")
	rootfs := NewRootFsWebDAVAdapter([]*filesystem.FileSystemHandler{userFsh}, "alice")
	tests := []struct {
		name    string
		want    string
		wantErr bool
	}{
		{"/", "", true},
		{"/user", "user:/", false},
		{"/user/Video", "user:/Video", false},
		{"/missing/Video", "", true},
	}
	for _, tt := range tests {
		fsh, vpath, err := rootfs.VirtualPath(tt.name)
		if (err != nil) != tt.wantErr {
			t.Errorf("VirtualPath(%q) error = %v, wantErr %v", tt.name, err, tt.wantErr)
			continue
		}
		if !tt.wantErr && (vpath != tt.want || fsh != userFsh) {
			t.Errorf("VirtualPath(%q) = %q, want %q", tt.name, vpath, tt.want)
		}
	}
}
