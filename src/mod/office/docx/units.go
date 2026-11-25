package docx

import "imuslab.com/arozos/mod/info/logger"

/* ---------- unit helpers ---------- */

// twips (twentieths of a point): 1 mm = 56.6929 twips
func mmToTwips(mm float64) int {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "mmToTwips: mm=%g", mm)
	}
	return int(mm * 1440.0 / 25.4)
}

func twipsToMm(tw int) float64 {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "twipsToMm: tw=%d", tw)
	}
	return float64(tw) * 25.4 / 1440.0
}

// page sizes in twips (portrait)
var pageSizesTwips = map[string][2]int{
	"A4":     {11906, 16838},
	"Letter": {12240, 15840},
	"Legal":  {12240, 20160},
}

// px (96dpi) -> half-points for w:sz
func pxToHalfPoints(px float64) int {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "pxToHalfPoints: px=%g", px)
	}
	return int(px * 0.75 * 2)
}

func halfPointsToPx(hp float64) float64 {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/docx", "halfPointsToPx: hp=%g", hp)
	}
	return hp / 2.0 / 0.75
}
