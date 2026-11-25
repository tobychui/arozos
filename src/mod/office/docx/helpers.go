package docx

import (
	"regexp"

	"imuslab.com/arozos/mod/info/logger"
)

func absF(v float64) float64 {
	logger.DebugTrace("office/docx", "absF")
	if v < 0 {
		return -v
	}
	return v
}

var tagRe = regexp.MustCompile(`<[^>]*>`)

func maxInt(a, b int) int {
	logger.DebugTrace("office/docx", "maxInt")
	if a > b {
		return a
	}
	return b
}
