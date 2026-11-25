package sftpfs

import (
	"os"
	"strings"
	"testing"

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
// SFTP client because the next call on it panics.
func TestDebugf(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		want    string
	}{
		{"debug off", false, ""},
		{"no client", true, `[SFTP FS] box:/ (10.0.0.3:22/data) Stat "/data/a" [client is nil: the drive is not connected, this call will panic]`},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		s := SFTPFileSystemAbstraction{uuid: "box", url: "10.0.0.3", port: 22, mountFolder: "/data"}
		s.debugf("Stat %q", "/data/a")
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q, want %q", tt.name, got, tt.want)
		}
	}
}

// TestVirtualPathToRealPath checks translation into the mount folder and its
// debug record. It needs no connection.
func TestVirtualPathToRealPath(t *testing.T) {
	tests := []struct {
		hierarchy string
		vpath     string
		want      string
	}{
		{"public", "box:/docs/a.txt", "/data/docs/a.txt"},
		{"user", "box:/a.txt", "/data/users/alice/a.txt"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		s := SFTPFileSystemAbstraction{uuid: "box", hierarchy: tt.hierarchy, mountFolder: "/data"}
		got, err := s.VirtualPathToRealPath(tt.vpath, "alice")
		if err != nil {
			t.Fatalf("VirtualPathToRealPath(%q) error: %v", tt.vpath, err)
		}
		if got != tt.want {
			t.Errorf("VirtualPathToRealPath(%q) = %q, want %q", tt.vpath, got, tt.want)
		}
		if log := read(); !strings.Contains(log, "-> \""+tt.want+"\"") {
			t.Errorf("record %q does not name the result %q", log, tt.want)
		}
	}
}
