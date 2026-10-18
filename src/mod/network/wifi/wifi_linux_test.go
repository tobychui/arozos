//go:build linux
// +build linux

package wifi

import (
	"runtime"
	"testing"
)

// ---------------------------------------------------------------------------
// Linux-specific helper function tests
// ---------------------------------------------------------------------------

// TestFileExistsLinux verifies the fileExists helper.
func TestFileExistsLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("fileExists helper is in linux-only source; test runs on Linux")
	}
	// A path that exists.
	if !fileExists("/proc/version") {
		t.Error("fileExists(\"/proc/version\") should return true on Linux")
	}
	// A path that does not exist.
	if fileExists("/nonexistent_path_xyz_12345") {
		t.Error("fileExists(\"/nonexistent_path_xyz_12345\") should return false")
	}
}

// TestFileInDirLinux verifies the fileInDir helper.
func TestFileInDirLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("fileInDir helper is in linux-only source; test runs on Linux")
	}
	// The file is inside the directory.
	if !fileInDir("/tmp/foo/bar.txt", "/tmp/foo") {
		t.Error("fileInDir should return true when file is inside directory")
	}
	// The file is outside the directory.
	if fileInDir("/proc/version", "/tmp") {
		t.Error("fileInDir should return false when file is outside directory")
	}
}

// TestPkgExistsLinux verifies the pkg_exists helper.
func TestPkgExistsLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("pkg_exists helper is in linux-only source; test runs on Linux")
	}
	// "sh" should always exist on Linux.
	if !pkg_exists("sh") {
		t.Error("pkg_exists(\"sh\") should return true on Linux")
	}
	// A package that almost certainly doesn't exist.
	if pkg_exists("this_package_does_not_exist_xyz") {
		t.Error("pkg_exists(\"this_package_does_not_exist_xyz\") should return false")
	}
}

// TestGetSignalLevelEstimation verifies the bar-to-dBm mapping.
func TestGetSignalLevelEstimation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("getSignalLevelEstimation is in linux-only source; test runs on Linux")
	}
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")

	cases := []struct {
		bar      string
		expected string
	}{
		{"▂▄▆█", "-45 dBm[Estimated]"},
		{"▂▄▆_", "-55 dBm[Estimated]"},
		{"▂▄__", "-75 dBm[Estimated]"},
		{"▂___", "-85 dBm[Estimated]"},
		{"____", "-95 dBm[Estimated]"},
		{"", "-95 dBm[Estimated]"},
	}

	for _, tc := range cases {
		got := wm.getSignalLevelEstimation(tc.bar)
		if got != tc.expected {
			t.Errorf("getSignalLevelEstimation(%q) = %q, expected %q", tc.bar, got, tc.expected)
		}
	}
}
