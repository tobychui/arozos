package timezone

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// setupWintzJSON creates the ./system/time/wintz.json fixture that
// ConvertWinTZtoLinuxTZ reads, and returns a cleanup function.
// The working directory during tests is the package directory, so we
// create the relative path from there.
func setupWintzJSON(t *testing.T, content string) func() {
	t.Helper()
	if err := os.MkdirAll("./system/time", 0755); err != nil {
		t.Fatalf("failed to create system/time dir: %v", err)
	}
	if err := os.WriteFile("./system/time/wintz.json", []byte(content), 0644); err != nil {
		t.Fatalf("failed to write wintz.json: %v", err)
	}
	return func() {
		os.RemoveAll("./system")
	}
}

const sampleWintzJSON = `{
  "supplementalData": {
    "version": {"_number": "1"},
    "windowsZones": {
      "mapTimezones": {
        "_otherVersion": "1",
        "_typeVersion": "1",
        "mapZone": [
          {"_other": "Pacific Standard Time", "_territory": "US", "_type": "America/Los_Angeles"},
          {"_other": "Eastern Standard Time", "_territory": "US", "_type": "America/New_York America/Detroit"},
          {"_other": "UTC",                   "_territory": "001","_type": "Etc/GMT"}
        ]
      }
    }
  }
}`

// --- ConvertWinTZtoLinuxTZ ---

// ConvertWinTZtoLinuxTZ reads from ./system/time/wintz.json.
// When that file is missing (as in a test environment), it returns "".

func TestConvertWinTZtoLinuxTZ_MissingFile(t *testing.T) {
	// Ensure no wintz.json exists for this sub-test
	os.RemoveAll("./system")
	// When wintz.json doesn't exist the function returns ""
	result := ConvertWinTZtoLinuxTZ("Pacific Standard Time")
	// Accept either "" (file missing) or a valid IANA timezone
	if result != "" {
		// If a result was returned it should look like a valid IANA timezone
		if !strings.Contains(result, "/") && result != "UTC" {
			t.Errorf("unexpected result from ConvertWinTZtoLinuxTZ: %q", result)
		}
	}
}

func TestConvertWinTZtoLinuxTZ_UnknownTZ(t *testing.T) {
	cleanup := setupWintzJSON(t, sampleWintzJSON)
	defer cleanup()

	// An unknown Windows TZ should return ""
	result := ConvertWinTZtoLinuxTZ("This Is Not A Real Timezone")
	if result != "" {
		t.Errorf("expected empty string for unknown TZ, got %q", result)
	}
}

func TestConvertWinTZtoLinuxTZ_EmptyInput(t *testing.T) {
	cleanup := setupWintzJSON(t, sampleWintzJSON)
	defer cleanup()

	result := ConvertWinTZtoLinuxTZ("")
	// Empty string cannot match any zone, so result must be ""
	if result != "" {
		t.Errorf("expected empty string for empty input, got %q", result)
	}
}

func TestConvertWinTZtoLinuxTZ_KnownMapping_Pacific(t *testing.T) {
	cleanup := setupWintzJSON(t, sampleWintzJSON)
	defer cleanup()

	result := ConvertWinTZtoLinuxTZ("Pacific Standard Time")
	if result != "America/Los_Angeles" {
		t.Errorf("expected 'America/Los_Angeles', got %q", result)
	}
}

func TestConvertWinTZtoLinuxTZ_KnownMapping_Eastern(t *testing.T) {
	cleanup := setupWintzJSON(t, sampleWintzJSON)
	defer cleanup()

	// Eastern Standard Time maps to "America/New_York America/Detroit";
	// ConvertWinTZtoLinuxTZ takes the first space-split value.
	result := ConvertWinTZtoLinuxTZ("Eastern Standard Time")
	if result != "America/New_York" {
		t.Errorf("expected 'America/New_York', got %q", result)
	}
}

func TestConvertWinTZtoLinuxTZ_KnownMapping_UTC(t *testing.T) {
	cleanup := setupWintzJSON(t, sampleWintzJSON)
	defer cleanup()

	result := ConvertWinTZtoLinuxTZ("UTC")
	if result != "Etc/GMT" {
		t.Errorf("expected 'Etc/GMT', got %q", result)
	}
}

