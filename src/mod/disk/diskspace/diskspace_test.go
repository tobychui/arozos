package diskspace

import (
	"testing"
)

func TestGetAllLogicDiskInfo(t *testing.T) {
	// Test case 1: Get all logical disk info
	disks := GetAllLogicDiskInfo()

	// Should have at least one disk (the system disk)
	if len(disks) == 0 {
		t.Log("Warning: No disks found (may be expected in some test environments)")
		return
	}

	t.Logf("Found %d logical disk(s)", len(disks))

	// Test case 2: Verify disk info structure
	for i, disk := range disks {
		if disk.Device == "" {
			t.Errorf("Test case 2 failed. Disk %d should have a device name", i)
		}

		t.Logf("Disk %d: Device=%s, MountPoint=%s, Total=%d, Used=%d, Available=%d, Usage=%s",
			i, disk.Device, disk.MountPoint, disk.Volume, disk.Used, disk.Available, disk.UsedPercentage)
	}
}
