package docx

/* ---------- unit helpers ---------- */

// twips (twentieths of a point): 1 mm = 56.6929 twips
func mmToTwips(mm float64) int { return int(mm * 1440.0 / 25.4) }

func twipsToMm(tw int) float64 { return float64(tw) * 25.4 / 1440.0 }

// page sizes in twips (portrait)
var pageSizesTwips = map[string][2]int{
	"A4":     {11906, 16838},
	"Letter": {12240, 15840},
	"Legal":  {12240, 20160},
}

// px (96dpi) -> half-points for w:sz
func pxToHalfPoints(px float64) int { return int(px * 0.75 * 2) }

func halfPointsToPx(hp float64) float64 {
	return hp / 2.0 / 0.75
}
