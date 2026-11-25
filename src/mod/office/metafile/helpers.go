package metafile

import "imuslab.com/arozos/mod/info/logger"

func maxInt(a, b int) int {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/metafile", "maxInt: a=%d b=%d", a, b)
	}
	if a > b {
		return a
	}
	return b
}
