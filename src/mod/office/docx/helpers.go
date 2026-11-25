package docx

import (
	"regexp"

	"imuslab.com/arozos/mod/info/logger"
)

func absF(v float64) float64 {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "absF: v=%g", v)
	}
	if v < 0 {
		return -v
	}
	return v
}

var tagRe = regexp.MustCompile(`<[^>]*>`)

func maxInt(a, b int) int {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "maxInt: a=%d b=%d", a, b)
	}
	if a > b {
		return a
	}
	return b
}
