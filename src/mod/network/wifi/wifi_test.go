package wifi

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	db "imuslab.com/arozos/mod/database"
)

// newTestDatabase creates a temporary bolt database for use in tests.
// The caller is responsible for calling the returned cleanup function.
func newTestDatabase(t *testing.T) (*db.Database, func()) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create the file so the database opener can find it.
	f, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("failed to create temp db file: %v", err)
	}
	f.Close()

	database, err := db.NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase() error: %v", err)
	}

	cleanup := func() {
		// Nothing extra needed; t.TempDir() handles directory removal.
		_ = database
	}
	return database, cleanup
}

// ---------------------------------------------------------------------------
// NewWiFiManager
// ---------------------------------------------------------------------------

// TestNewWiFiManager verifies that the constructor returns a non-nil manager
// and creates the expected database table.
func TestNewWiFiManager(t *testing.T) {
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "/etc/wpa_supplicant/wpa_supplicant.conf", "wlan0")
	if wm == nil {
		t.Fatal("NewWiFiManager() returned nil")
	}

	// Verify the wifi table was created.
	if !database.TableExists("wifi") {
		t.Error("NewWiFiManager() did not create 'wifi' table in the database")
	}
}

// TestNewWiFiManagerSudoMode verifies that sudo_mode is stored correctly.
func TestNewWiFiManagerSudoMode(t *testing.T) {
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, true, "/tmp/wpa.conf", "wlan1")
	if wm == nil {
		t.Fatal("NewWiFiManager() returned nil")
	}
	if !wm.sudo_mode {
		t.Error("sudo_mode should be true")
	}
}

// TestNewWiFiManagerFields verifies that all constructor arguments are stored.
func TestNewWiFiManagerFields(t *testing.T) {
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wpaPath := "/etc/wpa_supplicant.conf"
	wlanName := "wlan2"

	wm := NewWiFiManager(database, false, wpaPath, wlanName)
	if wm.wpa_supplicant_path != wpaPath {
		t.Errorf("wpa_supplicant_path = %q, expected %q", wm.wpa_supplicant_path, wpaPath)
	}
	if wm.wan_interface_name != wlanName {
		t.Errorf("wan_interface_name = %q, expected %q", wm.wan_interface_name, wlanName)
	}
	if wm.database != database {
		t.Error("database pointer not stored correctly")
	}
}

// ---------------------------------------------------------------------------
// GetWirelessInterfaces
// ---------------------------------------------------------------------------

// TestGetWirelessInterfaces verifies that GetWirelessInterfaces does not error
// on the current platform.  On Linux it may return an empty list if no wireless
// hardware is present (common in CI); on Darwin/FreeBSD it always returns an
// empty list (stub implementation).  On Windows it calls netsh; errors from
// missing netsh are tolerated.
func TestGetWirelessInterfaces(t *testing.T) {
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")

	switch runtime.GOOS {
	case "linux":
		ifaces, err := wm.GetWirelessInterfaces()
		if err != nil {
			t.Logf("GetWirelessInterfaces() returned error (may be expected in CI without iw): %v", err)
			return
		}
		// ifaces may be empty (no wireless hardware) or contain interface names.
		for _, iface := range ifaces {
			if iface == "" {
				t.Error("GetWirelessInterfaces() returned an empty string in the interface list")
			}
		}
	case "darwin", "freebsd":
		// Stub implementations always return an empty slice with no error.
		ifaces, err := wm.GetWirelessInterfaces()
		if err != nil {
			t.Errorf("GetWirelessInterfaces() unexpected error on %s: %v", runtime.GOOS, err)
		}
		if len(ifaces) != 0 {
			t.Errorf("GetWirelessInterfaces() on %s should return empty slice, got %v", runtime.GOOS, ifaces)
		}
	case "windows":
		// May fail in CI if running without wireless hardware; that's acceptable.
		_, err := wm.GetWirelessInterfaces()
		if err != nil {
			t.Logf("GetWirelessInterfaces() on Windows returned error (may be expected in CI): %v", err)
		}
	default:
		t.Skipf("GetWirelessInterfaces not tested on %s", runtime.GOOS)
	}
}

// ---------------------------------------------------------------------------
// Platform-specific capability tests
// ---------------------------------------------------------------------------

// TestSetInterfacePowerUnsupported verifies that SetInterfacePower returns an
// error on platforms that do not support the operation (Darwin, FreeBSD, Windows).
func TestSetInterfacePowerUnsupported(t *testing.T) {
	switch runtime.GOOS {
	case "darwin", "freebsd", "windows":
		// Intentionally left without t.Skip: these platforms should return an error.
	case "linux":
		t.Skip("skipping unsupported-platform test on Linux")
	default:
		t.Skipf("platform %s not tested", runtime.GOOS)
	}

	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")
	err := wm.SetInterfacePower("wlan0", true)
	if err == nil {
		t.Errorf("SetInterfacePower() on %s should return an error, got nil", runtime.GOOS)
	}
}

