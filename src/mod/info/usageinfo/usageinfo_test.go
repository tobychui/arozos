package usageinfo

import (
	"testing"
)

func TestGetCPUUsage(t *testing.T) {
	// Test that function doesn't panic
	usage := GetCPUUsage()
	t.Logf("CPU Usage: %.2f%%", usage)
}
