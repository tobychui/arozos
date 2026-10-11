package pptx

import (
	"strings"
)

func absF(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func pathExtOf(p string) string {
	i := strings.LastIndex(p, ".")
	if i < 0 {
		return ""
	}
	return p[i:]
}
