package metafile

import "imuslab.com/arozos/mod/info/logger"

func maxInt(a, b int) int {
	logger.DebugTrace("office/metafile", "maxInt")
	if a > b {
		return a
	}
	return b
}
