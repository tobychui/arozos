package odf

import "imuslab.com/arozos/mod/info/logger"

// anyFilled reports whether a cell-fill grid states at least one colour
func anyFilled(grid [][]string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/odf", "anyFilled: len(grid)=%d", len(grid))
	}
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
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/odf", "minF: a=%g b=%g", a, b)
	}
	if a < b {
		return a
	}
	return b
}
