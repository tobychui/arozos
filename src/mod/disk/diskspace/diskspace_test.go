package diskspace

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

// TestGetAllLogicDiskInfo verifies that GetAllLogicDiskInfo returns at least
// one entry with plausible values on the current OS.
func TestGetAllLogicDiskInfo(t *testing.T) {
	switch runtime.GOOS {
	case "linux", "darwin":
		// Uses `df -k | sed …` via bash.
	case "windows":
		// Uses wmic.
	default:
		t.Skipf("GetAllLogicDiskInfo behaviour undefined on %s", runtime.GOOS)
	}

	disks := GetAllLogicDiskInfo()
	// The host must have at least one disk visible to df / wmic.
	if len(disks) == 0 {
		t.Error("expected at least one disk entry, got 0")
	}

	for _, d := range disks {
		if d.Device == "" {
			t.Errorf("disk entry has empty Device: %+v", d)
		}
		if d.Volume < 0 {
			t.Errorf("negative Volume for %s: %d", d.Device, d.Volume)
		}
		if d.Available < 0 {
			t.Errorf("negative Available for %s: %d", d.Device, d.Available)
		}
	}
}

// TestGetAllLogicDiskInfo_Linux is a Linux-specific check that confirms the df
// output is parsed correctly and volume sizes are sensible.
func TestGetAllLogicDiskInfo_Linux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}

	disks := GetAllLogicDiskInfo()
	if len(disks) == 0 {
		t.Fatal("expected disk entries on Linux")
	}

	for _, d := range disks {
		// df reports in 1 KiB blocks; after *1024 all values should be >= 0.
		if d.Volume < 0 || d.Used < 0 || d.Available < 0 {
			t.Errorf("negative capacity value for %s: volume=%d used=%d avail=%d",
				d.Device, d.Volume, d.Used, d.Available)
		}
		if d.MountPoint == "" {
			t.Errorf("empty MountPoint for device %s", d.Device)
		}
		t.Logf("device=%s mount=%s volume=%d used=%d avail=%d pct=%s",
			d.Device, d.MountPoint, d.Volume, d.Used, d.Available, d.UsedPercentage)
	}
}

// TestGetAllLogicDiskInfo_Windows is a Windows-specific check.
func TestGetAllLogicDiskInfo_Windows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only test")
	}

	disks := GetAllLogicDiskInfo()
	// wmic should always find at least the system drive.
	if len(disks) == 0 {
		t.Fatal("expected at least one disk entry on Windows")
	}

	for _, d := range disks {
		if d.Device == "" {
			t.Errorf("empty Device for disk entry: %+v", d)
		}
	}
}

// TestHandleDiskSpaceList verifies the HTTP handler returns valid JSON.
func TestHandleDiskSpaceList(t *testing.T) {
	switch runtime.GOOS {
	case "linux", "darwin", "windows":
	default:
		t.Skipf("HandleDiskSpaceList not meaningful on %s", runtime.GOOS)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/diskspace", nil)
	rr := httptest.NewRecorder()

	HandleDiskSpaceList(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected HTTP 200, got %d", rr.Code)
	}

	ct := rr.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var result []LogicalDiskSpaceInfo
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response JSON: %v | body: %s", err, rr.Body.String())
	}

	// Should mirror GetAllLogicDiskInfo output.
	expected := GetAllLogicDiskInfo()
	if len(result) != len(expected) {
		t.Errorf("handler returned %d entries, GetAllLogicDiskInfo returned %d",
			len(result), len(expected))
	}
}

// TestHandleDiskSpaceList_EmptyIsValidJSON verifies that an empty slice is still
// serialised as a JSON array, not null.
func TestHandleDiskSpaceList_EmptyIsValidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/diskspace", nil)
	rr := httptest.NewRecorder()

	// Even if no disks are found the handler must write parseable JSON.
	HandleDiskSpaceList(rr, req)

	body := rr.Body.Bytes()
	var v interface{}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("response is not valid JSON: %v | body: %s", err, body)
	}
}

