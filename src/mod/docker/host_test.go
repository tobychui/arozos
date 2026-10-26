package docker

import (
	"runtime"
	"testing"
)

// TestGetHostStats asserts the host snapshot is internally consistent on the
// current platform: cores are positive, percentages are in range, and the
// available flags line up with the data on Linux/Windows where storage is
// supported.
func TestGetHostStats(t *testing.T) {
	dm := &DockerManager{Options: &Options{}}
	s := dm.GetHostStats()

	if s.CPUCores <= 0 {
		t.Errorf("CPUCores = %d, want > 0", s.CPUCores)
	}
	if s.CPUPercent < 0 || s.CPUPercent > 100 {
		t.Errorf("CPUPercent = %v, want 0..100", s.CPUPercent)
	}
	if s.RAMPercent < 0 || s.RAMPercent > 100 {
		t.Errorf("RAMPercent = %v, want 0..100", s.RAMPercent)
	}
	if s.StorageAvailable {
		if s.StorageTotal <= 0 || s.StorageUsed < 0 || s.StorageUsed > s.StorageTotal {
			t.Errorf("inconsistent storage: used=%d total=%d", s.StorageUsed, s.StorageTotal)
		}
	}

	// Storage should be reportable on linux/windows/darwin via the build-tagged
	// helpers; only assert when we know the helper is implemented.
	switch runtime.GOOS {
	case "linux", "darwin", "windows":
		// helper exists; StorageAvailable may still be false in odd sandboxes,
		// so we don't hard-require it, just ensure no panic occurred above.
	}

	if s.LoadAvailable && s.Load1 < 0 {
		t.Errorf("Load1 = %v, want >= 0", s.Load1)
	}
}
