//go:build windows

package aroz

import "imuslab.com/arozos/mod/info/logger"
import "os"

// fileID has no cheap answer from an os.FileInfo here. Returning zero makes
// the core hash the path instead.
func fileID(fi os.FileInfo) (out0 uint64) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "fileID", "fi", fi), &out0)
	return 0
}
