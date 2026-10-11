package odf

// anyFilled reports whether a cell-fill grid states at least one colour
func anyFilled(grid [][]string) bool {
	for _, row := range grid {
		for _, c := range row {
			if c != "" {
				return true
			}
		}
	}
	return false
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
