package webdavfs

import (
	"os"
	"strings"
	"testing"

	"github.com/studio-b12/gowebdav"
	"imuslab.com/arozos/mod/info/logger"
)

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebugMode(enabled)
	t.Cleanup(func() {
		logger.SetDebugMode(false)
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
		{"client", true, gowebdav.NewClient("http://nas/dav", "", ""), "[WebDAV FS] dav:/ (http://nas/dav) Stat \"/a\"\n"},
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
