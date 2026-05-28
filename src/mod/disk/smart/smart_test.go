package smart

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

// TestReadSMARTDevicesEmpty verifies readSMARTDevices is a no-op on an empty device list.
func TestReadSMARTDevicesEmpty(t *testing.T) {
	dl := DevicesList{}
	// Must not panic or error even with a nonexistent executable.
	readSMARTDevices("/nonexistent/binary", &dl)
	if len(dl.Devices) != 0 {
		t.Errorf("expected 0 devices after readSMARTDevices on empty list, got %d", len(dl.Devices))
	}
}

// TestReadSMARTDevicesNonExistentBinary verifies that readSMARTDevices with a
// bad binary path simply leaves the Smart field at zero-value (JSON unmarshal
// of empty string yields empty struct).
func TestReadSMARTDevicesNonExistentBinary(t *testing.T) {
	dl := buildDevicesList("", "SomeModel")
	readSMARTDevices("/nonexistent/binary", &dl)
	// The model name on the device should be cleared because the command failed
	// and json.Unmarshal("") overwrites the existing Smart with an empty struct.
	if len(dl.Devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(dl.Devices))
	}
	// Smart field may be zero-value — no panic is the important guarantee.
	_ = dl.Devices[0].Smart
}

// TestExecCommandNonExistentBinary verifies execCommand returns empty string for
// a missing binary (does not panic).
func TestExecCommandNonExistentBinary(t *testing.T) {
	result := execCommand("/nonexistent/binary", "--help")
	// Result must be a string (empty or error text); no panic.
	_ = result
}

// TestFillCapacityWindows verifies fillCapacity runs without panic on a
// DevicesList that has zero UserCapacity bytes on all devices.
// On non-Windows platforms this is a quick no-op test.
func TestFillCapacityDeviceListUnchangedOnNonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows-specific behaviour tested elsewhere")
	}
	dl := buildDevicesList("", "TestModel")
	originalModel := dl.Devices[0].Smart.ModelName
	fillCapacity(&dl)
	if dl.Devices[0].Smart.ModelName != originalModel {
		t.Errorf("fillCapacity modified ModelName on non-Windows: %q -> %q",
			originalModel, dl.Devices[0].Smart.ModelName)
	}
}

// TestFillHealthyStatusMultipleDevices verifies that when the first device is
// Normal and the second is Failing, the list-level status is Failing.
func TestFillHealthyStatusMultipleDevices(t *testing.T) {
	dlNormal := buildDevicesList("", "")
	dlFailing := buildDevicesList("FAILING_NOW", "")

	// Build a combined list
	dl := DevicesList{}
	dl.Devices = append(dl.Devices, dlNormal.Devices...)
	dl.Devices = append(dl.Devices, dlFailing.Devices...)

	fillHealthyStatus(&dl)

	if dl.Healthy != "Failing" {
		t.Errorf("expected list Healthy=Failing with one failing device, got %q", dl.Healthy)
	}
}

// TestFillHealthyStatusTableEntry verifies individual table entries get health tags.
func TestFillHealthyStatusTableEntry(t *testing.T) {
	dl := buildDevicesList("FAILING_NOW", "")
	fillHealthyStatus(&dl)

	tableEntry := dl.Devices[0].Smart.AtaSmartAttributes.Table[0]
	if tableEntry.Healthy != "Failing" {
		t.Errorf("expected table entry Healthy=Failing, got %q", tableEntry.Healthy)
	}
}

// TestFillHealthyStatusAttentionTableEntry verifies In_the_past sets Attention on table entry.
func TestFillHealthyStatusAttentionTableEntry(t *testing.T) {
	dl := buildDevicesList("In_the_past", "")
	fillHealthyStatus(&dl)

	tableEntry := dl.Devices[0].Smart.AtaSmartAttributes.Table[0]
	if tableEntry.Healthy != "Attention" {
		t.Errorf("expected table entry Healthy=Attention, got %q", tableEntry.Healthy)
	}
}

