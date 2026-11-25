package ftp

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

// TestAofsDebug checks the debug records of FTP requests.
func TestAofsDebug(t *testing.T) {
	tests := []struct {
		name string
		run  func()
		want string
	}{
		{"no user", func() { aofs{}.debugf("Stat %q", "/a") }, "[FTP] <no user>: Stat \"/a\""},
		{"user", func() { newTestAofs().debugf("Stat %q", "/a") }, "[FTP] alice: Stat \"/a\""},
		{"unknown drive", func() { newTestAofs().pathRewrite("/missing/a.txt") }, "drive missing:/ is not open to this user"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		tt.run()
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
