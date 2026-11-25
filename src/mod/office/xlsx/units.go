package xlsx

import "imuslab.com/arozos/mod/info/logger"

// px <-> Excel units: column width is in "characters" (~7px each at 96dpi),
// row height is in points
func pxToColChars(px float64) float64 {
	logger.DebugTrace("office/xlsx", "pxToColChars")
	return px / 7.0
}

func colCharsToPx(ch float64) float64 {
	logger.DebugTrace("office/xlsx", "colCharsToPx")
	return ch * 7.0
}

func pxToRowPt(px float64) float64 {
	logger.DebugTrace("office/xlsx", "pxToRowPt")
	return px * 72.0 / 96.0
}

func rowPtToPx(pt float64) float64 {
	logger.DebugTrace("office/xlsx", "rowPtToPx")
	return pt * 96.0 / 72.0
}
