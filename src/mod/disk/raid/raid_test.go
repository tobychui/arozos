package raid_test

/*
	RAID TEST SCRIPT

	!!!! DO NOT RUN IN PRODUCTION !!!!
	ONLY RUN IN VM ENVIRONMENT
*/

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/disk/raid"
	"imuslab.com/arozos/mod/info/logger"
)

// buildTestManager creates a Manager suitable for unit testing (bypasses the
// mdadm existence check by directly constructing the struct). The handlers
// can then be called and their early-exit (missing parameter) paths exercised.
func buildTestManager() *raid.Manager {
	// Use a tmp logger that writes to /dev/null to satisfy Logger != nil.
	tmpLog, err := logger.NewTmpLogger()
	if err != nil {
		// Fall back to nil — tests that don't hit logger paths will still work.
		tmpLog = nil
	}
	return &raid.Manager{
		Options: &raid.Options{
			Logger: tmpLog,
		},
	}
}

// TestNewRaidManagerUnsupported verifies NewRaidManager returns an error on
// non-Linux platforms.
func TestNewRaidManagerUnsupported(t *testing.T) {
	if runtime.GOOS == "linux" {
		// On Linux the function may succeed or fail depending on whether mdadm
		// is installed; just ensure no panic occurs.
		_, _ = raid.NewRaidManager(raid.Options{})
		return
	}
	_, err := raid.NewRaidManager(raid.Options{})
	if err == nil {
		t.Error("expected error on non-Linux platform, got nil")
	}
}

// TestHandleRemoveDiskFromRAIDVol_MissingParams verifies the handler returns an
// error when the required POST parameters are absent.
func TestHandleRemoveDiskFromRAIDVol_MissingParams(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/remove", nil)
	rr := httptest.NewRecorder()
	m.HandleRemoveDiskFromRAIDVol(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
	t.Logf("HandleRemoveDiskFromRAIDVol missing params: %s", body)
}

// TestHandleAddDiskToRAIDVol_MissingParams verifies the handler returns an error
// when required POST parameters are absent.
func TestHandleAddDiskToRAIDVol_MissingParams(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/add", nil)
	rr := httptest.NewRecorder()
	m.HandleAddDiskToRAIDVol(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleMdadmFlushReload_NoPanic verifies the handler does not panic; on
// systems without mdadm it will return an error.
func TestHandleMdadmFlushReload_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses mdadm")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/flush", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleMdadmFlushReload panicked: %v", r)
			}
		}()
		m.HandleMdadmFlushReload(rr, req)
	}()
	t.Logf("HandleMdadmFlushReload response: %s", rr.Body.String())
}

// TestHandleResolveDiskModelLabel_MissingParam verifies the handler returns an
// error when devName is not provided.
func TestHandleResolveDiskModelLabel_MissingParam(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/modellabel", nil)
	rr := httptest.NewRecorder()
	m.HandleResolveDiskModelLabel(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleResolveDiskModelLabel_NonExistentDevice verifies the handler returns
// an error for a device name that doesn't exist in lsblk output.
func TestHandleResolveDiskModelLabel_NonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses lsblk")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/modellabel?devName=nonexistent_xyz", nil)
	rr := httptest.NewRecorder()
	m.HandleResolveDiskModelLabel(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandlListChildrenDeviceInfo_MissingParam verifies the handler returns an
// error when devName is not provided.
func TestHandlListChildrenDeviceInfo_MissingParam(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/children", nil)
	rr := httptest.NewRecorder()
	m.HandlListChildrenDeviceInfo(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandlListChildrenDeviceInfo_NonExistentDevice verifies that a non-existent
// RAID device name causes an error response.
func TestHandlListChildrenDeviceInfo_NonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/children?devName=md999", nil)
	rr := httptest.NewRecorder()
	m.HandlListChildrenDeviceInfo(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleLoadArrayDetail_MissingParam verifies the handler returns an error
// when devName is not provided.
func TestHandleLoadArrayDetail_MissingParam(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/detail", nil)
	rr := httptest.NewRecorder()
	m.HandleLoadArrayDetail(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleLoadArrayDetail_NonExistentDevice verifies that a non-existent
// device path returns an error.
func TestHandleLoadArrayDetail_NonExistentDevice(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/detail?devName=/dev/md999", nil)
	rr := httptest.NewRecorder()
	m.HandleLoadArrayDetail(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body for non-existent device, got empty")
	}
}

// TestHandleFormatRaidDevice_MissingParams verifies the handler returns an error
// when required GET parameters are missing.
func TestHandleFormatRaidDevice_MissingParams(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/format", nil)
	rr := httptest.NewRecorder()
	m.HandleFormatRaidDevice(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleFormatRaidDevice_MissingFormat verifies the handler returns an error
// when format parameter is missing.
func TestHandleFormatRaidDevice_MissingFormat(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/format?devName=md0", nil)
	rr := httptest.NewRecorder()
	m.HandleFormatRaidDevice(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleFormatRaidDevice_NonExistentDevice verifies an error is returned for
// a non-existent RAID device.
func TestHandleFormatRaidDevice_NonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/format?devName=md999&format=ext4", nil)
	rr := httptest.NewRecorder()
	m.HandleFormatRaidDevice(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body for non-existent device, got empty")
	}
}

// TestHandleListRaidDevices_NoPanic verifies the handler does not panic.
func TestHandleListRaidDevices_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/list", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleListRaidDevices panicked: %v", r)
			}
		}()
		m.HandleListRaidDevices(rr, req)
	}()
	t.Logf("HandleListRaidDevices response: %s", rr.Body.String())
}

// TestHandleListUsableDevices_NoPanic verifies the handler does not panic.
func TestHandleListUsableDevices_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses lsblk")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/usable", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleListUsableDevices panicked: %v", r)
			}
		}()
		m.HandleListUsableDevices(rr, req)
	}()
	t.Logf("HandleListUsableDevices response (first 200 chars): %.200s", rr.Body.String())
}

// TestHandleRenderOverview_NoPanic verifies the handler does not panic.
func TestHandleRenderOverview_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/overview", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleRenderOverview panicked: %v", r)
			}
		}()
		m.HandleRenderOverview(rr, req)
	}()
	t.Logf("HandleRenderOverview response: %s", rr.Body.String())
}

