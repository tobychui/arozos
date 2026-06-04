package fssort

import (
	"io/fs"
	"os"
	"path/filepath"
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

func (m *mockFileInfo) Name() string       { return m.name }
func (m *mockFileInfo) Size() int64        { return m.size }
func (m *mockFileInfo) Mode() fs.FileMode  { return 0644 }
func (m *mockFileInfo) ModTime() time.Time { return m.modTime }
func (m *mockFileInfo) IsDir() bool        { return m.isDir }
func (m *mockFileInfo) Sys() any           { return nil }

func newMockFileInfo(name string, size int64, modTime time.Time) fs.FileInfo {
	return &mockFileInfo{
		name:    name,
		size:    size,
		modTime: modTime,
	}
}

// baseTime is a reference time used for relative mod times in tests
var baseTime = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

func TestSortFileList_Default(t *testing.T) {
	paths := []string{"/dir/charlie.txt", "/dir/alpha.txt", "/dir/Beta.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("charlie.txt", 100, baseTime),
		newMockFileInfo("alpha.txt", 200, baseTime),
		newMockFileInfo("Beta.txt", 300, baseTime),
	}

	result := SortFileList(paths, infos, "default")

	expected := []string{"/dir/alpha.txt", "/dir/Beta.txt", "/dir/charlie.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_Reverse(t *testing.T) {
	paths := []string{"/dir/alpha.txt", "/dir/charlie.txt", "/dir/Beta.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("alpha.txt", 100, baseTime),
		newMockFileInfo("charlie.txt", 200, baseTime),
		newMockFileInfo("Beta.txt", 300, baseTime),
	}

	result := SortFileList(paths, infos, "reverse")

	expected := []string{"/dir/charlie.txt", "/dir/Beta.txt", "/dir/alpha.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_SmallToLarge(t *testing.T) {
	paths := []string{"/dir/big.txt", "/dir/small.txt", "/dir/medium.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("big.txt", 1000, baseTime),
		newMockFileInfo("small.txt", 10, baseTime),
		newMockFileInfo("medium.txt", 500, baseTime),
	}

	result := SortFileList(paths, infos, "smallToLarge")

	expected := []string{"/dir/small.txt", "/dir/medium.txt", "/dir/big.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_LargeToSmall(t *testing.T) {
	paths := []string{"/dir/big.txt", "/dir/small.txt", "/dir/medium.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("big.txt", 1000, baseTime),
		newMockFileInfo("small.txt", 10, baseTime),
		newMockFileInfo("medium.txt", 500, baseTime),
	}

	result := SortFileList(paths, infos, "largeToSmall")

	expected := []string{"/dir/big.txt", "/dir/medium.txt", "/dir/small.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_MostRecent(t *testing.T) {
	oldest := baseTime
	middle := baseTime.Add(time.Hour)
	newest := baseTime.Add(2 * time.Hour)

	paths := []string{"/dir/oldest.txt", "/dir/newest.txt", "/dir/middle.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("oldest.txt", 100, oldest),
		newMockFileInfo("newest.txt", 100, newest),
		newMockFileInfo("middle.txt", 100, middle),
	}

	result := SortFileList(paths, infos, "mostRecent")

	expected := []string{"/dir/newest.txt", "/dir/middle.txt", "/dir/oldest.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_MostRecent_TieBreakByName(t *testing.T) {
	// When mod times are equal, should sort by name ascending
	paths := []string{"/dir/beta.txt", "/dir/alpha.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("beta.txt", 100, baseTime),
		newMockFileInfo("alpha.txt", 100, baseTime),
	}

	result := SortFileList(paths, infos, "mostRecent")

	if len(result) != 2 {
		t.Fatalf("expected 2 results, got %d", len(result))
	}
	if result[0] != "/dir/alpha.txt" {
		t.Errorf("result[0] = %q, want %q", result[0], "/dir/alpha.txt")
	}
	if result[1] != "/dir/beta.txt" {
		t.Errorf("result[1] = %q, want %q", result[1], "/dir/beta.txt")
	}
}

func TestSortFileList_LeastRecent(t *testing.T) {
	oldest := baseTime
	middle := baseTime.Add(time.Hour)
	newest := baseTime.Add(2 * time.Hour)

	paths := []string{"/dir/newest.txt", "/dir/oldest.txt", "/dir/middle.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("newest.txt", 100, newest),
		newMockFileInfo("oldest.txt", 100, oldest),
		newMockFileInfo("middle.txt", 100, middle),
	}

	result := SortFileList(paths, infos, "leastRecent")

	expected := []string{"/dir/oldest.txt", "/dir/middle.txt", "/dir/newest.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_LeastRecent_TieBreakByName(t *testing.T) {
	// When mod times are equal, leastRecent sorts by name descending
	paths := []string{"/dir/alpha.txt", "/dir/beta.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("alpha.txt", 100, baseTime),
		newMockFileInfo("beta.txt", 100, baseTime),
	}

	result := SortFileList(paths, infos, "leastRecent")

	if len(result) != 2 {
		t.Fatalf("expected 2 results, got %d", len(result))
	}
	if result[0] != "/dir/beta.txt" {
		t.Errorf("result[0] = %q, want %q", result[0], "/dir/beta.txt")
	}
	if result[1] != "/dir/alpha.txt" {
		t.Errorf("result[1] = %q, want %q", result[1], "/dir/alpha.txt")
	}
}

func TestSortFileList_Smart(t *testing.T) {
	// Natural sort: file2 should come before file10
	paths := []string{"/dir/file10.txt", "/dir/file2.txt", "/dir/file1.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("file10.txt", 100, baseTime),
		newMockFileInfo("file2.txt", 200, baseTime),
		newMockFileInfo("file1.txt", 300, baseTime),
	}

	result := SortFileList(paths, infos, "smart")

	expected := []string{"/dir/file1.txt", "/dir/file2.txt", "/dir/file10.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_FileTypeAsce(t *testing.T) {
	paths := []string{"/dir/document.txt", "/dir/image.png", "/dir/archive.gz"}
	infos := []fs.FileInfo{
		newMockFileInfo("document.txt", 100, baseTime),
		newMockFileInfo("image.png", 200, baseTime),
		newMockFileInfo("archive.gz", 300, baseTime),
	}

	result := SortFileList(paths, infos, "fileTypeAsce")

	// gz < png < txt
	expected := []string{"/dir/archive.gz", "/dir/image.png", "/dir/document.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_FileTypeDesc(t *testing.T) {
	paths := []string{"/dir/document.txt", "/dir/image.png", "/dir/archive.gz"}
	infos := []fs.FileInfo{
		newMockFileInfo("document.txt", 100, baseTime),
		newMockFileInfo("image.png", 200, baseTime),
		newMockFileInfo("archive.gz", 300, baseTime),
	}

	result := SortFileList(paths, infos, "fileTypeDesc")

	// txt > png > gz
	expected := []string{"/dir/document.txt", "/dir/image.png", "/dir/archive.gz"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r != expected[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, expected[i])
		}
	}
}

func TestSortFileList_InvalidLengthMismatch(t *testing.T) {
	// Mismatched lengths should return original list unchanged
	paths := []string{"/dir/a.txt", "/dir/b.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("a.txt", 100, baseTime),
		// only one info for two paths
	}

	result := SortFileList(paths, infos, "default")

	// Should return the original list unchanged
	if len(result) != len(paths) {
		t.Fatalf("expected %d results, got %d", len(paths), len(result))
	}
	for i, r := range result {
		if r != paths[i] {
			t.Errorf("result[%d] = %q, want %q", i, r, paths[i])
		}
	}
}

func TestSortFileList_EmptyList(t *testing.T) {
	result := SortFileList([]string{}, []fs.FileInfo{}, "default")
	if len(result) != 0 {
		t.Errorf("expected empty result, got %v", result)
	}
}

func TestSortFileList_UnknownMode(t *testing.T) {
	// Unknown sort mode should still return results (just unsorted)
	paths := []string{"/dir/b.txt", "/dir/a.txt"}
	infos := []fs.FileInfo{
		newMockFileInfo("b.txt", 100, baseTime),
		newMockFileInfo("a.txt", 200, baseTime),
	}

	result := SortFileList(paths, infos, "unknownMode")
	if len(result) != 2 {
		t.Errorf("expected 2 results for unknown mode, got %d", len(result))
	}
}

func TestSortNaturalFilelist(t *testing.T) {
	filelist := []*sortBufferedStructure{
		{Filename: "file10.txt", Filepath: "/dir/file10.txt"},
		{Filename: "file2.txt", Filepath: "/dir/file2.txt"},
		{Filename: "file1.txt", Filepath: "/dir/file1.txt"},
		{Filename: "file20.txt", Filepath: "/dir/file20.txt"},
	}

	result := SortNaturalFilelist(filelist)

	expected := []string{"file1.txt", "file2.txt", "file10.txt", "file20.txt"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d results, got %d", len(expected), len(result))
	}
	for i, r := range result {
		if r.Filename != expected[i] {
			t.Errorf("result[%d].Filename = %q, want %q", i, r.Filename, expected[i])
		}
	}
}

func TestValidSortModes(t *testing.T) {
	expectedModes := []string{"default", "reverse", "smallToLarge", "largeToSmall", "mostRecent", "leastRecent", "smart", "fileTypeAsce", "fileTypeDesc"}
	if len(ValidSortModes) != len(expectedModes) {
		t.Fatalf("ValidSortModes has %d entries, want %d", len(ValidSortModes), len(expectedModes))
	}
	for _, mode := range expectedModes {
		found := false
		for _, vm := range ValidSortModes {
			if vm == mode {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("ValidSortModes missing expected mode %q", mode)
		}
	}
}

func TestSortModeIsSupported(t *testing.T) {
	for _, mode := range ValidSortModes {
		if !SortModeIsSupported(mode) {
			t.Errorf("SortModeIsSupported(%q) = false, want true", mode)
		}
	}
	if SortModeIsSupported("invalidMode") {
		t.Errorf("SortModeIsSupported(\"invalidMode\") = true, want false")
	}
	if SortModeIsSupported("") {
		t.Errorf("SortModeIsSupported(\"\") = true, want false")
	}
}

func TestSortDirEntryList(t *testing.T) {
	// Create temp files to get real DirEntry objects
	tmpDir := t.TempDir()
	files := []string{"charlie.txt", "alpha.txt", "beta.txt"}
	for _, name := range files {
		f, err := os.Create(filepath.Join(tmpDir, name))
		if err != nil {
			t.Fatalf("failed to create temp file %s: %v", name, err)
		}
		f.Close()
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("failed to read temp dir: %v", err)
	}

	sorted := SortDirEntryList(entries, "default")
	if len(sorted) != 3 {
		t.Fatalf("expected 3 sorted entries, got %d", len(sorted))
	}

	expectedNames := []string{"alpha.txt", "beta.txt", "charlie.txt"}
	for i, entry := range sorted {
		if entry.Name() != expectedNames[i] {
			t.Errorf("sorted[%d].Name() = %q, want %q", i, entry.Name(), expectedNames[i])
		}
	}
}
