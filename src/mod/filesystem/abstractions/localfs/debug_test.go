package localfs

import (
	"os"
	"path/filepath"
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

// TestWalkDebug checks that a walk over a missing root hands the callback the
// same arguments with debug mode on or off, and that debug mode records the
// error and the missing FileInfo the callback is about to get.
func TestWalkDebug(t *testing.T) {
	tests := []struct {
		enabled bool
		want    string
	}{
		{false, ""},
		{true, "FileInfo is nil: true"},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		root := t.TempDir()
		l := NewLocalFileSystemAbstraction("d1", root, "public", false)
		missing := filepath.Join(root, "gone")
		calls := 0
		l.Walk(missing, func(path string, info os.FileInfo, err error) error {
			calls++
			if info != nil || err == nil {
				t.Errorf("debug=%v: callback got info %v err %v, want nil info and an error", tt.enabled, info, err)
			}
			return nil
		})
		if calls != 1 {
			t.Errorf("debug=%v: callback called %d times, want 1", tt.enabled, calls)
		}
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("debug=%v: record %q, want %q", tt.enabled, got, tt.want)
		}
	}
}

// TestWriteStreamDebug checks that a write is traced, and a failed one with
// its error.
func TestWriteStreamDebug(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name string
		path string
		want string
	}{
		{"written", filepath.Join(root, "a.txt"), "WriteStream \"" + filepath.Join(root, "a.txt") + "\""},
		{"folder missing", filepath.Join(root, "no", "a.txt"), "open failed"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		l := NewLocalFileSystemAbstraction("d1", root, "public", false)
		l.WriteStream(tt.path, strings.NewReader("hello"), 0644)
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
