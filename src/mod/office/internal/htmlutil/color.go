package htmlutil

import (
	"regexp"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// HexColor normalizes "#rrggbb" to uppercase "RRGGBB"; returns fallback when invalid
func HexColor(c string, fallback string) string {
	if logger.IsDebug() {
		logger.Debugf("office/internal/htmlutil", "HexColor: c=%.120q fallback=%.120q", c, fallback)
	}
	c = strings.TrimPrefix(strings.TrimSpace(c), "#")
	if len(c) == 3 {
		c = string([]byte{c[0], c[0], c[1], c[1], c[2], c[2]})
	}
	// "#rrggbbaa": the colour part (HexAlpha reads the rest)
	if len(c) == 8 {
		c = c[:6]
	}
	ok, _ := regexp.MatchString("^[0-9a-fA-F]{6}$", c)
	if !ok {
		return fallback
	}
	return strings.ToUpper(c)
}

// HexAlpha is the opacity of a "#rrggbbaa" colour, 1 for any other form
func HexAlpha(c string) float64 {
	if logger.IsDebug() {
		logger.Debugf("office/internal/htmlutil", "HexAlpha: c=%.120q", c)
	}
	c = strings.TrimPrefix(strings.TrimSpace(c), "#")
	if len(c) != 8 {
		return 1
	}
	v, err := strconv.ParseUint(c[6:], 16, 8)
	if err != nil {
		return 1
	}
	return float64(v) / 255
}
