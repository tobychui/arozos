package xlsx

// px <-> Excel units: column width is in "characters" (~7px each at 96dpi),
// row height is in points
func pxToColChars(px float64) float64 { return px / 7.0 }

func colCharsToPx(ch float64) float64 { return ch * 7.0 }

func pxToRowPt(px float64) float64 { return px * 72.0 / 96.0 }

func rowPtToPx(pt float64) float64 { return pt * 96.0 / 72.0 }