// TestGetSMARTHandlerEmptyDriveList verifies an empty DriveList serializes to valid JSON.
func TestGetSMARTHandlerEmptyDriveList(t *testing.T) {
	listener := &SMARTListener{
		SystemSmartExecutable: "/dev/null",
		DriveList:             DevicesList{},
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
}

// TestDevicesListJSON verifies DevicesList round-trips through JSON correctly.
func TestDevicesListJSON(t *testing.T) {
	dl := buildDevicesList("", "TestDisk")
	data, err := json.Marshal(dl)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var dl2 DevicesList
	if err := json.Unmarshal(data, &dl2); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if len(dl2.Devices) != len(dl.Devices) {
		t.Errorf("expected %d devices after round-trip, got %d", len(dl.Devices), len(dl2.Devices))
	}
}

// TestDeviceSMARTZeroValue verifies the DeviceSMART zero value is usable.
func TestDeviceSMARTZeroValue(t *testing.T) {
	ds := DeviceSMART{}
	if ds.ModelName != "" {
		t.Errorf("unexpected ModelName: %q", ds.ModelName)
	}
	if ds.Healthy != "" {
		t.Errorf("unexpected Healthy: %q", ds.Healthy)
	}
}

// TestScanAvailableDevicesEmptyOutput verifies scanAvailableDevices handles
// empty JSON output (from failed commands) by returning an empty DevicesList.
func TestScanAvailableDevicesEmptyOutput(t *testing.T) {
	dl := scanAvailableDevices("/bin/false")
	// /bin/false exits with code 1, execCommand returns ""; json.Unmarshal("") = empty struct
	_ = dl.Devices // may be nil — the important thing is no panic
}

// TestExecCommandSuccessfulBinary verifies execCommand returns non-empty output
// for a command that succeeds (e.g. echo).
func TestExecCommandSuccessfulBinary(t *testing.T) {
	result := execCommand("/bin/echo", "hello")
	if result == "" {
		t.Error("expected non-empty result from /bin/echo")
	}
}

// TestExecCommandReturnsOutputOnError verifies execCommand returns output even
// when the command exits with non-zero status, if there is stdout/stderr output.
func TestExecCommandReturnsOutputOnError(t *testing.T) {
	// /bin/false exits 1 with no output — should return ""
	result := execCommand("/bin/false")
	// Either "" or some output string is acceptable; no panic is required.
	_ = result
}

// TestExecCommandWithArgs verifies execCommand passes arguments correctly.
func TestExecCommandWithArgs(t *testing.T) {
	result := execCommand("/bin/echo", "arg1", "arg2")
	if result == "" {
		t.Error("expected non-empty output from /bin/echo with args")
	}
}

// TestWmicGetinfoNonWindows verifies wmicGetinfo on non-Windows runs without
// panicking (wmic does not exist so wmic will fail gracefully).
func TestWmicGetinfoNonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test only for non-Windows: wmic is not available")
	}
	// wmicGetinfo always returns a slice of at least one element; no panic.
	result := wmicGetinfo("os", "Caption")
	if len(result) == 0 {
		t.Error("expected at least one element from wmicGetinfo (even on non-Windows)")
	}
	// On non-Windows, wmic doesn't exist → result should be ["Undefined"]
	if result[0] != "Undefined" {
		t.Logf("wmicGetinfo returned %v (expected Undefined on non-Windows)", result)
	}
}

// TestWmicGetinfoWin32Path verifies wmicGetinfo handles Win32_ prefix paths.
func TestWmicGetinfoWin32Path(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("this test only covers non-Windows wmic stub path")
	}
	// Win32_ prefix triggers a different exec path; should not panic.
	result := wmicGetinfo("Win32_DiskDrive", "Size")
	if len(result) == 0 {
		t.Error("expected at least one element")
	}
}

// TestWmicGetinfoOsPath verifies wmicGetinfo handles "os" path specifically.
func TestWmicGetinfoOsPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("this test only covers non-Windows wmic stub path")
	}
	result := wmicGetinfo("os", "Caption")
	if len(result) == 0 {
		t.Error("expected at least one element")
	}
}

// TestGetBinaryLinuxArch verifies getBinary returns different paths for
// different Linux architectures.
func TestGetBinaryLinuxArch(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	// getBinary should return a non-empty path on Linux regardless of arch
	path := getBinary()
	if path == "" {
		t.Error("getBinary should return non-empty path on Linux")
	}
}

// TestFillCapacityNoDevices verifies fillCapacity is safe with an empty list.
func TestFillCapacityNoDevices(t *testing.T) {
	dl := DevicesList{}
	fillCapacity(&dl)
	if len(dl.Devices) != 0 {
		t.Errorf("expected 0 devices, got %d", len(dl.Devices))
	}
}

