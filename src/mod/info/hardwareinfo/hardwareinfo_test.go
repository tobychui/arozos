package hardwareinfo

import (
	"testing"
)

func TestGetCPUInfo(t *testing.T) {
	info := GetCPUInfo()
	t.Logf("CPU Info: %v", info)
}

func TestGetMemoryInfo(t *testing.T) {
	info := GetMemoryInfo()
	t.Logf("Memory Info: %v", info)
}
