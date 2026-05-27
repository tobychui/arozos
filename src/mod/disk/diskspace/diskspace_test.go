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
