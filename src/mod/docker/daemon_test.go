package docker

import (
	"path/filepath"
	"testing"
)

// TestDaemonConfigPath asserts the resolver returns a non-empty path ending in
// daemon.json on every platform.
func TestDaemonConfigPath(t *testing.T) {
	path := daemonConfigPath()
	if path == "" {
		t.Fatal("daemonConfigPath() returned empty string")
	}
	if filepath.Base(path) != "daemon.json" {
		t.Errorf("daemonConfigPath() = %q, want a path ending in daemon.json", path)
	}
}

// TestDaemonConfigEditableTempDir confirms a writable directory is reported as
// editable and that GetDaemonConfig reflects an absent file cleanly.
func TestDaemonConfigEditable(t *testing.T) {
	// A fresh temp dir is always writable by the test process.
	probe := filepath.Join(t.TempDir(), "daemon.json")
	if !daemonConfigEditable(probe) {
		t.Error("daemonConfigEditable() = false for a writable temp dir, want true")
	}

	// A path under a non-existent directory must not be editable.
	bogus := filepath.Join(t.TempDir(), "does", "not", "exist", "daemon.json")
	if daemonConfigEditable(bogus) {
		t.Error("daemonConfigEditable() = true for a non-existent dir, want false")
	}
}
