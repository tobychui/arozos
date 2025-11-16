package fssort

import (
	"io/fs"
	"os"
	"testing"
	"time"
)

// mockFileInfo implements fs.FileInfo for testing
type mockFileInfo struct {
	name    string
	size    int64
	modTime time.Time
	isDir   bool
}

func (m mockFileInfo) Name() string       { return m.name }
func (m mockFileInfo) Size() int64        { return m.size }
func (m mockFileInfo) Mode() os.FileMode  { return 0644 }
func (m mockFileInfo) ModTime() time.Time { return m.modTime }
func (m mockFileInfo) IsDir() bool        { return m.isDir }
func (m mockFileInfo) Sys() interface{}   { return nil }

func TestSortFileList(t *testing.T) {
	// Test case 1: Sort by name (default mode)
	names := []string{"zebra.txt", "apple.txt", "middle.txt"}
	now := time.Now()
	infos := []fs.FileInfo{
		mockFileInfo{name: "zebra.txt", size: 100, modTime: now, isDir: false},
		mockFileInfo{name: "apple.txt", size: 200, modTime: now, isDir: false},
		mockFileInfo{name: "middle.txt", size: 300, modTime: now, isDir: false},
	}

	sorted := SortFileList(names, infos, "default")
	if sorted[0] != "apple.txt" {
		t.Errorf("Test case 1 failed. First element should be apple.txt, got %s", sorted[0])
	}
	if sorted[2] != "zebra.txt" {
		t.Errorf("Test case 1 failed. Last element should be zebra.txt, got %s", sorted[2])
	}

	// Test case 2: Sort by reverse name
	sorted = SortFileList(names, infos, "reverse")
	if sorted[0] != "zebra.txt" {
		t.Errorf("Test case 2 failed. First element should be zebra.txt, got %s", sorted[0])
	}

	// Test case 3: Sort by size (small to large)
	sorted = SortFileList(names, infos, "smallToLarge")
	if sorted[0] != "zebra.txt" {
		t.Errorf("Test case 3 failed. Smallest file should be zebra.txt, got %s", sorted[0])
	}
}

func TestSortModeIsSupported(t *testing.T) {
	// Test case 1: Valid sort mode
	if !SortModeIsSupported("default") {
		t.Error("Test case 1 failed. 'default' should be a supported sort mode")
	}

	// Test case 2: Invalid sort mode
	if SortModeIsSupported("invalid") {
		t.Error("Test case 2 failed. 'invalid' should not be a supported sort mode")
	}
}
