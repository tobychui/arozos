package fssort

import (
	"testing"
)

func TestSortByName(t *testing.T) {
	files := []string{"b.txt", "a.txt", "c.txt"}
	sorted := SortByName(files)
	if len(sorted) != 3 {
		t.Error("Sorted length mismatch")
	}
	t.Logf("Sorted: %v", sorted)
}