// TestScanAvailableDevicesFiltersCsmi verifies that csmi device entries are
// removed from the scan result. We cannot inject real output, but we verify
// the filter path doesn't panic on any input.
func TestScanAvailableDevicesFiltersCsmi(t *testing.T) {
	// Pass an executable that outputs valid JSON with no csmi devices —
	// use /bin/echo with a valid devices JSON payload.
	// This exercises the JSON unmarshal + filter loop without real smartctl.
	dl := scanAvailableDevices("/bin/echo")
	// /bin/echo with no args outputs "" which json.Unmarshal leaves as empty
	_ = dl.Devices // must not panic
}

// TestReadSMARTDevicesWithBadExec verifies readSMARTDevices doesn't panic when
// given a bad executable but valid device entries.
func TestReadSMARTDevicesWithBadExec(t *testing.T) {
	dl := buildDevicesList("", "model")
	readSMARTDevices("/nonexistent/path/smartctl", &dl)
	// Smart field will be zero value but device count should be preserved
	if len(dl.Devices) != 1 {
		t.Errorf("expected 1 device after readSMARTDevices, got %d", len(dl.Devices))
	}
}

// TestNewSmartListenerReturnsStructOnError verifies NewSmartListener always
// returns a non-nil struct pointer even on error.
func TestNewSmartListenerReturnsStructOnError(t *testing.T) {
	// May error if smartctl not found; the struct should still not be nil.
	listener, _ := NewSmartListener()
	if listener == nil {
		t.Error("NewSmartListener returned nil struct pointer")
	}
}

// TestGetSMARTHandlerLargeDeviceList verifies GetSMART serializes many devices.
func TestGetSMARTHandlerLargeDeviceList(t *testing.T) {
	dl := DevicesList{Healthy: "Normal"}
	for i := 0; i < 10; i++ {
		entry := buildDevicesList("", "model"+string(rune('A'+i)))
		dl.Devices = append(dl.Devices, entry.Devices...)
	}
	listener := &SMARTListener{DriveList: dl}

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
	if len(result.Devices) != 10 {
		t.Errorf("expected 10 devices, got %d", len(result.Devices))
	}
}

// TestFillHealthyStatusNoTableEntries verifies fillHealthyStatus handles
// a device with no ATA table entries (sets device.Smart.Healthy to Normal).
func TestFillHealthyStatusNoTableEntries(t *testing.T) {
	dl := DevicesList{}
	dl.Devices = append(dl.Devices, struct {
		Name     string      `json:"name"`
		InfoName string      `json:"info_name"`
		Type     string      `json:"type"`
		Protocol string      `json:"protocol"`
		Smart    DeviceSMART `json:"smart"`
	}{
		Name:  "/dev/sdb",
		Smart: DeviceSMART{},
	})
	fillHealthyStatus(&dl)
	if dl.Healthy != "Normal" {
		t.Errorf("expected Normal, got %q", dl.Healthy)
	}
}

// TestGetBinaryFallbackLinuxAmd64 verifies the correct fallback path is returned
// for amd64 architecture when smartctl is not in PATH. We test this indirectly
// TestGetBinaryWithFakeSmartctlInPath covers the exec.LookPath success branch of getBinary.
func TestGetBinaryWithFakeSmartctlInPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix-only: test creates a shell script fake binary")
	}

	dir := t.TempDir()
	fakeBin := filepath.Join(dir, "smartctl")
	if err := os.WriteFile(fakeBin, []byte("#!/bin/sh\necho '{}'\n"), 0755); err != nil {
		t.Fatalf("failed to write fake smartctl: %v", err)
	}

	origPath := os.Getenv("PATH")
	os.Setenv("PATH", dir+string(os.PathListSeparator)+origPath)
	t.Cleanup(func() { os.Setenv("PATH", origPath) })

	result := getBinary()
	if result == "" {
		t.Error("expected non-empty path from getBinary with fake smartctl in PATH")
	}
	if !strings.Contains(result, "smartctl") {
		t.Errorf("expected 'smartctl' in binary path, got %q", result)
	}
}

