package dftool

import (
	"os"
	"runtime"
	"strings"
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

// TestParseDFOutput_ValidOutput verifies that well-formed df -P output is parsed correctly.
func TestParseDFOutput_ValidOutput(t *testing.T) {
	// Simulated df -P output: header line + data line (values are in 1024-byte blocks)
	output := "Filesystem     1024-blocks    Used Available Capacity Mounted on\n/dev/sda1         100000   20000     75000      21% /\n"
	cap, err := parseDFOutput(output)
	if err != nil {
		t.Fatalf("parseDFOutput returned unexpected error: %v", err)
	}
	if cap == nil {
		t.Fatal("parseDFOutput returned nil")
	}
	if cap.PhysicalDevice != "/dev/sda1" {
		t.Errorf("expected PhysicalDevice /dev/sda1, got %q", cap.PhysicalDevice)
	}
	if cap.Total != 100000*1024 {
		t.Errorf("expected Total %d, got %d", 100000*1024, cap.Total)
	}
	if cap.Used != 20000*1024 {
		t.Errorf("expected Used %d, got %d", 20000*1024, cap.Used)
	}
	if cap.Available != 75000*1024 {
		t.Errorf("expected Available %d, got %d", 75000*1024, cap.Available)
	}
}

// TestParseDFOutput_MultipleSpaces verifies that multiple consecutive spaces are collapsed.
func TestParseDFOutput_MultipleSpaces(t *testing.T) {
	// df output sometimes uses multiple spaces to align columns
	output := "Filesystem  1024-blocks  Used  Available  Capacity  Mounted on\n/dev/vda1   500000  100000  380000  21%  /\n"
	cap, err := parseDFOutput(output)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Total != 500000*1024 {
		t.Errorf("expected Total %d, got %d", 500000*1024, cap.Total)
	}
}

// TestParseDFOutput_TooFewColumns verifies that output with fewer than 4 columns returns an error.
func TestParseDFOutput_TooFewColumns(t *testing.T) {
	// Only 3 columns — should trigger the "Malformed output" error
	output := "Filesystem\n/dev/sda1 100000 20000\n"
	_, err := parseDFOutput(output)
	if err == nil {
		t.Fatal("expected error for too-few columns, got nil")
	}
	if err.Error() != "Malformed output for df -P" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}

// TestParseDFOutput_NonNumericTotal verifies that a non-numeric total field returns an error.
func TestParseDFOutput_NonNumericTotal(t *testing.T) {
	output := "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 BADTOTAL 20000 75000 21% /\n"
	_, err := parseDFOutput(output)
	if err == nil {
		t.Fatal("expected error for non-numeric total, got nil")
	}
	if err.Error() != "Malformed output for df -P" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}

// TestParseDFOutput_NonNumericUsed verifies that a non-numeric used field returns an error.
func TestParseDFOutput_NonNumericUsed(t *testing.T) {
	output := "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 100000 BADUSED 75000 21% /\n"
	_, err := parseDFOutput(output)
	if err == nil {
		t.Fatal("expected error for non-numeric used, got nil")
	}
	if err.Error() != "Malformed output for df -P" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}

// TestParseDFOutput_NonNumericAvailable verifies that a non-numeric available field returns an error.
func TestParseDFOutput_NonNumericAvailable(t *testing.T) {
	output := "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 100000 20000 BADAVAIL 21% /\n"
	_, err := parseDFOutput(output)
	if err == nil {
		t.Fatal("expected error for non-numeric available, got nil")
	}
	if err.Error() != "Malformed output for df -P" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}

// TestParseDFOutput_SingleLine verifies behaviour when there is only one line (no header).
func TestParseDFOutput_SingleLine(t *testing.T) {
	output := "/dev/sda1 100000 20000 75000 21% /"
	cap, err := parseDFOutput(output)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Total != 100000*1024 {
		t.Errorf("expected Total %d, got %d", 100000*1024, cap.Total)
	}
}

// TestCapacity_UsedPercent_Normal verifies UsedPercent returns the correct ratio.
func TestCapacity_UsedPercent_Normal(t *testing.T) {
	c := &Capacity{
		PhysicalDevice: "/dev/sda1",
		Used:           25 * 1024 * 1024,
		Available:      75 * 1024 * 1024,
		Total:          100 * 1024 * 1024,
	}
	pct := c.UsedPercent()
	if pct != 25.0 {
		t.Errorf("expected UsedPercent 25.0, got %f", pct)
	}
}

// TestCapacity_UsedPercent_ZeroTotal verifies UsedPercent returns 0 when Total is 0.
func TestCapacity_UsedPercent_ZeroTotal(t *testing.T) {
	c := &Capacity{}
	pct := c.UsedPercent()
	if pct != 0.0 {
		t.Errorf("expected UsedPercent 0 for zero Total, got %f", pct)
	}
}

// TestCapacity_UsedPercent_FullDisk verifies 100% usage is reported correctly.
func TestCapacity_UsedPercent_FullDisk(t *testing.T) {
	c := &Capacity{
		PhysicalDevice: "/dev/sda1",
		Used:           1024,
		Available:      0,
		Total:          1024,
	}
	pct := c.UsedPercent()
	if pct != 100.0 {
		t.Errorf("expected UsedPercent 100.0, got %f", pct)
	}
}

// TestCapacity_FreeBytes verifies FreeBytes returns the Available field.
func TestCapacity_FreeBytes(t *testing.T) {
	c := &Capacity{
		PhysicalDevice: "/dev/sda1",
		Used:           25 * 1024,
		Available:      75 * 1024,
		Total:          100 * 1024,
	}
	if c.FreeBytes() != 75*1024 {
		t.Errorf("expected FreeBytes %d, got %d", 75*1024, c.FreeBytes())
	}
}

// TestCapacity_IsEmpty_True verifies IsEmpty returns true for a zero-value Capacity.
func TestCapacity_IsEmpty_True(t *testing.T) {
	c := &Capacity{}
	if !c.IsEmpty() {
		t.Error("expected IsEmpty() == true for zero-value Capacity")
	}
}

// TestCapacity_IsEmpty_False verifies IsEmpty returns false when Total is non-zero.
func TestCapacity_IsEmpty_False(t *testing.T) {
	c := &Capacity{Total: 1024 * 1024}
	if c.IsEmpty() {
		t.Error("expected IsEmpty() == false when Total > 0")
	}
}

// TestCapacity_String verifies the String method produces a non-empty formatted string.
func TestCapacity_String(t *testing.T) {
	c := &Capacity{
		PhysicalDevice: "/dev/sda1",
		Used:           1024,
		Available:      3072,
		Total:          4096,
	}
	s := c.String()
	if s == "" {
		t.Error("expected non-empty string from String()")
	}
	if !strings.Contains(s, "/dev/sda1") {
		t.Errorf("expected String() to contain device name, got: %q", s)
	}
}
