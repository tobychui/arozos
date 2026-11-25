package odf

import "imuslab.com/arozos/mod/info/logger"

// anyFilled reports whether a cell-fill grid states at least one colour
func anyFilled(grid [][]string) bool {
	logger.DebugTrace("office/odf", "anyFilled")
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
	logger.DebugTrace("office/odf", "minF")
	if a < b {
		return a
	}
	return b
}
