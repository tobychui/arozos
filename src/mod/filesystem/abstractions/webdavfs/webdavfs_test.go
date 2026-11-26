package webdavfs

import (
	"errors"
	"io/fs"
	"os"
	"strings"
	"testing"

	"github.com/studio-b12/gowebdav"
	"imuslab.com/arozos/mod/info/logger"
)

// Translation needs no connection, so the abstraction is built bare
func TestVirtualPathToRealPath(t *testing.T) {
	tests := []struct {
		hierarchy string
		vpath     string
		want      string
	}{
		{"user", "dav:/Desktop/a.txt", "users/alice/Desktop/a.txt"},
		{"user", "dav:/", "users/alice"},
		{"public", "dav:/docs/a.txt", "/docs/a.txt"},
		{"public", "dav:/", "/"},
	}

	for _, tt := range tests {
		e := WebDAVFileSystem{UUID: "dav", Hierarchy: tt.hierarchy}
		got, err := e.VirtualPathToRealPath(tt.vpath, "alice")
		if err != nil {
			t.Errorf("[%s] VirtualPathToRealPath(%q) unexpected error: %v", tt.hierarchy, tt.vpath, err)
			continue
		}
		if got != tt.want {
			t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want %q", tt.hierarchy, tt.vpath, got, tt.want)
		}
	}
}

func TestVirtualPathToRealPath_RejectsTraversal(t *testing.T) {
	for _, hierarchy := range []string{"user", "public"} {
		e := WebDAVFileSystem{UUID: "dav", Hierarchy: hierarchy}
		for _, vpath := range []string{"dav:../bob/secret.txt", "dav:/../bob", "dav:/a/../../bob"} {
			if got, err := e.VirtualPathToRealPath(vpath, "alice"); err == nil {
				t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want an error", hierarchy, vpath, got)
			}
		}
	}
}

func TestClassifyMapsHTTPStatus(t *testing.T) {
	status := func(code int) error {
		return &os.PathError{Op: "PROPFIND", Path: "/a", Err: gowebdav.StatusError{Status: code}}
	}
	plain := errors.New("connection refused")
	tests := []struct {
		name     string
		in       error
		notExist bool
		denied   bool
	}{
		{"404", status(404), true, false},
		{"410", status(410), true, false},
		{"403", status(403), false, true},
		{"401", status(401), false, true},
		{"500 stays", status(500), false, false},
		{"other error stays", plain, false, false},
	}
	for _, tt := range tests {
		got := classify(tt.in)
		if errors.Is(got, fs.ErrNotExist) != tt.notExist || os.IsNotExist(got) != tt.notExist {
			t.Errorf("%s: not exist = %v", tt.name, errors.Is(got, fs.ErrNotExist))
		}
		if errors.Is(got, fs.ErrPermission) != tt.denied {
			t.Errorf("%s: denied = %v", tt.name, errors.Is(got, fs.ErrPermission))
		}
	}
	if classify(plain) != plain {
		t.Error("an error that is no HTTP status must be passed on as it is")
	}
	if classify(nil) != nil {
		t.Error("nil must stay nil")
	}
}

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebug(enabled)
	t.Cleanup(func() {
		logger.SetDebug(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return func() string {
		data, err := os.ReadFile(l.CurrentLogFile)
		if err != nil {
			t.Fatalf("ReadFile error: %v", err)
		}
		return string(data)
	}
}

// TestDebugf checks the debug record of a drive, which warns when it has no
// client because the next call on it panics.
func TestDebugf(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		client  *gowebdav.Client
		want    string
	}{
		{"debug off", false, nil, ""},
		{"no client", true, nil, `[WebDAV FS] dav:/ (http://nas/dav) Stat "/a" [client is nil: the drive is not connected, this call will panic]`},
		{"client", true, gowebdav.NewClient("http://nas/dav", "", ""), "[WebDAV FS] dav:/ (http://nas/dav) Stat \"/a\" (goroutine "},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		e := WebDAVFileSystem{UUID: "dav", root: "http://nas/dav", c: tt.client}
		e.debugf("Stat %q", "/a")
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q, want %q", tt.name, got, tt.want)
		}
	}
}
