package sortfile

import (
	"testing"
)

func TestSortFiles(t *testing.T) {
	files := []string{"z.txt", "a.txt", "m.txt"}
	sorted := SortFiles(files, "name", false)
	if len(sorted) != 3 {
		t.Error("Sorted length mismatch")
	}
	t.Logf("Sorted: %v", sorted)
}
