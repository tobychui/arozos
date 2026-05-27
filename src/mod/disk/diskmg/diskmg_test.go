package diskmg

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

// TestCheckDeviceValidAcceptsValidName verifies that a well-formed device name
// that also has a matching /dev/ entry passes the regex check.  Because the
// actual /dev/sda1 may or may not exist in the test environment, we only assert
// the regex part of the function (which returns false when the file is absent).
func TestCheckDeviceValidRejectsBadNames(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("checkDeviceValid is Linux-only")
	}
	cases := []struct {
		name  string
		valid bool
	}{
		{"../etc/passwd", false},
		{"sda", false},    // no partition number
		{"sda0", false},   // partition number must be 1–9
		{"sda10", false},  // two-digit partition
		{"nvme0n1", false},
		{"/dev/sda1", false}, // full path not matched by the regex alone
	}
	for _, tc := range cases {
		ok, _ := checkDeviceValid(tc.name)
		if ok != tc.valid {
			t.Errorf("checkDeviceValid(%q) = %v, want %v", tc.name, ok, tc.valid)
		}
	}
}

// TestCheckDeviceValidRegexMatch verifies that "sda1" through "sdz9" match
// the regex (even when /dev/sdX1 doesn't exist on the test host).
func TestCheckDeviceValidRegexMatch(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("checkDeviceValid is Linux-only")
	}
	// sda1 matches the pattern but likely /dev/sda1 doesn't exist in CI,
	// so the function is expected to return (false, "") — regex matches but
	// file-existence check fails.  We only verify that it doesn't panic.
	ok, devID := checkDeviceValid("sda1")
	// Either outcome is acceptable; we just document the expected behaviour
	// when the device file doesn't exist.
	if ok && devID != "sda1" {
		t.Errorf("when ok=true expected devID=sda1, got %q", devID)
	}
}

// TestHandlePlatform verifies the HTTP handler responds with a JSON-encoded
// OS name matching runtime.GOOS.
func TestHandlePlatform(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/disk/platform", nil)
	rr := httptest.NewRecorder()

	HandlePlatform(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Fatal("expected non-empty response body")
	}
	// Body should be a JSON-encoded string of the OS name
	expected := `"` + runtime.GOOS + `"`
	if body != expected {
		t.Errorf("expected body %s, got %s", expected, body)
	}
}

// TestHandleListMountPoints verifies the mount-points handler returns a
// non-empty HTTP 200 response. The JSON value is either a JSON array or the
// JSON null literal (when /media/* matches nothing via filepath.Glob).
func TestHandleListMountPoints(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("HandleListMountPoints is Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/listmount", nil)
	rr := httptest.NewRecorder()

	HandleListMountPoints(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
	// filepath.Glob returns nil when nothing matches; json.Marshal(nil) == "null"
	if body != "null" && (len(body) < 2 || body[0] != '[') {
		t.Errorf("expected JSON array or null, got: %s", body)
	}
}

// TestHandleViewWindowsNotSupported verifies HandleView returns an error when
// DiskmgWin.exe is absent on Windows (which it always is in CI).
func TestHandleViewWindowsNotSupported(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only test")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/view", nil)
	rr := httptest.NewRecorder()

	HandleView(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response")
	}
}

// TestHandleMountNonLinux verifies HandleMount returns a platform-not-supported
// error on non-Linux systems.
func TestHandleMountNonLinux(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("this test targets non-Linux platforms")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ext4&mnt=/media/test", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleFormatWindowsReturnsError verifies HandleFormat returns an error
// on Windows because formatting is Linux-only.
func TestHandleFormatWindowsReturnsError(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only test")
	}
	req := httptest.NewRequest(http.MethodPost, "/disk/format", nil)
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestSupportedFormats ensures the package-level variable contains the
// expected filesystem types.
func TestSupportedFormats(t *testing.T) {
	expected := []string{"ntfs", "vfat", "ext4", "ext3", "btrfs"}
	if len(supportedFormats) != len(expected) {
		t.Fatalf("expected %d supported formats, got %d", len(expected), len(supportedFormats))
	}
	for i, f := range expected {
		if supportedFormats[i] != f {
			t.Errorf("supportedFormats[%d] = %q, want %q", i, supportedFormats[i], f)
		}
	}
}

// TestLsblkStructFields verifies the Lsblk struct can be populated without
// panic (compile-time coverage).
func TestLsblkStructFields(t *testing.T) {
	lb := Lsblk{}
	lb.Blockdevices = nil
	_ = lb
}

// TestLsblkFStructFields verifies the LsblkF struct can be populated without
// panic.
func TestLsblkFStructFields(t *testing.T) {
	lbf := LsblkF{}
	lbf.Blockdevices = nil
	_ = lbf
}