// TestGetInterfacePowerStatusUnsupported verifies that GetInterfacePowerStatuts
// returns an error on Darwin, FreeBSD, and Windows.
func TestGetInterfacePowerStatusUnsupported(t *testing.T) {
	switch runtime.GOOS {
	case "darwin", "freebsd", "windows":
		// These platforms should return an error.
	case "linux":
		t.Skip("skipping unsupported-platform test on Linux")
	default:
		t.Skipf("platform %s not tested", runtime.GOOS)
	}

	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")
	_, err := wm.GetInterfacePowerStatuts("wlan0")
	if err == nil {
		t.Errorf("GetInterfacePowerStatuts() on %s should return an error, got nil", runtime.GOOS)
	}
}

// TestScanNearbyWiFiUnsupported verifies that ScanNearbyWiFi returns an error
// on Darwin and FreeBSD (stub implementations).
func TestScanNearbyWiFiUnsupported(t *testing.T) {
	switch runtime.GOOS {
	case "darwin", "freebsd":
		// These platforms should return an error.
	default:
		t.Skipf("skipping ScanNearbyWiFi unsupported test on %s", runtime.GOOS)
	}

	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")
	results, err := wm.ScanNearbyWiFi("wlan0")
	if err == nil {
		t.Errorf("ScanNearbyWiFi() on %s should return an error, got nil", runtime.GOOS)
	}
	if results == nil {
		t.Error("ScanNearbyWiFi() should return an empty (non-nil) slice on error")
	}
}

// TestConnectWiFiUnsupported verifies that ConnectWiFi returns an error on
// Darwin, FreeBSD, and Windows stub implementations.
func TestConnectWiFiUnsupported(t *testing.T) {
	switch runtime.GOOS {
	case "darwin", "freebsd", "windows":
		// These platforms should return an error.
	case "linux":
		t.Skip("skipping unsupported platform ConnectWiFi test on Linux")
	default:
		t.Skipf("platform %s not tested", runtime.GOOS)
	}

	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")
	result, err := wm.ConnectWiFi("TestSSID", "password", "", "")
	if err == nil {
		t.Errorf("ConnectWiFi() on %s should return an error, got nil", runtime.GOOS)
	}
	if result == nil {
		t.Error("ConnectWiFi() should return a non-nil result even on error")
	}
}

// TestRemoveWifiUnsupported verifies that RemoveWifi returns an error on
// Darwin, FreeBSD, and Windows stub implementations.
func TestRemoveWifiUnsupported(t *testing.T) {
	switch runtime.GOOS {
	case "darwin", "freebsd", "windows":
		// These platforms should return an error.
	case "linux":
		t.Skip("skipping unsupported platform RemoveWifi test on Linux")
	default:
		t.Skipf("platform %s not tested", runtime.GOOS)
	}

	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")
	err := wm.RemoveWifi("TestSSID")
	if err == nil {
		t.Errorf("RemoveWifi() on %s should return an error, got nil", runtime.GOOS)
	}
}

// ---------------------------------------------------------------------------
// Linux-specific helper function tests
// ---------------------------------------------------------------------------

// TestFileExistsLinux verifies the fileExists helper.
func TestFileExistsLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("fileExists helper is in linux-only source; test runs on Linux")
	}
	// A path that exists.
	if !fileExists("/proc/version") {
		t.Error("fileExists(\"/proc/version\") should return true on Linux")
	}
	// A path that does not exist.
	if fileExists("/nonexistent_path_xyz_12345") {
		t.Error("fileExists(\"/nonexistent_path_xyz_12345\") should return false")
	}
}

// TestFileInDirLinux verifies the fileInDir helper.
func TestFileInDirLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("fileInDir helper is in linux-only source; test runs on Linux")
	}
	// The file is inside the directory.
	if !fileInDir("/tmp/foo/bar.txt", "/tmp/foo") {
		t.Error("fileInDir should return true when file is inside directory")
	}
	// The file is outside the directory.
	if fileInDir("/etc/passwd", "/tmp") {
		t.Error("fileInDir should return false when file is outside directory")
	}
}

// TestPkgExistsLinux verifies the pkg_exists helper.
func TestPkgExistsLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("pkg_exists helper is in linux-only source; test runs on Linux")
	}
	// "sh" should always exist on Linux.
	if !pkg_exists("sh") {
		t.Error("pkg_exists(\"sh\") should return true on Linux")
	}
	// A package that almost certainly doesn't exist.
	if pkg_exists("this_package_does_not_exist_xyz") {
		t.Error("pkg_exists(\"this_package_does_not_exist_xyz\") should return false")
	}
}

// TestGetSignalLevelEstimation verifies the bar-to-dBm mapping.
func TestGetSignalLevelEstimation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("getSignalLevelEstimation is in linux-only source; test runs on Linux")
	}
	database, cleanup := newTestDatabase(t)
	defer cleanup()

	wm := NewWiFiManager(database, false, "", "")

	cases := []struct {
		bar      string
		expected string
	}{
		{"▂▄▆█", "-45 dBm[Estimated]"},
		{"▂▄▆_", "-55 dBm[Estimated]"},
		{"▂▄__", "-75 dBm[Estimated]"},
		{"▂___", "-85 dBm[Estimated]"},
		{"____", "-95 dBm[Estimated]"},
		{"", "-95 dBm[Estimated]"},
	}

	for _, tc := range cases {
		got := wm.getSignalLevelEstimation(tc.bar)
		if got != tc.expected {
			t.Errorf("getSignalLevelEstimation(%q) = %q, expected %q", tc.bar, got, tc.expected)
		}
	}
}