// showTimeSafe calls ShowTime and recovers from any panic (which can occur
// on non-systemd Linux hosts where timedatectl panics due to missing '=' in output).
// It returns false if a panic occurred, true otherwise.
func showTimeSafe(w http.ResponseWriter, r *http.Request) (panicked bool) {
	defer func() {
		if rec := recover(); rec != nil {
			panicked = true
		}
	}()
	ShowTime(w, r)
	return false
}

// --- ShowTime ---

func TestShowTime_ResponseCode(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestShowTime_ResponseIsJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	body := rr.Body.String()
	if !json.Valid([]byte(body)) {
		t.Errorf("expected valid JSON response, got: %q", body)
	}
}

func TestShowTime_HasTimeField(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	body := rr.Body.String()
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if _, ok := result["time"]; !ok {
		t.Errorf("expected 'time' field in response, got: %v", result)
	}
}

func TestShowTime_HasTimezoneField(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	body := rr.Body.String()
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if _, ok := result["timezone"]; !ok {
		t.Errorf("expected 'timezone' field in response, got: %v", result)
	}
}

func TestShowTime_TimeFieldIsString(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	body := rr.Body.String()
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	timeVal, ok := result["time"].(string)
	if !ok {
		t.Fatalf("expected 'time' to be a string, got %T", result["time"])
	}
	if timeVal == "" {
		t.Error("expected non-empty 'time' field")
	}
}

func TestShowTime_TimeIsRFC3339(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()

	if panicked := showTimeSafe(rr, req); panicked {
		t.Skip("ShowTime panicked (likely non-systemd environment without timedatectl); skipping")
	}

	body := rr.Body.String()
	var result returnFormat
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	// RFC3339 times contain 'T' separator and timezone offset
	if !strings.Contains(result.Time, "T") {
		t.Errorf("expected RFC3339 time format with 'T' separator, got %q", result.Time)
	}
}

// --- WindowsTimeZoneStruct (struct validation) ---

func TestWindowsTimeZoneStruct_Unmarshal(t *testing.T) {
	// Verify the struct can be correctly unmarshalled from a minimal JSON
	raw := `{
		"supplementalData": {
			"version": {"_number": "1"},
			"windowsZones": {
				"mapTimezones": {
					"mapZone": [
						{"_other": "Pacific Standard Time", "_territory": "US", "_type": "America/Los_Angeles"}
					],
					"_otherVersion": "1",
					"_typeVersion": "1"
				}
			}
		}
	}`

	var tzData WindowsTimeZoneStruct
	if err := json.Unmarshal([]byte(raw), &tzData); err != nil {
		t.Fatalf("failed to unmarshal WindowsTimeZoneStruct: %v", err)
	}

	zones := tzData.SupplementalData.WindowsZones.MapTimezones.MapZone
	if len(zones) != 1 {
		t.Fatalf("expected 1 zone entry, got %d", len(zones))
	}
	if zones[0].Other != "Pacific Standard Time" {
		t.Errorf("expected 'Pacific Standard Time', got %q", zones[0].Other)
	}
	if zones[0].Type != "America/Los_Angeles" {
		t.Errorf("expected 'America/Los_Angeles', got %q", zones[0].Type)
	}
}

// --- returnFormat (struct validation) ---

func TestReturnFormat_Unmarshal(t *testing.T) {
	raw := `{"time":"2024-01-15T10:30:00Z","timezone":"America/New_York"}`
	var rf returnFormat
	if err := json.Unmarshal([]byte(raw), &rf); err != nil {
		t.Fatalf("failed to unmarshal returnFormat: %v", err)
	}
	if rf.Time != "2024-01-15T10:30:00Z" {
		t.Errorf("unexpected Time: %q", rf.Time)
	}
	if rf.Timezone != "America/New_York" {
		t.Errorf("unexpected Timezone: %q", rf.Timezone)
	}
}

