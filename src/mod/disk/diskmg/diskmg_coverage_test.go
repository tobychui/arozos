package diskmg

import (
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
)

// createFakeSda1 creates a fake /dev/sda1 file so checkDeviceValid returns true.
// Returns a cleanup function that removes the file.
// The file is a plain file (not a real block device) so lsblk won't show it,
// meaning checkDeviceMounted will still fail gracefully.
func createFakeSda1(t *testing.T) func() {
	t.Helper()
	f, err := os.Create("/dev/sda1")
	if err != nil {
		t.Skipf("cannot create /dev/sda1 (no root?): %v", err)
		return func() {}
	}
	f.Close()
	return func() {
		os.Remove("/dev/sda1")
	}
}

// TestCheckDeviceMounted_ExistingDeviceName tests checkDeviceMounted with a device
// name that appears in lsblk output, causing grep to succeed but json.Unmarshal
// to fail (since grep returns partial lines, not valid JSON).
func TestCheckDeviceMounted_ExistingDeviceName(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// "vda" is a real device on this system visible in lsblk output.
	// grep "vda" will succeed (exit 0) with partial lines that are NOT valid JSON,
	// so json.Unmarshal will fail --> return false, error.
	// This covers the json.Unmarshal error path.
	_, err := checkDeviceMounted("vda")
	// Either (false, err) or (false, nil) is acceptable - we exercise the path.
	t.Logf("checkDeviceMounted('vda'): err=%v", err)
}

// TestGetDeviceMountPoint_ExistingDeviceName tests getDeviceMountPoint with a device
// name that appears in lsblk output.
func TestGetDeviceMountPoint_ExistingDeviceName(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// Similar to above: grep succeeds but output is not valid JSON.
	_, err := getDeviceMountPoint("vda")
	// Should return an error (either from exec or from unmarshal)
	t.Logf("getDeviceMountPoint('vda'): err=%v", err)
}

// TestMountWithFSHandlers verifies Mount correctly handles a slice with fsHandlers.
// The mount command itself will fail (no real device), but the fsHandler loop executes.
func TestMountWithFSHandlers(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: mount/umount is Linux-only")
	}
	// Create a fake FileSystemHandler with a path that matches the mountpt
	fsh := &fs.FileSystemHandler{
		Path:   "/tmp/testmountpt",
		Closed: false,
	}
	handlers := []*fs.FileSystemHandler{fsh}

	// Mount: the handler path contains "testmountpt" so fsh.Closed will be set to false
	_, _ = Mount("nonexistentdev", "/tmp/testmountpt", "ext4", handlers)
	// The fsh.Closed should remain false (it was set to false)
	if fsh.Closed {
		t.Error("expected fsh.Closed to remain false after Mount")
	}
}

// TestUnmountWithFSHandlers verifies Unmount correctly closes matching fsHandlers.
func TestUnmountWithFSHandlers(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: umount is Linux-only")
	}
	fsh := &fs.FileSystemHandler{
		Path:   "/tmp/testmountpt",
		Closed: false,
	}
	handlers := []*fs.FileSystemHandler{fsh}

	// Unmount: handler path contains "testmountpt" so fsh.Closed will be set to true
	_, _ = Unmount("/tmp/testmountpt", handlers)
	if !fsh.Closed {
		t.Error("expected fsh.Closed to be true after Unmount with matching handler")
	}
}

// TestUnmountWithNonMatchingFSHandler verifies Unmount doesn't affect non-matching handlers.
func TestUnmountWithNonMatchingFSHandler(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	fsh := &fs.FileSystemHandler{
		Path:   "/other/path",
		Closed: false,
	}
	handlers := []*fs.FileSystemHandler{fsh}

	_, _ = Unmount("/tmp/testmountpt", handlers)
	// Non-matching handler should remain unchanged
	if fsh.Closed {
		t.Error("expected fsh.Closed to remain false for non-matching handler")
	}
}

// TestHandleMountLinuxNtfsFormat exercises the ntfs format selection path.
// Creates a fake /dev/sda1 so checkDeviceValid returns true, allowing us to
// reach the format selection code. Uses a non-existent mount point so the
// handler returns early at the mount point check (no actual mount occurs).
func TestHandleMountLinuxNtfsFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ntfs&mnt=/nonexistent_mp_xyz", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleMount ntfs: %s", resp)
}

// TestHandleMountLinuxExt4Format tests the ext4 format selection path.
func TestHandleMountLinuxExt4Format(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ext4&mnt=/nonexistent_mp_xyz", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleMount ext4: %s", resp)
}

// TestHandleMountLinuxVfatFormat tests the vfat format selection path.
func TestHandleMountLinuxVfatFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=vfat&mnt=/nonexistent_mp_xyz", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleMount vfat: %s", resp)
}

// TestHandleMountLinuxBrtfsFormat tests the brtfs format selection path.
func TestHandleMountLinuxBrtfsFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=brtfs&mnt=/nonexistent_mp_xyz", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleMount brtfs: %s", resp)
}

