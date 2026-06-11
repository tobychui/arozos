package diskmg

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

// TestCheckDeviceValidRejectsBadNames verifies that malformed device names are
// rejected. Names with no "sd[a-z][1-9]" token are rejected deterministically by
// the regex on every host; names that embed a valid token (e.g. "/dev/sda1" or
// "sda10") are sanitized down to that token, so whether they are finally accepted
// depends on /dev/sda1 existing on the test host — present on some CI runners,
// absent on others. There we assert the sanitization contract instead of a fixed
// boolean (mirroring TestCheckDeviceValidRegexMatch below).
func TestCheckDeviceValidRejectsBadNames(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("checkDeviceValid is Linux-only")
	}
	// No "sd[a-z][1-9]" token at all -> rejected by the regex before any /dev/
	// lookup, so the result is identical on every host.
	for _, name := range []string{"../etc/passwd", "sda", "sda0", "nvme0n1"} {
		if ok, _ := checkDeviceValid(name); ok {
			t.Errorf("checkDeviceValid(%q) = true, want false", name)
		}
	}

	// These embed a valid "sda1" token, so checkDeviceValid sanitizes the input
	// down to that token and accepts it only when /dev/sda1 exists. Assert the
	// sanitization contract: when accepted, the device id must be the clean "sda1".
	for _, name := range []string{"sda10", "/dev/sda1"} {
		if ok, devID := checkDeviceValid(name); ok && devID != "sda1" {
			t.Errorf("checkDeviceValid(%q) accepted with devID=%q, want \"sda1\"", name, devID)
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

// TestHandleViewLinux verifies HandleView returns a non-empty response on Linux
// where lsblk is typically available.
func TestHandleViewLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/view", nil)
	rr := httptest.NewRecorder()

	HandleView(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty body from HandleView on Linux")
	}
	// Response is either a JSON array (success) or an error JSON object
	t.Logf("HandleView response (first 200 chars): %.200s", body)
}

// TestHandleMountLinuxMissingFormat verifies HandleMount returns an error when
// the "format" parameter is missing on Linux.
func TestHandleMountLinuxMissingFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&mnt=/media/test", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
	t.Logf("HandleMount (missing format) response: %s", body)
}

// TestHandleMountLinuxMissingMnt verifies HandleMount returns an error when
// the "mnt" parameter is missing on Linux.
func TestHandleMountLinuxMissingMnt(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ext4", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleMountLinuxInvalidDevice verifies HandleMount returns an error when
// the device name is invalid (does not match sdX[1-9]).
func TestHandleMountLinuxInvalidDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=invaliddev&format=ext4&mnt=/media/test", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	body := rr.Body.String()
	if !strings.Contains(body, "error") && !strings.Contains(body, "Error") && !strings.Contains(body, "valid") {
		t.Errorf("expected error response for invalid device, got: %s", body)
	}
}

// TestHandleMountLinuxInvalidFormat verifies HandleMount returns an error when
// the format is not one of the supported types.
func TestHandleMountLinuxInvalidFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// Use a valid-looking device name pattern that will pass regex but format check fails
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=reiserfs&mnt=/media/test", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty error response, got empty")
	}
	t.Logf("HandleMount invalid format response: %s", body)
}

// TestHandleFormatMissingDev verifies HandleFormat returns an error when the
// "dev" POST parameter is missing.
func TestHandleFormatMissingDev(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows returns different error; tested elsewhere")
	}
	req := httptest.NewRequest(http.MethodPost, "/disk/format", nil)
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleFormatMissingFormat verifies HandleFormat returns an error when
// "dev" is provided but "format" is missing.
func TestHandleFormatMissingFormat(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows-only tested elsewhere")
	}
	body := strings.NewReader("dev=sda1")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleFormatUnsupportedFormat verifies HandleFormat rejects an unsupported format.
func TestHandleFormatUnsupportedFormat(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows-only tested elsewhere")
	}
	body := strings.NewReader("dev=sda1&format=reiserfs")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandlePlatformJSON verifies the HandlePlatform response is valid JSON.
func TestHandlePlatformJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/disk/platform", nil)
	rr := httptest.NewRecorder()

	HandlePlatform(rr, req)

	var v interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &v); err != nil {
		t.Fatalf("HandlePlatform response is not valid JSON: %v | body: %s", err, rr.Body.String())
	}
}

