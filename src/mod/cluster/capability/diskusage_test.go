package capability

import (
	"runtime"
	"testing"
)

func TestDiskUsage(t *testing.T) {
	dir := t.TempDir()
	free, total, err := DiskUsage(dir)
	switch runtime.GOOS {
	case "linux", "darwin", "freebsd", "windows":
		if err != nil {
			t.Fatalf("DiskUsage(%s): %v", dir, err)
		}
		if total <= 0 || free < 0 || free > total {
			t.Errorf("implausible disk figures free=%d total=%d", free, total)
		}
	default:
		if err == nil {
			t.Errorf("unsupported platform should return an error")
		}
	}
	if _, _, err := DiskUsage(dir + "/does/not/exist"); err == nil && runtime.GOOS != "windows" {
		t.Errorf("missing path should fail")
	}
}
