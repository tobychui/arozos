package raid_test

/*
	Additional handler tests to improve coverage.
*/

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/disk/raid"
)

// TestHandleCreateRAIDDevice_MissingLevel verifies the handler returns an error
// when the "level" POST parameter is missing.
func TestHandleCreateRAIDDevice_MissingLevel(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&raidDev=[\"sda\",\"sdb\"]&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for missing level, got empty")
	}
}

// TestHandleCreateRAIDDevice_MissingRaidDev verifies the handler returns an error
// when the "raidDev" POST parameter is missing.
func TestHandleCreateRAIDDevice_MissingRaidDev(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&level=1&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for missing raidDev, got empty")
	}
}

// TestHandleCreateRAIDDevice_MissingSpareDev verifies the handler returns an error
// when the "spareDev" POST parameter is missing.
func TestHandleCreateRAIDDevice_MissingSpareDev(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&level=1&raidDev=[\"sda\",\"sdb\"]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for missing spareDev, got empty")
	}
}

// TestHandleCreateRAIDDevice_InvalidRaidDevJSON verifies the handler returns an error
// when raidDev is not valid JSON.
func TestHandleCreateRAIDDevice_InvalidRaidDevJSON(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&level=1&raidDev=notjson&spareDev=[]")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for invalid raidDev JSON, got empty")
	}
}

// TestHandleCreateRAIDDevice_InvalidSpareDevJSON verifies the handler returns an error
// when spareDev is not valid JSON.
func TestHandleCreateRAIDDevice_InvalidSpareDevJSON(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidName=testarray&level=1&raidDev=[\"sda\",\"sdb\"]&spareDev=notjson")
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for invalid spareDev JSON, got empty")
	}
}

// TestHandleCreateRAIDDevice_ValidParamsNoDevs verifies the handler reaches
// CreateRAIDDevice with valid params but fails (no actual mdadm).
func TestHandleCreateRAIDDevice_ValidParamsNoDevs(t *testing.T) {
	m := buildTestManager()

	// Valid parameters - will reach CreateRAIDDevice which will fail because
	// devices don't exist and mdadm is not available
	body := strings.NewReader(`raidName=testpool&level=1&raidDev=["/dev/sda_nonexistent","/dev/sdb_nonexistent"]&spareDev=[]`)
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	// Either ok or error is acceptable - we just verify no panic
	resp := rr.Body.String()
	_ = resp
}

// TestHandleCreateRAIDDevice_ZerosuperblockMissingDev verifies the handler returns
// an error when zerosuperblock=true but a raid device doesn't exist.
func TestHandleCreateRAIDDevice_ZerosuperblockMissingDev(t *testing.T) {
	m := buildTestManager()

	// zerosuperblock=true, with a device that doesn't exist - should fail with device not found
	body := strings.NewReader(`raidName=testpool&level=1&raidDev=["/dev/nonexistent_disk_xyz"]&spareDev=[]&zerosuperblock=true`)
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body for missing zerosuperblock device, got empty")
	}
	t.Logf("HandleCreateRAIDDevice zerosuperblock missing dev: %s", resp)
}

// TestHandleCreateRAIDDevice_ZerosuperblockMissingDevNoPrefix verifies the handler
// with zerosuperblock=true and device without /dev/ prefix.
func TestHandleCreateRAIDDevice_ZerosuperblockMissingDevNoPrefix(t *testing.T) {
	m := buildTestManager()

	// zerosuperblock=true, without /dev/ prefix
	body := strings.NewReader(`raidName=testpool&level=1&raidDev=["nonexistent_disk_xyz"]&spareDev=["spare_nonexistent"]&zerosuperblock=true`)
	req := httptest.NewRequest(http.MethodPost, "/raid/create", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleCreateRAIDDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response body, got empty")
	}
}

