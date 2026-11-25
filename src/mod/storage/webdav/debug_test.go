package webdav

import (
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
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

// TestAdapterDebugf checks the debug record of a WebDAV request, which warns
// about a drive whose use panics.
func TestAdapterDebugf(t *testing.T) {
	abs := localfs.NewLocalFileSystemAbstraction("media", t.TempDir(), "public", false)
	tests := []struct {
		name string
		fsh  *filesystem.FileSystemHandler
		want string
	}{
		{"no drive", nil, "[WebDAV] alice on <nil drive> Stat \"/a\""},
		{"no abstraction", &filesystem.FileSystemHandler{UUID: "media"}, "[WebDAV] alice on media:/ <nil abstraction, this call will panic> Stat \"/a\""},
		{"drive", &filesystem.FileSystemHandler{UUID: "media", FileSystemAbstraction: abs}, "[WebDAV] alice on media:/ Stat \"/a\""},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		NewFshWebDAVAdapter(tt.fsh, "alice", func(string) bool { return true }).debugf("Stat %q", "/a")
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
