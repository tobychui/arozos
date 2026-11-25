package user

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

// TestDriveLookupDebug checks that drive lookups and access decisions of a
// user are traced, a failed lookup with the warning about the empty handler
// the caller receives.
func TestDriveLookupDebug(t *testing.T) {
	u := newDriveTestUser(ruleMap{}, "family")
	tests := []struct {
		name string
		run  func()
		want string
	}{
		{"drive found", func() { u.GetFileSystemHandlerFromVirtualPath("user:/Desktop") }, "[Drive] alice: \"user:/Desktop\" is on user:/"},
		{"drive missing", func() { u.GetFileSystemHandlerFromVirtualPath("nope:/a") }, "no usable drive for \"nope:/a\""},
		{"drive missing warns", func() { u.GetFileSystemHandlerFromVirtualPath("nope:/a") }, "abstraction is nil"},
		{"drive list", func() { u.GetAllFileSystemHandler() }, "alice may use"},
		{"access granted", func() { u.GetPathAccessPermission("user:/a.txt") }, "[Access] alice: \"user:/a.txt\" -> readwrite"},
		{"path escapes", func() { u.GetPathAccessPermission("user:../bob/a.txt") }, "not a valid path inside a drive"},
		{"unknown drive", func() { u.GetPathAccessPermission("nope:/a") }, "no pool holds drive nope:/"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		tt.run()
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
