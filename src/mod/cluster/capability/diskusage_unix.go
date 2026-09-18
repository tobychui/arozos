//go:build linux || darwin || freebsd

package capability

import "golang.org/x/sys/unix"

// DiskUsage returns the free and total bytes of the file system holding path.
func DiskUsage(path string) (free int64, total int64, err error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bsize := int64(st.Bsize)
	return int64(st.Bavail) * bsize, int64(st.Blocks) * bsize, nil
}
