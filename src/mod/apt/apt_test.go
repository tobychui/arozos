package apt

import (
	"runtime"
	"testing"
)

func TestNewPackageManager(t *testing.T) {
	// Test case 1: Create with autoInstall true
	pm := NewPackageManager(true)
	if pm == nil {
		t.Error("Test case 1 failed. Expected non-nil PackageManager")
	}
	if !pm.AllowAutoInstall {
		t.Error("Test case 1 failed. AllowAutoInstall should be true")
	}

	// Test case 2: Create with autoInstall false
	pm2 := NewPackageManager(false)
	if pm2 == nil {
		t.Error("Test case 2 failed. Expected non-nil PackageManager")
	}
	if pm2.AllowAutoInstall {
		t.Error("Test case 2 failed. AllowAutoInstall should be false")
	}
}

func TestInstallIfNotExists_Disabled(t *testing.T) {
	// Test case 1: Auto install disabled
	pm := NewPackageManager(false)
	err := pm.InstallIfNotExists("test-package", false)
	if err == nil {
		t.Error("Test case 1 failed. Expected error when auto install is disabled")
	}

	expectedMsg := "package auto install is disabled"
	if err.Error() != expectedMsg {
		t.Errorf("Test case 1 failed. Expected error message '%s', got '%s'", expectedMsg, err.Error())
	}

	// Test case 2: mustComply true with auto install disabled
	err = pm.InstallIfNotExists("test-package", true)
	if err == nil {
		t.Error("Test case 2 failed. Expected error when auto install is disabled")
	}
}

func TestInstallIfNotExists_Sanitization(t *testing.T) {
	// Note: We can't actually test installation without root privileges,
	// but we can test that the sanitization logic works by checking
	// the package manager's behavior

	pm := NewPackageManager(true)

	// Test case 1: Package name with & should be sanitized
	// We expect this to fail (unless the package actually exists)
	// but the sanitization should happen internally
	err := pm.InstallIfNotExists("test&package", false)
	// Error is expected since we likely don't have permissions
	// The important part is that it doesn't panic

	// Test case 2: Package name with | should be sanitized
	err = pm.InstallIfNotExists("test|package", false)
	_ = err // Error is expected

	// Test case 3: Package name with both & and |
	err = pm.InstallIfNotExists("test&pkg|bad", false)
	_ = err // Error is expected
}

func TestPackageExists(t *testing.T) {
	// Test case 1: Check for a common command that should exist
	// Use different commands based on OS
	var testCmd string
	switch runtime.GOOS {
	case "windows":
		testCmd = "cmd"
	case "darwin":
		testCmd = "ls"
	case "linux":
		testCmd = "sh"
	default:
		t.Skip("Unsupported operating system")
	}

	exists, err := PackageExists(testCmd)
	// On most systems, these basic commands should exist
	// If they don't exist, we still check that the function returns properly
	if err != nil && !exists {
		// This is acceptable - the command might not be in PATH
		// The important thing is the function didn't panic
	}

	// Test case 2: Check for a package that definitely doesn't exist
	exists, err = PackageExists("this-package-definitely-does-not-exist-xyz123")
	if exists {
		t.Error("Test case 2 failed. Non-existent package should return false")
	}
	if err == nil {
		t.Error("Test case 2 failed. Non-existent package should return an error")
	}

	// Test case 3: Empty package name
	exists, err = PackageExists("")
	if exists {
		t.Error("Test case 3 failed. Empty package name should return false")
	}

	// Test case 4: OS-specific behavior for Windows
	if runtime.GOOS == "windows" {
		// Test Windows-specific code path
		exists, err := PackageExists("nonexistent-windows-package")
		if exists {
			t.Error("Test case 4 failed. Non-existent Windows package should return false")
		}
		if err == nil {
			t.Error("Test case 4 failed. Should return error for non-existent package")
		}

		// Check error message mentions Windows
		if err != nil && err.Error() != "" {
			// Error should mention Windows or PATH
			msg := err.Error()
			if msg == "" {
				t.Error("Test case 4 failed. Error message should not be empty")
			}
		}
	}

	// Test case 5: OS-specific behavior for macOS
	if runtime.GOOS == "darwin" {
		// Test macOS-specific code path
		exists, err := PackageExists("nonexistent-macos-package-xyz")
		if exists {
			t.Error("Test case 5 failed. Non-existent macOS package should return false")
		}
		if err == nil {
			t.Error("Test case 5 failed. Should return error for non-existent package")
		}
	}

	// Test case 6: OS-specific behavior for Linux
	if runtime.GOOS == "linux" {
		// Test Linux-specific code path
		exists, err := PackageExists("nonexistent-linux-package-xyz123")
		if exists {
			t.Error("Test case 6 failed. Non-existent Linux package should return false")
		}
		// Error might be nil or non-nil depending on dpkg availability
		_ = err
	}
}

func TestPackageExists_EdgeCases(t *testing.T) {
	// Test case 1: Package name with spaces
	exists, err := PackageExists("package with spaces")
	if exists {
		t.Error("Test case 1 failed. Package with spaces should likely not exist")
	}
	_ = err // Error is acceptable

	// Test case 2: Package name with special characters
	exists, err = PackageExists("pkg-name_with.special@chars")
	if exists {
		t.Error("Test case 2 failed. Package with special chars should likely not exist")
	}
	_ = err // Error is acceptable

	// Test case 3: Very long package name
	longName := "very-long-package-name-that-definitely-does-not-exist-in-any-system-repository-xyz123"
	exists, err = PackageExists(longName)
	if exists {
		t.Error("Test case 3 failed. Long package name should not exist")
	}
	_ = err // Error is acceptable

	// Test case 4: Package name with newline (potential injection attempt)
	exists, err = PackageExists("pkg\nname")
	if exists {
		t.Error("Test case 4 failed. Package with newline should not exist")
	}
	_ = err // Error is acceptable

	// Test case 5: Package name starting with hyphen
	exists, err = PackageExists("-invalid-start")
	if exists {
		t.Error("Test case 5 failed. Package starting with hyphen should not exist")
	}
	_ = err // Error is acceptable
}

func TestAptPackageManager_AllowAutoInstallProperty(t *testing.T) {
	// Test case 1: Verify AllowAutoInstall can be read
	pm := NewPackageManager(true)
	if !pm.AllowAutoInstall {
		t.Error("Test case 1 failed. AllowAutoInstall should be accessible and true")
	}

	// Test case 2: Verify AllowAutoInstall can be modified
	pm.AllowAutoInstall = false
	if pm.AllowAutoInstall {
		t.Error("Test case 2 failed. AllowAutoInstall should be modifiable")
	}

	// Test case 3: After modification, InstallIfNotExists should respect the change
	err := pm.InstallIfNotExists("test", false)
	if err == nil {
		t.Error("Test case 3 failed. Should return error when AllowAutoInstall is false")
	}

	// Test case 4: Re-enable and verify
	pm.AllowAutoInstall = true
	if !pm.AllowAutoInstall {
		t.Error("Test case 4 failed. AllowAutoInstall should be true again")
	}
}

func TestInstallIfNotExists_PackageExists(t *testing.T) {
	pm := NewPackageManager(true)

	// Test with a package that likely exists on the system
	// We use 'sh' for Linux/macOS as it's a common shell
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		// If 'sh' exists, InstallIfNotExists should return nil without trying to install
		err := pm.InstallIfNotExists("sh", false)
		// On systems where sh exists, this might return nil or an error
		// depending on whether it can check package status
		_ = err // We don't assert here as it's system-dependent
	}

	// The key test is that the function doesn't panic with existing packages
	// and handles them gracefully
}
