// Package units converts between the measuring units office formats use
// (EMU, points, pixels at 96 DPI) and formats numbers the way the writers
// print them.
package units

import (
	"strconv"
	"strings"
)

// EMU (English Metric Units) per pixel at 96 DPI
const EmuPerPx = 9525

/* ---------- shared small helpers ---------- */

func PxToEmu(px float64) int64 {
	return int64(px * EmuPerPx)
}

func EmuToPx(emu int64, scale float64) float64 {
	return float64(emu) / EmuPerPx * scale
}

func Round4(v float64) float64 {
	return float64(int64(v*10000+CopySign(0.5, v))) / 10000
}

// ParseNum reads the leading number out of a CSS value ("18.5px" -> 18.5)
func ParseNum(v string) float64 {
	v = strings.TrimSpace(v)
	end := 0
	for end < len(v) {
		c := v[end]
		if (c >= '0' && c <= '9') || c == '.' || (end == 0 && (c == '-' || c == '+')) {
			end++
			continue
		}
		break
	}
	if end == 0 {
		return 0
	}
	f, err := strconv.ParseFloat(v[:end], 64)
	if err != nil {
		return 0
	}
	return f
}

// EMU per point (a point is 1/72 inch, an EMU 1/914400 inch)
const EmuPerPt = 12700

func FmtPx(v float64) string {
	return strconv.FormatFloat(Round2(v), 'f', -1, 64) + "px"
}

func Round2(v float64) float64 {
	return float64(int64(v*100+CopySign(0.5, v))) / 100
}

func CopySign(v, sign float64) float64 {
	if sign < 0 {
		return -v
	}
	return v
}

// PtToPx converts points to CSS pixels at 96 dpi
func PtToPx(pt float64) float64 { return pt / 0.75 }

func AtofDefault(s string, def float64) float64 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return def
	}
	return v
}

func TrimFloat(f float64) string {
	s := strconv.FormatFloat(f, 'f', 2, 64)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	return s
}
