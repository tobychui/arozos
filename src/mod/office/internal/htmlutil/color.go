package htmlutil

import (
	"regexp"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// HexColor normalizes "#rrggbb" to uppercase "RRGGBB"; returns fallback when invalid
func HexColor(c string, fallback string) (out0 string) {
	defer logger.Out1(logger.In2("office/internal/htmlutil", "HexColor", "c", c, "fallback", fallback), &out0)
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
func HexAlpha(c string) (out0 float64) {
	defer logger.Out1(logger.In1("office/internal/htmlutil", "HexAlpha", "c", c), &out0)
	c = strings.TrimPrefix(strings.TrimSpace(c), "#")
	if len(c) != 8 {
		return 1
	}
	v, err := strconv.ParseUint(c[6:], 16, 8)
	if err != nil {
		logger.DebugErr("office/internal/htmlutil", err)
		return 1
	}
	return float64(v) / 255
}
