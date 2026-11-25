//go:build windows
// +build windows

package filesystem

import (
	"os"
	"syscall"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// Windows records the creation time in the file attribute data of every file
func getFileCreationTime(fileInfo os.FileInfo) (out0 int64, out1 bool) {
	defer logger.Out2(logger.In1("filesystem", "getFileCreationTime", "fileInfo", fileInfo), &out0, &out1)
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
