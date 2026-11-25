package sftpserver

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

// TestPathResolveDebug checks that every way an SFTP path resolves, or does
// not, is traced for the user.
func TestPathResolveDebug(t *testing.T) {
	tests := []struct {
		name  string
		level string
		path  string
		want  string
	}{
		{"unknown drive", "rw", "/nope/a.txt", "[SFTP] alice: \"/nope/a.txt\": drive nope:/ is not open to this user"},
		{"drive hidden from the user", "", "/media/docs/a.txt", "drive media:/ is not open to this user"},
		{"resolved", "r", "/media/docs/a.txt", "\"/media/docs/a.txt\" -> media:/"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		fs, _, _ := newAccessTestRoot(t, tt.level)
		fs.getFshAndSubpathFromSFTPPathname(tt.path)
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}

// TestEmptyPathIsTraced checks that an empty path is reported before it
// reaches the slice that panics on it.
func TestEmptyPathIsTraced(t *testing.T) {
	read := captureDebug(t, true)
	fs, _, _ := newAccessTestRoot(t, "rw")
	func() {
		defer func() { recover() }()
		fs.getFshAndSubpathFromSFTPPathname("  ")
	}()
	if got := read(); !strings.Contains(got, "resolving an empty path, slicing it below will panic") {
		t.Errorf("record %q does not warn about the empty path", got)
	}
}
