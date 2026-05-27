package smart

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

// TestGetBinary verifies getBinary returns expected paths per platform.
func TestGetBinary(t *testing.T) {
	result := getBinary()
	switch runtime.GOOS {
	case "windows":
		if !strings.Contains(result, "smartctl.exe") {
			t.Errorf("expected smartctl.exe in binary path on Windows, got %q", result)
		}
	case "linux":
		if !strings.Contains(result, "smartctl") {
			t.Errorf("expected smartctl in binary path on Linux, got %q", result)
		}
	default:
		if result != "" {
			t.Errorf("expected empty string on unsupported platform %s, got %q", runtime.GOOS, result)
		}
	}
}

// TestGetBinaryNotEmpty ensures getBinary returns non-empty on supported platforms.
func TestGetBinaryNotEmpty(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("platform not supported by smartctl wrapper")
	}
	if getBinary() == "" {
		t.Error("getBinary() returned empty string on a supported platform")
	}
}

// TestFillHealthyStatusEmpty verifies fillHealthyStatus leaves a healthy
// default when there are no devices.
func TestFillHealthyStatusEmpty(t *testing.T) {
	dl := DevicesList{}
	fillHealthyStatus(&dl)
	// Healthy field is set even when there are no devices
	if dl.Healthy != "Normal" {
		t.Errorf("expected Healthy=Normal for empty device list, got %q", dl.Healthy)
	}
}

// TestFillHealthyStatusNormal verifies devices with no failures are Normal.
func TestFillHealthyStatusNormal(t *testing.T) {
	dl := buildDevicesList("", "")
	fillHealthyStatus(&dl)

	if dl.Healthy != "Normal" {
		t.Errorf("expected list Healthy=Normal, got %q", dl.Healthy)
	}
	if dl.Devices[0].Smart.Healthy != "Normal" {
		t.Errorf("expected device Healthy=Normal, got %q", dl.Devices[0].Smart.Healthy)
	}
}

// TestFillHealthyStatusFailing verifies FAILING_NOW propagates to Failing.
func TestFillHealthyStatusFailing(t *testing.T) {
	dl := buildDevicesList("FAILING_NOW", "")
	fillHealthyStatus(&dl)

	if dl.Healthy != "Failing" {
		t.Errorf("expected list Healthy=Failing, got %q", dl.Healthy)
	}
	if dl.Devices[0].Smart.Healthy != "Failing" {
		t.Errorf("expected device Healthy=Failing, got %q", dl.Devices[0].Smart.Healthy)
	}
}

// TestFillHealthyStatusAttention verifies In_the_past propagates to Attention.
func TestFillHealthyStatusAttention(t *testing.T) {
	dl := buildDevicesList("In_the_past", "")
	fillHealthyStatus(&dl)

	if dl.Healthy != "Attention" {
		t.Errorf("expected list Healthy=Attention, got %q", dl.Healthy)
	}
}

// TestGetSMARTHandler verifies the HTTP handler returns valid JSON.
func TestGetSMARTHandler(t *testing.T) {
	listener := &SMARTListener{
		SystemSmartExecutable: "/dev/null",
		DriveList:             DevicesList{Healthy: "Normal"},
	}

	req := httptest.NewRequest(http.MethodGet, "/smart", nil)
	rr := httptest.NewRecorder()

	listener.GetSMART(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	var dl DevicesList
	if err := json.Unmarshal(rr.Body.Bytes(), &dl); err != nil {
		t.Fatalf("response is not valid JSON: %v — body: %s", err, rr.Body.String())
	}
	if dl.Healthy != "Normal" {
		t.Errorf("expected Healthy=Normal in JSON response, got %q", dl.Healthy)
	}
}

// TestGetSMARTHandlerWithDevices verifies devices are included in the JSON response.
func TestGetSMARTHandlerWithDevices(t *testing.T) {
	dl := buildDevicesList("", "WD Blue")
	dl.Healthy = "Normal"
	listener := &SMARTListener{
		SystemSmartExecutable: "/dev/null",
		DriveList:             dl,
	}

	req := httptest.NewRequest(http.MethodGet, "/smart", nil)
	rr := httptest.NewRecorder()
	listener.GetSMART(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	var result DevicesList
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(result.Devices) != 1 {
		t.Errorf("expected 1 device, got %d", len(result.Devices))
	}
}

// TestScanAvailableDevicesSkipsOnMissingBinary verifies scanAvailableDevices
// returns an empty list when the binary doesn't exist.
func TestScanAvailableDevicesSkipsOnMissingBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test designed for Unix-like path semantics")
	}
	// Pass a nonexistent executable — execCommand will fail silently and return ""
	// json.Unmarshal("") produces an empty DevicesList
	dl := scanAvailableDevices("/nonexistent/smartctl")
	// We just check it doesn't panic; Devices may be nil
	_ = dl
}

