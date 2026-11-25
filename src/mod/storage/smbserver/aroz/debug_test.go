package aroz

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

// TestShareDebugf checks the debug record of an SMB request, which warns
// about a drive whose use panics or that is closed.
func TestShareDebugf(t *testing.T) {
	abs := localfs.NewLocalFileSystemAbstraction("media", t.TempDir(), "public", false)
	tests := []struct {
		name  string
		share *share
		want  string
	}{
		{"no drive or user", &share{}, "[SMB] <no user> on <nil drive> (share \"\") Stat \"a\""},
		{"no abstraction", &share{fsh: &filesystem.FileSystemHandler{UUID: "media"}, v: &view{username: "alice"}}, "[SMB] alice on media:/ <nil abstraction, this call will panic>"},
		{"closed", &share{fsh: &filesystem.FileSystemHandler{UUID: "media", FileSystemAbstraction: abs, Closed: true}, v: &view{username: "alice"}}, "[SMB] alice on media:/ <closed>"},
		{"open", &share{fsh: &filesystem.FileSystemHandler{UUID: "media", FileSystemAbstraction: abs}, v: &view{username: "alice"}}, "[SMB] alice on media:/ (share \"\") Stat \"a\""},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		tt.share.debugf("Stat %q", "a")
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
