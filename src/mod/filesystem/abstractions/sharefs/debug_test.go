package sharefs

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

// TestResolveDebug checks that every way a share:/ path resolves, or does
// not, is traced.
func TestResolveDebug(t *testing.T) {
	s, _, _ := newTestDrive(t)
	tests := []struct {
		vpath string
		want  string
	}{
		{"share:/", "drive root of alice"},
		{"share:/Photos/a.jpg", "alice's \"Photos\" (owner bob) on user:/"},
		{"share:/NotShared", "\"NotShared\" is not shared with alice"},
		{"share:/Secret/plans.txt", "alice may not browse inside \"Secret\""},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		s.Stat(mustReal(t, s, tt.vpath, "alice"))
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("Stat(%q) record %q does not contain %q", tt.vpath, got, tt.want)
		}
	}
}
