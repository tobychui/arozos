package docx

import (
	"regexp"
)

func absF(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

var tagRe = regexp.MustCompile(`<[^>]*>`)

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