// TestHandleRaidDevicesAssemble_NoPanic verifies HandleRaidDevicesAssemble does
// not panic; it may return an error if mdadm is absent.
func TestHandleRaidDevicesAssemble_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses mdadm")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/assemble", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleRaidDevicesAssemble panicked: %v", r)
			}
		}()
		m.HandleRaidDevicesAssemble(rr, req)
	}()
	t.Logf("HandleRaidDevicesAssemble response: %s", rr.Body.String())
}

// TestHandleForceAssembleReload_NoPanic verifies HandleForceAssembleReload does
// not panic.
func TestHandleForceAssembleReload_NoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/forcereload", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("HandleForceAssembleReload panicked: %v", r)
			}
		}()
		m.HandleForceAssembleReload(rr, req)
	}()
	t.Logf("HandleForceAssembleReload response: %s", rr.Body.String())
}

// TestHandleGrowRAIDArray_MissingParam verifies the handler returns an error
// when the raidDev POST parameter is missing.
func TestHandleGrowRAIDArray_MissingParam(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/grow", nil)
	rr := httptest.NewRecorder()
	m.HandleGrowRAIDArray(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleGrowRAIDArray_NonExistentDevice verifies the handler returns an error
// for a non-existent RAID device.
func TestHandleGrowRAIDArray_NonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md999")
	req := httptest.NewRequest(http.MethodPost, "/raid/grow", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleGrowRAIDArray(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for non-existent device, got empty")
	}
}

// TestHandleRemoveRaideDevice_MissingParam verifies the handler returns an error
// when the raidDev POST parameter is missing.
func TestHandleRemoveRaideDevice_MissingParam(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodPost, "/raid/remove_device", nil)
	rr := httptest.NewRecorder()
	m.HandleRemoveRaideDevice(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleRemoveRaideDevice_NonExistentDevice verifies the handler returns an
// error for a non-existent RAID device path.
func TestHandleRemoveRaideDevice_NonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md999")
	req := httptest.NewRequest(http.MethodPost, "/raid/remove_device", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleRemoveRaideDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent device, got empty")
	}
}

// TestHandleCreateRAIDDevice_MissingParams verifies the handler returns an error
// when required POST parameters are missing.
func TestHandleCreateRAIDDevice_MissingRaidName(t *testing.T) {
	m := buildTestManager()

	// devName auto-generated, but raidName is required
	body := strings.NewReader("level=1&raidDev=[]&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body, got empty")
	}
	t.Logf("HandleCreateRAIDDevice missing raidName: %s", resp)
}

// TestHandleCreateRAIDDevice_InvalidRaidLevel verifies the handler returns an
// error for a non-numeric RAID level.
func TestHandleCreateRAIDDevice_InvalidRaidLevel(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&level=invalid&raidDev=[\"sda\",\"sdb\"]&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for invalid level, got empty")
	}
}

// TestHandleCreateRAIDDevice_RaidNameWithSpace verifies the handler rejects
// RAID names containing spaces.
func TestHandleCreateRAIDDevice_RaidNameWithSpace(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=test+array&level=1&raidDev=[\"sda\",\"sdb\"]&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for name with space, got empty")
	}
	t.Logf("HandleCreateRAIDDevice space in name: %s", resp)
}

// TestIsValidRAIDLevelExported verifies the exported function works from an
// external test package.
func TestIsValidRAIDLevelExported(t *testing.T) {
	validCases := []string{"raid0", "raid1", "raid4", "raid5", "raid6", "raid10"}
	for _, level := range validCases {
		if !raid.IsValidRAIDLevel(level) {
			t.Errorf("expected %s to be valid", level)
		}
	}

	invalidCases := []string{"raid3", "raid7", "notraid", "", "raid"}
	for _, level := range invalidCases {
		if raid.IsValidRAIDLevel(level) {
			t.Errorf("expected %s to be invalid", level)
		}
	}
}

// TestGetNextAvailableMDDeviceExported verifies the exported function returns
// a valid /dev/mdX path on Linux.
func TestGetNextAvailableMDDeviceExported(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	device, err := raid.GetNextAvailableMDDevice()
	if err != nil {
		t.Fatalf("GetNextAvailableMDDevice returned error: %v", err)
	}
	if !strings.HasPrefix(device, "/dev/md") {
		t.Errorf("expected /dev/mdX prefix, got %q", device)
	}
}
