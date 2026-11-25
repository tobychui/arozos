//go:build windows

package aroz

import "imuslab.com/arozos/mod/info/logger"
import "os"

// fileID has no cheap answer from an os.FileInfo here. Returning zero makes
// the core hash the path instead.
func fileID(fi os.FileInfo) uint64 {
	logger.DebugTrace("storage/smbserver/aroz", "fileID")
	return 0
}
