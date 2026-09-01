package filesystem

import "os"

/*
	filecreationtime.go

	Creation (birth) time is not part of os.FileInfo: each platform keeps it -
	when it keeps it at all - behind FileInfo.Sys() in its own structure. The
	per-platform readers live in filecreationtime_{windows,darwin,other}.go and
	this file is the shared entry point for them.
*/

// GetFileCreationTime returns the unix timestamp at which the given file was
// created. The second return value is false on platforms or file systems that
// do not record a creation time, in which case the caller should hide or grey
// out the field instead of showing a wrong date.
func GetFileCreationTime(fileInfo os.FileInfo) (int64, bool) {
	if fileInfo == nil {
		return 0, false
	}
	return getFileCreationTime(fileInfo)
}
