//go:build !windows && !darwin
// +build !windows,!darwin

package filesystem

import "os"

/*
Linux and the other supported targets do not expose a birth time through
the syscall package: it is only reachable via statx(2), which needs a
recent kernel and is not recorded by every file system anyway. Report the
creation time as unknown so the caller can grey the field out rather than
guessing with ctime, which is the inode change time and not a creation time.
*/
func getFileCreationTime(fileInfo os.FileInfo) (int64, bool) {
	return 0, false
}
