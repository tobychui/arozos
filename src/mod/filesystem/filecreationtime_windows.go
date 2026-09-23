//go:build windows
// +build windows

package filesystem

import (
	"os"
	"syscall"
	"time"
)

// Windows records the creation time in the file attribute data of every file
func getFileCreationTime(fileInfo os.FileInfo) (int64, bool) {
	attributeData, ok := fileInfo.Sys().(*syscall.Win32FileAttributeData)
	if !ok || attributeData == nil {
		return 0, false
	}

	creationTime := time.Unix(0, attributeData.CreationTime.Nanoseconds()).Unix()
	if creationTime <= 0 {
		return 0, false
	}
	return creationTime, true
}