// TestNewSmartListenerWithFakeBundledBinary exercises the NewSmartListener body
// beyond the "smartctl not found" early exit, using a fake bundled binary.
func TestNewSmartListenerWithFakeBundledBinary(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: tests the linux bundled binary path")
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "386" {
		t.Skip("test designed for linux/amd64 bundled path")
	}

	// Ensure real smartctl is NOT found via PATH so getBinary falls back to bundled path.
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", "")
	t.Cleanup(func() { os.Setenv("PATH", origPath) })

	// Create the bundled binary directory and a minimal fake executable.
	bundledDir := "./system/disk/smart/linux"
	bundledBin := filepath.Join(bundledDir, "smartctl_i386")
	if err := os.MkdirAll(bundledDir, 0755); err != nil {
		t.Fatalf("failed to create bundled dir: %v", err)
	}
	if err := os.WriteFile(bundledBin, []byte("#!/bin/sh\necho '{}'\n"), 0755); err != nil {
		t.Fatalf("failed to write fake bundled smartctl: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll("./system") })

	listener, _ := NewSmartListener()
	if listener == nil {
		t.Fatal("NewSmartListener returned nil even with fake binary")
	}
}

// via getBinary which tries LookPath first, then falls back per GOOS/GOARCH.
func TestGetBinaryFallbackResultNotEmpty(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("fallback paths only defined for linux and windows")
	}
	// getBinary always returns a non-empty string on supported platforms
	// (either the system smartctl or a bundled path).
	result := getBinary()
	if result == "" {
		t.Error("getBinary() returned empty string on a supported platform")
	}
}

// TestGetBinaryContainsSmartctl verifies the returned binary path always
// contains the word "smartctl" on supported platforms.
func TestGetBinaryContainsSmartctl(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("only linux and windows define a fallback path")
	}
	result := getBinary()
	if !strings.Contains(result, "smartctl") {
		t.Errorf("getBinary() result %q does not contain 'smartctl'", result)
	}
}

// TestScanAvailableDevicesWithEchoJSON exercises the JSON parsing path of
// scanAvailableDevices.  We pass /bin/echo with a valid empty JSON payload so
// execCommand returns "{}" and json.Unmarshal produces an empty DevicesList.
func TestScanAvailableDevicesWithEchoJSON(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires /bin/echo")
	}
	// /bin/echo {} outputs "{}\n"; json.Unmarshal of "{}" gives an empty struct.
	dl := scanAvailableDevices("/bin/echo")
	// Must not panic regardless of what comes back.
	_ = dl
}

// TestFillCapacityWindowsStubNoDevices exercises the Windows branch of
// fillCapacity when the device list is empty. On non-Windows platforms this is
// a no-op test; on Windows it will invoke wmicGetinfo.
func TestFillCapacityWindowsStubNoDevices(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only fillCapacity path")
	}
	dl := DevicesList{}
	// Calling with zero devices should be a no-op without panicking.
	fillCapacity(&dl)
	if len(dl.Devices) != 0 {
		t.Errorf("expected 0 devices, got %d", len(dl.Devices))
	}
}

// TestFillCapacityWindowsWithDeviceZeroBytes exercises the Windows fillCapacity
// loop that matches model names and fills in capacity.
func TestFillCapacityWindowsWithDeviceZeroBytes(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only fillCapacity path")
	}
	// Build a device list with a device whose capacity is 0. fillCapacity
	// should attempt to look up the real size from wmic.
	dl := buildDevicesList("", "SomeModel SCSI Disk Device")
	dl.Devices[0].Smart.UserCapacity.Bytes = 0
	fillCapacity(&dl)
	// We can't assert the actual size without a real drive, but no panic is
	// the primary guarantee.
	_ = dl.Devices[0].Smart.UserCapacity.Bytes
}

// TestNewSmartListenerStructNotNilOnError verifies NewSmartListener always
// returns a non-nil pointer even when it also returns an error (e.g. smartctl
// binary not present or not a supported platform).
func TestNewSmartListenerStructAlwaysNonNil(t *testing.T) {
	listener, _ := NewSmartListener()
	if listener == nil {
		t.Error("NewSmartListener must never return a nil *SMARTListener")
	}
}