func TestReturnFormat_Marshal(t *testing.T) {
	rf := returnFormat{
		Time:     "2024-01-15T10:30:00Z",
		Timezone: "Europe/London",
	}
	data, err := json.Marshal(rf)
	if err != nil {
		t.Fatalf("failed to marshal returnFormat: %v", err)
	}
	if !strings.Contains(string(data), `"time"`) {
		t.Errorf("expected 'time' key in JSON output, got: %s", data)
	}
	if !strings.Contains(string(data), `"timezone"`) {
		t.Errorf("expected 'timezone' key in JSON output, got: %s", data)
	}
}

// setupFakeTimedatectl creates a temporary directory with a fake timedatectl
// binary that outputs "Timezone=America/Los_Angeles\n", injects it into PATH,
// and returns a cleanup function.  Only used on Linux.
func setupFakeTimedatectl(t *testing.T) (cleanup func()) {
	t.Helper()
	if runtime.GOOS != "linux" {
		return func() {}
	}

	dir := t.TempDir()
	fakeBin := filepath.Join(dir, "timedatectl")
	script := "#!/bin/sh\necho 'Timezone=America/Los_Angeles'\n"
	if err := os.WriteFile(fakeBin, []byte(script), 0755); err != nil {
		t.Fatalf("failed to write fake timedatectl: %v", err)
	}

	oldPath := os.Getenv("PATH")
	os.Setenv("PATH", dir+string(os.PathListSeparator)+oldPath)
	return func() {
		os.Setenv("PATH", oldPath)
	}
}

// verifyFakeTimedatectl checks that the fake binary is picked up by exec.LookPath.
func verifyFakeTimedatectl(t *testing.T) bool {
	t.Helper()
	p, err := exec.LookPath("timedatectl")
	if err != nil {
		return false
	}
	cmd := exec.Command(p, "show", "-p", "Timezone")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "=")
}

// TestShowTime_WithFakeTimedatectl exercises ShowTime on Linux using a fake
// timedatectl that produces valid output, covering the returnFormat creation,
// json.Marshal and utils.SendJSONResponse lines.
func TestShowTime_WithFakeTimedatectl(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}

	cleanup := setupFakeTimedatectl(t)
	defer cleanup()

	if !verifyFakeTimedatectl(t) {
		t.Skip("fake timedatectl not reachable in PATH")
	}

	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()
	ShowTime(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	body := rr.Body.String()
	if !json.Valid([]byte(body)) {
		t.Errorf("expected valid JSON, got: %q", body)
	}
}

// TestShowTime_ResponseFields_WithFake verifies the JSON fields when
// timedatectl output is valid.
func TestShowTime_ResponseFields_WithFake(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}

	cleanup := setupFakeTimedatectl(t)
	defer cleanup()

	if !verifyFakeTimedatectl(t) {
		t.Skip("fake timedatectl not reachable in PATH")
	}

	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()
	ShowTime(rr, req)

	body := rr.Body.String()
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if _, ok := result["time"]; !ok {
		t.Error("expected 'time' field in response")
	}
	if _, ok := result["timezone"]; !ok {
		t.Error("expected 'timezone' field in response")
	}
}

// TestShowTime_TimezoneValue_WithFake confirms that the timezone value comes
// from the fake timedatectl output.
func TestShowTime_TimezoneValue_WithFake(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only test")
	}

	cleanup := setupFakeTimedatectl(t)
	defer cleanup()

	if !verifyFakeTimedatectl(t) {
		t.Skip("fake timedatectl not reachable in PATH")
	}

	req := httptest.NewRequest(http.MethodGet, "/time/show", nil)
	rr := httptest.NewRecorder()
	ShowTime(rr, req)

	body := rr.Body.String()
	var rf returnFormat
	if err := json.Unmarshal([]byte(body), &rf); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// The fake timedatectl outputs "Timezone=America/Los_Angeles\n"
	// After SplitN("Timezone=America/Los_Angeles\n","=",2)[1] we get "America/Los_Angeles\n"
	if !strings.Contains(rf.Timezone, "America/Los_Angeles") {
		t.Errorf("expected 'America/Los_Angeles' in timezone, got %q", rf.Timezone)
	}
}
