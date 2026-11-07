//go:build windows

package aroz

import "os"

// fileID has no cheap answer from an os.FileInfo here. Returning zero makes
// the core hash the path instead.
func fileID(fi os.FileInfo) uint64 { return 0 }