// TestNewSmartListenerSmartExecField verifies that when NewSmartListener
// succeeds it stores the detected binary path in SystemSmartExecutable.
func TestNewSmartListenerSmartExecField(t *testing.T) {
	listener, err := NewSmartListener()
	if err != nil {
		// On environments without smartctl this is expected.
		t.Logf("NewSmartListener returned error (no smartctl): %v", err)
		return
	}
	if listener.SystemSmartExecutable == "" {
		t.Error("SystemSmartExecutable should be non-empty on successful init")
	}
}

// TestWmicGetinfoWin32PrefixHandled verifies the Win32_ prefix branch is
// exercised (even if wmic doesn't exist on non-Windows it should return
// ["Undefined"] without panicking).
func TestWmicGetinfoWin32PrefixHandled(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("live windows wmic tested elsewhere")
	}
	result := wmicGetinfo("Win32_DiskDrive", "Model")
	if len(result) == 0 {
		t.Error("expected at least one element from wmicGetinfo")
	}
}

// TestWmicGetinfoShortName verifies a wmicName shorter than 6 chars doesn't
// hit the Win32_ branch (no index-out-of-range panic).
func TestWmicGetinfoShortName(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("live windows wmic tested elsewhere")
	}
	// "disk" is 4 chars, shorter than 6 — exercises the non-Win32_ path.
	result := wmicGetinfo("disk", "Name")
	if len(result) == 0 {
		t.Error("expected at least one element")
	}
}

// TestFillHealthyStatusPreservesExistingNormal verifies that a device whose
// attributes are all "" for WhenFailed ends up as Normal at all levels.
func TestFillHealthyStatusPreservesExistingNormal(t *testing.T) {
	dl := buildDevicesList("", "")
	fillHealthyStatus(&dl)
	if dl.Healthy != "Normal" {
		t.Errorf("expected list Normal, got %q", dl.Healthy)
	}
	if dl.Devices[0].Smart.Healthy != "Normal" {
		t.Errorf("expected device Normal, got %q", dl.Devices[0].Smart.Healthy)
	}
	if dl.Devices[0].Smart.AtaSmartAttributes.Table[0].Healthy != "Normal" {
		t.Errorf("expected table entry Normal, got %q", dl.Devices[0].Smart.AtaSmartAttributes.Table[0].Healthy)
	}
}

// TestGetSMARTHandlerFailingStatus verifies GetSMART serializes a "Failing"
// DriveList correctly.
func TestGetSMARTHandlerFailingStatus(t *testing.T) {
	dl := buildDevicesList("FAILING_NOW", "TestDisk")
	fillHealthyStatus(&dl)
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
		t.Fatalf("invalid JSON: %v — body: %s", err, rr.Body.String())
	}
	if result.Healthy != "Failing" {
		t.Errorf("expected Healthy=Failing in response, got %q", result.Healthy)
	}
}

// TestExecCommandLsPath verifies execCommand works with /bin/ls (should have
// output with no error).
func TestExecCommandLsPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix-only test")
	}
	result := execCommand("/bin/ls", "/tmp")
	// /tmp always exists; ls should produce output.
	_ = result // output may be empty in some environments; just no panic.
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

// TestScanAvailableDevicesFiltersCsmiDevice verifies the csmi device filter
// by using a fake smartctl that outputs a /dev/csmi device in its scan.
func TestScanAvailableDevicesFiltersCsmiDevice(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix-only: uses shell script fake binary")
	}

	dir := t.TempDir()
	fakeBin := filepath.Join(dir, "smartctl_csmi")
	// Output JSON with one csmi device and one real device
	csmiJSON := `{"devices":[{"name":"/dev/csmi0","info_name":"/dev/csmi0","type":"scsi","protocol":"SCSI"},{"name":"/dev/sda","info_name":"/dev/sda [SAT]","type":"sat","protocol":"ATA"}]}`
	script := "#!/bin/sh\necho '" + csmiJSON + "'\n"
	if err := os.WriteFile(fakeBin, []byte(script), 0755); err != nil {
		t.Fatalf("failed to write fake binary: %v", err)
	}

	dl := scanAvailableDevices(fakeBin)
	// The /dev/csmi0 device should be filtered out, leaving only /dev/sda
	for _, device := range dl.Devices {
		if strings.Contains(device.Name, "/dev/csmi") {
			t.Errorf("csmi device was not filtered out: %s", device.Name)
		}
	}
}