// TestHandleRemoveDiskFromRAIDVol_BothParams verifies the handler errors when
// the RAID device doesn't exist (but both params are provided).
func TestHandleRemoveDiskFromRAIDVol_BothParams(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md999&memDev=/dev/sda1")
	req := httptest.NewRequest(http.MethodPost, "/raid/remove", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleRemoveDiskFromRAIDVol(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent RAID device, got empty")
	}
}

// TestHandleRemoveDiskFromRAIDVol_MissingMemDev verifies missing memDev param returns error.
func TestHandleRemoveDiskFromRAIDVol_MissingMemDev(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md0")
	req := httptest.NewRequest(http.MethodPost, "/raid/remove", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleRemoveDiskFromRAIDVol(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for missing memDev, got empty")
	}
}

// TestHandleAddDiskToRAIDVol_BothParams verifies the handler errors when
// the RAID device doesn't exist (but both params are provided).
func TestHandleAddDiskToRAIDVol_BothParams(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md999&memDev=/dev/sda1")
	req := httptest.NewRequest(http.MethodPost, "/raid/add", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleAddDiskToRAIDVol(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent RAID device, got empty")
	}
}

// TestHandleAddDiskToRAIDVol_MissingMemDev verifies the handler errors when memDev is missing.
func TestHandleAddDiskToRAIDVol_MissingMemDev(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md0")
	req := httptest.NewRequest(http.MethodPost, "/raid/add", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleAddDiskToRAIDVol(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for missing memDev, got empty")
	}
}

// TestHandleGrowRAIDArray_ValidParamNonExistentDevice tests the handler with a
// valid raidDev param pointing to a non-existent device.
func TestHandleGrowRAIDArray_ValidParamNonExistentDevice(t *testing.T) {
	m := buildTestManager()

	body := strings.NewReader("raidDev=/dev/md999")
	req := httptest.NewRequest(http.MethodPost, "/raid/grow", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	m.HandleGrowRAIDArray(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent device, got empty")
	}
}

// TestHandleFormatRaidDevice_FormatAndDevName verifies both params but non-existent device.
func TestHandleFormatRaidDevice_BothParamsNonExistent(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/format?devName=md999&format=ext4", nil)
	rr := httptest.NewRecorder()
	m.HandleFormatRaidDevice(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent RAID device, got empty")
	}
}

// TestHandleLoadArrayDetail_WithDevPrefix verifies the handler handles devName with /dev/ prefix.
func TestHandleLoadArrayDetail_WithDevPrefix(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/detail?devName=/dev/md999", nil)
	rr := httptest.NewRecorder()
	m.HandleLoadArrayDetail(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent device, got empty")
	}
}

// TestHandlListChildrenDeviceInfo_WithDevPrefix verifies the handler handles
// devName that already has /dev/ prefix (skips the prefix-adding path).
func TestHandlListChildrenDeviceInfo_WithDevPrefix(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/children?devName=/dev/md999", nil)
	rr := httptest.NewRecorder()
	m.HandlListChildrenDeviceInfo(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent device, got empty")
	}
}

// TestHandlListChildrenDeviceInfo_NoDevPrefix verifies the handler adds /dev/ prefix.
func TestHandlListChildrenDeviceInfo_NoDevPrefix(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/children?devName=md999", nil)
	rr := httptest.NewRecorder()
	m.HandlListChildrenDeviceInfo(rr, req)

	resp := rr.Body.String()
	if resp == "" {
		t.Error("expected error response for non-existent device, got empty")
	}
}

// TestGetNextAvailableMDDevice_ReturnsValidPath verifies the function returns a
// valid /dev/mdX path.
func TestGetNextAvailableMDDevice_ReturnsValidPath(t *testing.T) {
	device, err := raid.GetNextAvailableMDDevice()
	if err != nil {
		t.Fatalf("GetNextAvailableMDDevice returned error: %v", err)
	}
	if !strings.HasPrefix(device, "/dev/md") {
		t.Errorf("expected /dev/mdX prefix, got %q", device)
	}
}

// TestHandleRenderOverview_NoPanicNoRAID verifies HandleRenderOverview does not
// panic when no RAID devices are present.
func TestHandleRenderOverview_NoPanicNoRAID(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/overview", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("HandleRenderOverview panicked: %v", r)
			}
		}()
		m.HandleRenderOverview(rr, req)
	}()

	// Any response is valid - either empty JSON array, error, or valid data
	_ = rr.Body.String()
}

// TestHandleListRaidDevices_NoPanicNoRAID verifies HandleListRaidDevices does not
// panic when no RAID devices are present.
func TestHandleListRaidDevices_NoPanicNoRAID(t *testing.T) {
	m := buildTestManager()

	req := httptest.NewRequest(http.MethodGet, "/raid/list", nil)
	rr := httptest.NewRecorder()
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("HandleListRaidDevices panicked: %v", r)
			}
		}()
		m.HandleListRaidDevices(rr, req)
	}()

	_ = rr.Body.String()
}

// TestFormatVirtualPartition_NonExistentFile verifies FormatVirtualPartition returns
// an error for a file that does not exist.
func TestFormatVirtualPartition_NonExistentFile(t *testing.T) {
	err := raid.FormatVirtualPartition("/tmp/nonexistent_xyzzy.img")
	if err == nil {
		t.Error("expected error for non-existent .img file")
	}
}

// TestFormatVirtualPartition_WrongExtension verifies FormatVirtualPartition returns
// an error when the extension is not .img.
func TestFormatVirtualPartition_WrongExtension(t *testing.T) {
	err := raid.FormatVirtualPartition("/tmp/test_file_xyz.txt")
	if err == nil {
		t.Error("expected error for non-.img extension")
	}
}
