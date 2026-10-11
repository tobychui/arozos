package slidetext

// markers.go - the counters of numbered lists

import (
	"strings"
)

// AlphaMarker is the n-th letter marker of an "a." / "A." list (1 = a, 27 =
// aa), counted from base ('a' or 'A')
func AlphaMarker(n int, base byte) string {
	if n < 1 {
		n = 1
	}
	out := ""
	for n > 0 {
		n--
		out = string([]byte{base + byte(n%26)}) + out
		n /= 26
	}
	return out
}

// RomanMarker is n in upper-case Roman numerals ("" below 1)
func RomanMarker(n int) string {
	if n < 1 {
		return ""
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var sb strings.Builder
	for i, v := range vals {
		for n >= v {
			sb.WriteString(syms[i])
			n -= v
		}
	}
	return sb.String()
}
