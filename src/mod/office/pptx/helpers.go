package pptx

import (
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func absF(v float64) float64 {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/pptx", "absF: v=%g", v)
	}
	if v < 0 {
		return -v
	}
	return v
}

func pathExtOf(p string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/pptx", "pathExtOf: p=%.120q", p)
	}
	i := strings.LastIndex(p, ".")
	if i < 0 {
		return ""
	}
	return p[i:]
}
