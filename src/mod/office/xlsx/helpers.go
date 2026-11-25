package xlsx

import "imuslab.com/arozos/mod/info/logger"

func maxInt(a, b int) int {
	logger.DebugTrace("office/xlsx", "maxInt")
	if a > b {
		return a
	}
	return b
}
