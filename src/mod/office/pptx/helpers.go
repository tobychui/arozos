package pptx

import (
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func absF(v float64) float64 {
	logger.DebugTrace("office/pptx", "absF")
	if v < 0 {
		return -v
	}
	return v
}

func pathExtOf(p string) string {
	logger.DebugTrace("office/pptx", "pathExtOf")
	i := strings.LastIndex(p, ".")
	if i < 0 {
		return ""
	}
	return p[i:]
}