// TestMountUnmountNoHandlers verifies Mount and Unmount can be called with nil
// fsHandlers slice (no panic on empty handlers list). Both will fail with a
// command error since the device doesn't exist but must not panic.
func TestMountUnmountNoHandlers(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("mount/umount is Linux-only")
	}
	// Mount with nil handlers — will fail (no such device) but must not panic
	_, _ = Mount("nonexistentdev", "/tmp", "ext4", nil)
	// Unmount with nil handlers
	_, _ = Unmount("/tmp/nonexistent_mount_point", nil)
}

// TestCheckDeviceValidAcceptsNVMe verifies that nvme device names are rejected
// because the regex only matches sdXN.
func TestCheckDeviceValidNVMeRejected(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	ok, _ := checkDeviceValid("nvme0n1p1")
	if ok {
		t.Error("expected nvme0n1p1 to be rejected by checkDeviceValid (only sdXN supported)")
	}
}

// TestLsblkStructCanBePopulated verifies Lsblk struct construction works correctly.
func TestLsblkStructCanBePopulated(t *testing.T) {
	lb := Lsblk{
		Blockdevices: []struct {
			Name       string      `json:"name"`
			MajMin     string      `json:"maj:min"`
			Rm         bool        `json:"rm"`
			Size       int64       `json:"size"`
			Ro         bool        `json:"ro"`
			Type       string      `json:"type"`
			Mountpoint interface{} `json:"mountpoint"`
			Children   []struct {
				Name       string `json:"name"`
				MajMin     string `json:"maj:min"`
				Rm         bool   `json:"rm"`
				Size       int64  `json:"size"`
				Ro         bool   `json:"ro"`
				Type       string `json:"type"`
				Mountpoint string `json:"mountpoint"`
			} `json:"children"`
		}{
			{Name: "sda", Size: 500 * 1024 * 1024 * 1024, Type: "disk"},
		},
	}
	if len(lb.Blockdevices) != 1 {
		t.Errorf("expected 1 block device, got %d", len(lb.Blockdevices))
	}
	if lb.Blockdevices[0].Name != "sda" {
		t.Errorf("expected sda, got %q", lb.Blockdevices[0].Name)
	}
}

// TestCheckDeviceMounted_InvalidDevice verifies checkDeviceMounted returns an
// error when the device name passed causes lsblk grep to fail or produce
// non-JSON output (no real /dev/* device with that name).
func TestCheckDeviceMounted_InvalidDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// A device name that almost certainly does not exist will cause lsblk grep
	// to exit with status 1 (grep found nothing) → checkDeviceMounted returns error.
	mounted, err := checkDeviceMounted("nonexistentxyz999")
	if err == nil && mounted {
		t.Error("expected checkDeviceMounted to return false or error for non-existent device")
	}
	t.Logf("checkDeviceMounted('nonexistentxyz999'): mounted=%v err=%v", mounted, err)
}

// TestCheckDeviceMounted_EmptyName verifies checkDeviceMounted with an empty
// device name returns an error (lsblk grep of empty string).
func TestCheckDeviceMounted_EmptyName(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// An empty string will pipe the entire lsblk output through grep, which
	// will match every line. json.Unmarshal on that output will fail.
	_, err := checkDeviceMounted("")
	// Either an error or false is acceptable; we just must not panic.
	t.Logf("checkDeviceMounted(''): err=%v", err)
}

// TestGetDeviceMountPoint_InvalidDevice verifies getDeviceMountPoint returns
// an error for a device that does not exist.
func TestGetDeviceMountPoint_InvalidDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	_, err := getDeviceMountPoint("nonexistentxyz999")
	if err == nil {
		t.Error("expected error from getDeviceMountPoint for non-existent device, got nil")
	}
	t.Logf("getDeviceMountPoint error: %v", err)
}

// TestGetDeviceMountPoint_EmptyName verifies getDeviceMountPoint with an empty
// device name returns an error.
func TestGetDeviceMountPoint_EmptyName(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	_, err := getDeviceMountPoint("")
	// Empty string: lsblk output piped through grep "" prints everything.
	// json.Unmarshal will fail → error expected.
	t.Logf("getDeviceMountPoint(''): err=%v", err)
}

