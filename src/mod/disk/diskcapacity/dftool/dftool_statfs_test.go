//go:build linux || darwin

package dftool

import (
	"syscall"
	"testing"
)

// TestCapacityMatchesStatfs checks df's figures against the kernel's. macOS
// df counts 512 byte blocks unless told otherwise, which once doubled every
// size reported on a Mac.
func TestCapacityMatchesStatfs(t *testing.T) {
	dir := t.TempDir()
	c, err := GetCapacityInfoFromPath(dir)
	if err != nil {
		t.Skipf("df is not available: %v", err)
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		t.Fatal(err)
	}
	want := int64(st.Blocks) * int64(st.Bsize)
	if want <= 0 {
		t.Skip("statfs reports no size")
	}
	//df rounds to whole blocks and the disk changes while the test runs
	if diff := c.Total - want; diff > want/100 || diff < -want/100 {
		t.Errorf("df total %d bytes, statfs %d bytes", c.Total, want)
	}
}
