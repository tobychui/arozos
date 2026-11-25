//go:build !windows

package aroz

import (
	"os"
	"syscall"

	"imuslab.com/arozos/mod/info/logger"
)

// fileID returns the inode, which stays with a file through a rename.
func fileID(fi os.FileInfo) (out0 uint64) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "fileID", "fi", fi), &out0)
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino)
	}
	return 0
}
