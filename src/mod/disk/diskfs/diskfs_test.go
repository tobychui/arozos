package diskfs

import (
	"testing"
)

func TestFormatPackageInstalled(t *testing.T) {
	// Test that function doesn't panic
	_ = FormatPackageInstalled("ext4")
	t.Log("FormatPackageInstalled executed successfully")
}