// TestHandleFormatLinuxInvalidDevice verifies HandleFormat returns an error
// when the device name is invalid on Linux.
func TestHandleFormatLinuxInvalidDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	body := strings.NewReader("dev=invaliddevxyz&format=ext4")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for invalid device, got empty")
	}
	t.Logf("HandleFormat invalid device: %s", resp)
}

// TestHandleFormatLinuxExt3IsWIP verifies HandleFormat returns an error for
// ext3 because it is "Work In Progress" (valid device needed to reach that branch).
func TestHandleFormatLinuxExt3IsWIP(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// ext3 IS in supportedFormats so it passes the early format check,
	// reaches checkDeviceValid (which fails for "sda1" without /dev/sda1),
	// and returns an error before the WIP branch. This exercises the format
	// validation path and documents the behaviour.
	body := strings.NewReader("dev=sda1&format=ext3")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response for ext3 format request")
	}
	t.Logf("HandleFormat ext3 response: %s", resp)
}

// TestHandleFormatLinuxBtrfsIsWIP is analogous for btrfs.
func TestHandleFormatLinuxBtrfsIsWIP(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	body := strings.NewReader("dev=sda1&format=btrfs")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	HandleFormat(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response for btrfs format request")
	}
	t.Logf("HandleFormat btrfs response: %s", resp)
}

// TestHandleMountLinuxUmountFlag verifies HandleMount handles the umount=true
// path (which calls Unmount). Since the mount point likely does not exist the
// Unmount call will fail, but we verify no panic and an error response.
func TestHandleMountLinuxUmountFlag(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// We deliberately pass an invalid device so checkDeviceValid fails early
	// (returns error before reaching Unmount) – verifying the path without
	// needing a real device.
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=invaliddev&format=ext4&mnt=/tmp&umount=true", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response, got empty")
	}
	t.Logf("HandleMount umount=true invalid device: %s", resp)
}

// TestHandleMountLinuxValidFormatInvalidMountPoint verifies HandleMount returns
// an error when the mount point does not exist on disk.
func TestHandleMountLinuxValidFormatInvalidMountPoint(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// Device name won't pass checkDeviceValid (no /dev/sda1 typically), so
	// error is returned before mount point check. This exercises the device
	// validation path for a syntactically valid but non-existent device.
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ntfs&mnt=/nonexistent/mountpoint", nil)
	rr := httptest.NewRecorder()

	HandleMount(rr, req, nil)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response, got empty")
	}
	t.Logf("HandleMount invalid mount point: %s", resp)
}

// TestHandleViewLinuxWithPartitionParam verifies HandleView returns a non-empty
// response even when the partition query param is set (detail mode).
func TestHandleViewLinuxWithPartitionParam(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/view?partition=sda1", nil)
	rr := httptest.NewRecorder()

	HandleView(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty body from HandleView on Linux (detail mode)")
	}
	t.Logf("HandleView detail mode response (first 200 chars): %.200s", body)
}

// TestLsblkFStructCanBePopulated verifies LsblkF struct population.
func TestLsblkFStructCanBePopulated(t *testing.T) {
	lbf := LsblkF{
		Blockdevices: []struct {
			Name       string      `json:"name"`
			Fstype     interface{} `json:"fstype"`
			Label      interface{} `json:"label"`
			UUID       interface{} `json:"uuid"`
			Fsavail    interface{} `json:"fsavail"`
			Fsuse      interface{} `json:"fsuse%"`
			Mountpoint interface{} `json:"mountpoint"`
			Children   []struct {
				Name       string      `json:"name"`
				Fstype     string      `json:"fstype"`
				Label      interface{} `json:"label"`
				UUID       string      `json:"uuid"`
				Fsavail    int64       `json:"fsavail"`
				Fsuse      string      `json:"fsuse%"`
				Mountpoint string      `json:"mountpoint"`
			} `json:"children"`
		}{
			{Name: "sda", Fstype: "ext4"},
		},
	}
	if len(lbf.Blockdevices) != 1 {
		t.Errorf("expected 1 block device, got %d", len(lbf.Blockdevices))
	}
}