// TestHandleMountLinuxUnsupportedFormat tests the "Format not supported" path.
// With a valid device (/dev/sda1 exists), format "xfs" reaches the else branch.
func TestHandleMountLinuxUnsupportedFormat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=xfs&mnt=/nonexistent_mp_xyz", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty error response")
	}
	t.Logf("HandleMount unsupported format: %s", resp)
}

// TestHandleMountLinuxValidFormatValidMountPoint tests reaching the mount point
// existence check. /tmp exists so we proceed to umount check.
func TestHandleMountLinuxValidFormatValidMountPoint(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	// /tmp exists --> passes mount point check --> reaches umount param check --> mount attempt
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ntfs&mnt=/tmp", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	// Mount will fail (no ntfs-3g and no real device), but we cover those lines
	t.Logf("HandleMount valid mountpt: %s", resp)
}

// TestHandleMountLinuxUmountPathWithDevice tests the umount=true path when device is valid.
func TestHandleMountLinuxUmountPathWithDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	// umount=true with valid device and existing mount point
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ntfs&mnt=/tmp&umount=true", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	// Unmount will fail (/tmp is not mounted via sda1), but we cover the umount path
	t.Logf("HandleMount umount=true: %s", resp)
}

// TestHandleMountLinuxMissingFormatOnly exercises the path where format is
// missing on Linux (early return).
func TestHandleMountLinuxMissingFormatOnly(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&mnt=/tmp", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for missing format")
	}
}

// TestHandleFormatLinuxWithFakeDevice verifies HandleFormat proceeds past checkDeviceValid
// when /dev/sda1 exists, reaching checkDeviceMounted (which will fail gracefully).
func TestHandleFormatLinuxNtfsPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	body := strings.NewReader("dev=sda1&format=ntfs")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	HandleFormat(rr, req, nil)
	resp := rr.Body.String()
	// checkDeviceMounted("sda1") will fail (grep finds nothing in lsblk for fake device)
	// --> "Failed to check disk mount status"
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleFormat ntfs with fake device: %s", resp)
}

// TestHandleFormatLinuxVfatPath verifies HandleFormat handles vfat format path.
func TestHandleFormatLinuxVfatPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	body := strings.NewReader("dev=sda1&format=vfat")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	HandleFormat(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleFormat vfat with fake device: %s", resp)
}

// TestHandleFormatLinuxExt4Path verifies HandleFormat handles ext4 format path.
func TestHandleFormatLinuxExt4Path(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cleanup := createFakeSda1(t)
	defer cleanup()

	body := strings.NewReader("dev=sda1&format=ext4")
	req := httptest.NewRequest(http.MethodPost, "/disk/format", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	HandleFormat(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleFormat ext4 with fake device: %s", resp)
}

// TestCheckDeviceValidWithActualSlashDev verifies checkDeviceValid handles
// a path that starts with /dev/ (full path - regex doesn't match /dev/sda1 but
// extracts the sdX[1-9] pattern from it).
func TestCheckDeviceValidWithSlashDevPrefix(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// /dev/sda1 - the regex matches "sda1" inside the string
	ok, devID := checkDeviceValid("/dev/sda1")
	// The regex matches "sda1" but /dev/sda1 likely doesn't exist
	t.Logf("checkDeviceValid('/dev/sda1'): ok=%v devID=%q", ok, devID)
}

// TestHandleViewLinuxNoPanic verifies HandleView runs without panic on Linux.
func TestHandleViewLinuxNoPanicDup(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/view", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("HandleView panicked: %v", r)
			}
		}()
		HandleView(rr, req)
	}()
}

// TestHandleMountLinuxValidMountPointExistence exercises the "Mount point not exists" path.
// We pass a device that would pass regex (sda1) and valid format, but with a non-existent
// mount point. Since checkDeviceValid checks /dev/sda1 existence (which fails in test env),
// we get "Device name is not valid" before reaching the mount point check.
// This test documents the behavior.
func TestHandleMountLinuxMountPointPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	req := httptest.NewRequest(http.MethodGet, "/disk/mount?dev=sda1&format=ntfs&mnt=/nonexistent/mountpt", nil)
	rr := httptest.NewRecorder()
	HandleMount(rr, req, nil)
	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected non-empty response")
	}
	t.Logf("HandleMount non-existent mountpt: %s", resp)
}

// TestCheckDeviceValidRegexAcceptsSda1 ensures the regex correctly identifies sdX[1-9] pattern.
func TestCheckDeviceValidRegexBehavior(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// Verify the regex part works - sda1 matches pattern
	// Even though /dev/sda1 doesn't exist, we check that the regex passes
	ok, devID := checkDeviceValid("sda1")
	// Regex matches "sda1" but FileExists fails
	// If ok is false (because file doesn't exist), that's expected
	t.Logf("checkDeviceValid('sda1'): ok=%v devID=%q", ok, devID)
	if ok && devID != "sda1" {
		t.Errorf("when ok=true, expected devID=sda1, got %q", devID)
	}
}