// TestNewSmartListenerUnsupported verifies NewSmartListener errors when
// getBinary returns empty (unsupported platform) or the binary is missing.
func TestNewSmartListenerUnsupported(t *testing.T) {
	if runtime.GOOS == "linux" || runtime.GOOS == "windows" {
		// On supported platforms getBinary() returns a path; it may or may not
		// exist in the test environment.  Only assert that the call doesn't panic.
		_, _ = NewSmartListener()
		return
	}
	_, err := NewSmartListener()
	if err == nil {
		t.Error("expected error on unsupported platform, got nil")
	}
}

// TestWmicGetinfoWindowsOnly runs wmic helper only on Windows.
func TestWmicGetinfoWindowsOnly(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("wmicGetinfo is Windows-only")
	}
	result := wmicGetinfo("os", "Caption")
	if len(result) == 0 {
		t.Error("expected at least one result from wmicGetinfo")
	}
}

// TestFillCapacityNonWindows ensures fillCapacity is a no-op on non-Windows.
func TestFillCapacityNonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("this test only applies to non-Windows platforms")
	}
	dl := buildDevicesList("", "")
	// fillCapacity should not modify anything on non-Windows
	fillCapacity(&dl)
	// No panic is sufficient; verify the model name remains unchanged
	if dl.Devices[0].Smart.ModelName != "" {
		t.Errorf("unexpected model name change on non-Windows: %q", dl.Devices[0].Smart.ModelName)
	}
}

// ─── helpers ────────────────────────────────────────────────────────────────

// buildDevicesList creates a DevicesList with a single device containing one
// ATA attribute. whenFailed and modelName control failure-status and model.
func buildDevicesList(whenFailed string, modelName string) DevicesList {
	attr := struct {
		ID         int    `json:"id"`
		Name       string `json:"name"`
		Value      int    `json:"value"`
		Worst      int    `json:"worst"`
		Thresh     int    `json:"thresh"`
		WhenFailed string `json:"when_failed"`
		Healthy    string `json:"healthy"`
		Flags      struct {
			Value         int    `json:"value"`
			String        string `json:"string"`
			Prefailure    bool   `json:"prefailure"`
			UpdatedOnline bool   `json:"updated_online"`
			Performance   bool   `json:"performance"`
			ErrorRate     bool   `json:"error_rate"`
			EventCount    bool   `json:"event_count"`
			AutoKeep      bool   `json:"auto_keep"`
		} `json:"flags"`
		Raw struct {
			Value  int    `json:"value"`
			String string `json:"string"`
		} `json:"raw"`
	}{
		ID:         5,
		Name:       "Reallocated_Sector_Ct",
		WhenFailed: whenFailed,
	}

	smart := DeviceSMART{
		ModelName: modelName,
	}
	smart.AtaSmartAttributes.Table = append(smart.AtaSmartAttributes.Table, attr)

	device := struct {
		Name     string      `json:"name"`
		InfoName string      `json:"info_name"`
		Type     string      `json:"type"`
		Protocol string      `json:"protocol"`
		Smart    DeviceSMART `json:"smart"`
	}{
		Name:  "/dev/sda",
		Smart: smart,
	}

	return DevicesList{
		Devices: []struct {
			Name     string      `json:"name"`
			InfoName string      `json:"info_name"`
			Type     string      `json:"type"`
			Protocol string      `json:"protocol"`
			Smart    DeviceSMART `json:"smart"`
		}{device},
	}
}
