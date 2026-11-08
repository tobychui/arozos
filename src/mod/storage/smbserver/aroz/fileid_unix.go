//go:build !windows

package aroz

import (
	"os"
	"syscall"
)

// fileID returns the inode, which stays with a file through a rename.
func fileID(fi os.FileInfo) uint64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino)
	}
	return 0
}
