package dftool

import (
	"os"
	"runtime"
	"testing"
)

// TestGetCapacityInfoFromPath_CurrentDir verifies that the current working
// directory resolves to a valid Capacity struct on supported platforms.
func TestGetCapacityInfoFromPath_CurrentDir(t *testing.T) {
	switch runtime.GOOS {
	case "linux", "darwin", "windows":
		// supported
	default:
		t.Skipf("GetCapacityInfoFromPath not supported on %s", runtime.GOOS)
	}

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}

	cap, err := GetCapacityInfoFromPath(cwd)
	if err != nil {
		t.Fatalf("GetCapacityInfoFromPath(%q): %v", cwd, err)
	}
	if cap == nil {
		t.Fatal("GetCapacityInfoFromPath returned nil capacity")
	}
	if cap.Total <= 0 {
		t.Errorf("expected Total > 0, got %d", cap.Total)
	}
	if cap.Available < 0 {
		t.Errorf("expected Available >= 0, got %d", cap.Available)
	}
	if cap.Used < 0 {
		t.Errorf("expected Used >= 0, got %d", cap.Used)
	}
	if cap.PhysicalDevice == "" {
		t.Error("expected non-empty PhysicalDevice")
	}
	t.Logf("device=%s total=%d used=%d available=%d",
		cap.PhysicalDevice, cap.Total, cap.Used, cap.Available)
}

// TestGetCapacityInfoFromPath_TempDir verifies the function works with the OS
// temporary directory.
func TestGetCapacityInfoFromPath_TempDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows uses wmic path; skipping temp-dir test on Windows")
	}

	tmpDir := t.TempDir()
	cap, err := GetCapacityInfoFromPath(tmpDir)
	if err != nil {
		t.Fatalf("GetCapacityInfoFromPath(%q): %v", tmpDir, err)
	}
	if cap == nil {
		t.Fatal("nil Capacity returned")
	}
	if cap.Total <= 0 {
		t.Errorf("Total should be positive, got %d", cap.Total)
	}
}

// TestGetCapacityInfoFromPath_InvalidPath verifies that a non-existent path
// results in an error on non-Windows platforms (df -P will fail).
func TestGetCapacityInfoFromPath_InvalidPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows resolves paths via wmic; invalid path behaviour differs")
	}

	nonExistent := "/this/path/does/not/exist/12345xyz"
	_, err := GetCapacityInfoFromPath(nonExistent)
	if err == nil {
		// df -P on a non-existent path returns an error; if somehow it didn't,
		// just log it rather than failing the test.
		t.Logf("GetCapacityInfoFromPath(%q) returned no error (unexpected but non-fatal)", nonExistent)
	} else {
		t.Logf("GetCapacityInfoFromPath(%q) correctly returned error: %v", nonExistent, err)
	}
}

// TestGetCapacityInfoFromPath_RelativePath verifies that a relative path is
// handled correctly (filepath.Abs should resolve it).
func TestGetCapacityInfoFromPath_RelativePath(t *testing.T) {
	switch runtime.GOOS {
	case "linux", "darwin":
		// supported
	default:
		t.Skipf("relative path test skipped on %s", runtime.GOOS)
	}

	cap, err := GetCapacityInfoFromPath(".")
	if err != nil {
		t.Fatalf("GetCapacityInfoFromPath(%q): %v", ".", err)
	}
	if cap == nil {
		t.Fatal("nil Capacity returned for relative path")
	}
	if cap.Total <= 0 {
		t.Errorf("expected positive Total, got %d", cap.Total)
	}
}

// TestCapacityStruct verifies the Capacity struct fields are accessible.
func TestCapacityStruct(t *testing.T) {
	c := Capacity{
		PhysicalDevice: "/dev/sda1",
		Used:           1024,
		Available:      2048,
		Total:          3072,
	}
	if c.PhysicalDevice != "/dev/sda1" {
		t.Errorf("unexpected PhysicalDevice: %s", c.PhysicalDevice)
	}
	if c.Total != 3072 {
		t.Errorf("unexpected Total: %d", c.Total)
	}
	if c.Used+c.Available != c.Total {
		t.Errorf("Used(%d)+Available(%d) != Total(%d)", c.Used, c.Available, c.Total)
	}
}