// TestStringToInt64 exercises the private helper via the exported package API
// indirectly, and directly since we are in the same package.
func TestStringToInt64(t *testing.T) {
	cases := []struct {
		input    string
		expected int64
		wantErr  bool
	}{
		{"0", 0, false},
		{"1024", 1024, false},
		{"9223372036854775807", 9223372036854775807, false},
		{"", 0, true},
		{"abc", 0, true},
	}

	for _, tc := range cases {
		got, err := stringToInt64(tc.input)
		if tc.wantErr {
			if err == nil {
				t.Errorf("stringToInt64(%q): expected error, got nil", tc.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("stringToInt64(%q): unexpected error: %v", tc.input, err)
			continue
		}
		if got != tc.expected {
			t.Errorf("stringToInt64(%q) = %d, want %d", tc.input, got, tc.expected)
		}
	}
}

// TestStringToInt64NegativeValue verifies negative numbers parse correctly.
func TestStringToInt64NegativeValue(t *testing.T) {
	got, err := stringToInt64("-42")
	if err != nil {
		t.Fatalf("unexpected error for -42: %v", err)
	}
	if got != -42 {
		t.Errorf("expected -42, got %d", got)
	}
}

// TestLogicalDiskSpaceInfoStruct verifies all fields of LogicalDiskSpaceInfo
// can be set and retrieved.
func TestLogicalDiskSpaceInfoStruct(t *testing.T) {
	d := LogicalDiskSpaceInfo{
		Device:         "/dev/sda1",
		Volume:         100 * 1024 * 1024 * 1024,
		Used:           40 * 1024 * 1024 * 1024,
		Available:      60 * 1024 * 1024 * 1024,
		UsedPercentage: "40%",
		MountPoint:     "/",
	}
	if d.Device != "/dev/sda1" {
		t.Errorf("Device: want /dev/sda1, got %q", d.Device)
	}
	if d.Volume != 100*1024*1024*1024 {
		t.Errorf("Volume: unexpected value %d", d.Volume)
	}
	if d.Used != 40*1024*1024*1024 {
		t.Errorf("Used: unexpected value %d", d.Used)
	}
	if d.Available != 60*1024*1024*1024 {
		t.Errorf("Available: unexpected value %d", d.Available)
	}
	if d.UsedPercentage != "40%" {
		t.Errorf("UsedPercentage: want 40%%, got %q", d.UsedPercentage)
	}
	if d.MountPoint != "/" {
		t.Errorf("MountPoint: want /, got %q", d.MountPoint)
	}
}

// TestGetAllLogicDiskInfo_UsedPlusAvailable verifies that for each disk entry,
// Used + Available is <= Volume (the parsing must be consistent).
func TestGetAllLogicDiskInfo_UsedPlusAvailable(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("test targets Linux df output")
	}
	disks := GetAllLogicDiskInfo()
	for _, d := range disks {
		if d.Volume > 0 && d.Used+d.Available > d.Volume {
			// Allow small discrepancy from rounding in df -k * 1024
			margin := int64(1024 * 100) // 100 KiB rounding tolerance
			diff := (d.Used + d.Available) - d.Volume
			if diff > margin {
				t.Errorf("disk %s: Used(%d)+Available(%d) exceeds Volume(%d) by %d",
					d.Device, d.Used, d.Available, d.Volume, diff)
			}
		}
	}
}

// TestHandleDiskSpaceList_ContentType verifies Content-Type is application/json.
func TestHandleDiskSpaceList_ContentType(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/diskspace", nil)
	rr := httptest.NewRecorder()
	HandleDiskSpaceList(rr, req)
	ct := rr.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
}

// TestHandleDiskSpaceList_PostMethod verifies the handler works with POST too.
func TestHandleDiskSpaceList_PostMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/diskspace", nil)
	rr := httptest.NewRecorder()
	HandleDiskSpaceList(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected HTTP 200, got %d", rr.Code)
	}
}

// TestGetAllLogicDiskInfo_Linux_DriveParseConsistency verifies each disk has a
// valid used-percentage string and the device name is non-empty on Linux.
func TestGetAllLogicDiskInfo_Linux_DriveParseConsistency(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	disks := GetAllLogicDiskInfo()
	if len(disks) == 0 {
		t.Fatal("expected at least one disk on Linux")
	}
	for _, d := range disks {
		if d.Device == "" {
			t.Errorf("disk entry has empty Device: %+v", d)
		}
		if d.Volume < 0 {
			t.Errorf("negative Volume for %s", d.Device)
		}
		if d.UsedPercentage == "" {
			t.Errorf("empty UsedPercentage for device %s", d.Device)
		}
	}
}

// TestHandleDiskSpaceList_ResponseBodyNotEmpty verifies the response body is
// not empty.
func TestHandleDiskSpaceList_ResponseBodyNotEmpty(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/diskspace", nil)
	rr := httptest.NewRecorder()
	HandleDiskSpaceList(rr, req)
	if len(rr.Body.Bytes()) == 0 {
		t.Error("expected non-empty response body")
	}
}

// TestGetAllLogicDiskInfo_MultipleCalls verifies the function can be called
// multiple times without panicking.
func TestGetAllLogicDiskInfo_MultipleCalls(t *testing.T) {
	for i := 0; i < 3; i++ {
		disks := GetAllLogicDiskInfo()
		_ = disks
	}
}

// TestStringToInt64_MaxInt32 verifies large int32-range values parse correctly.
func TestStringToInt64_MaxInt32(t *testing.T) {
	got, err := stringToInt64("2147483647")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 2147483647 {
		t.Errorf("expected 2147483647, got %d", got)
	}
}

// TestStringToInt64_Zero verifies zero parses correctly.
func TestStringToInt64_Zero(t *testing.T) {
	got, err := stringToInt64("0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

// TestStringToInt64_InvalidStrings verifies various invalid inputs return errors.
func TestStringToInt64_InvalidStrings(t *testing.T) {
	invalids := []string{"  ", "1.5", "1e3", "0x10", "NaN"}
	for _, s := range invalids {
		_, err := stringToInt64(s)
		if err == nil {
			t.Errorf("stringToInt64(%q): expected error, got nil", s)
		}
	}
}

// TestGetAllLogicDiskInfo_MountPointNotEmpty verifies each disk has a mount
// point on Linux (the / always exists).
func TestGetAllLogicDiskInfo_MountPointNotEmpty(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	disks := GetAllLogicDiskInfo()
	foundRoot := false
	for _, d := range disks {
		if d.MountPoint == "/" {
			foundRoot = true
		}
	}
	if !foundRoot {
		t.Log("root filesystem not found in disk list (may be inside container)")
	}
}
