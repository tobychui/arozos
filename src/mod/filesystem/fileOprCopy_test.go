package filesystem

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// newTestLocalHandler builds a local file system handler rooted at a temp folder
func newTestLocalHandler(t *testing.T, name string) (*FileSystemHandler, string) {
	t.Helper()
	root := t.TempDir()
	fsh, err := NewFileSystemHandler(FileSystemOption{
		Name:      name,
		Uuid:      name,
		Path:      root,
		Access:    "readwrite",
		Hierarchy: "public",
	}, RuntimePersistenceConfig{})
	if err != nil {
		t.Fatalf("NewFileSystemHandler() returned error: %v", err)
	}
	return fsh, filepath.ToSlash(root) + "/"
}

// writeTestFile drops a file of the given size at the given path
func writeTestFile(t *testing.T, path string, size int) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0755)
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), size), 0644); err != nil {
		t.Fatalf("unable to write the test file: %v", err)
	}
}

/*
A single large file used to report nothing at all until it was finished, which
left the progress bar frozen for as long as the transfer took. It must now
report positions while the bytes are still moving.
*/
func TestFileCopyWithProgressReportsWhileCopying(t *testing.T) {
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")

	fileSize := 8 * 1024 * 1024
	srcFile := srcRoot + "big.bin"
	writeTestFile(t, srcFile, fileSize)

	positions := []int64{}
	var reportedTotal int64
	err := FileCopyWithProgress(srcFsh, srcFile, destFsh, destRoot, "overwrite",
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			positions = append(positions, bytesDone)
			reportedTotal = bytesTotal
			return FsOpr_Continue
		})
	if err != nil {
		t.Fatalf("FileCopyWithProgress() returned error: %v", err)
	}

	//The copy must have actually happened
	copied, err := os.ReadFile(destRoot + "big.bin")
	if err != nil {
		t.Fatalf("the copied file is missing: %v", err)
	}
	if len(copied) != fileSize {
		t.Errorf("copied file is %d bytes, want %d", len(copied), fileSize)
	}

	if reportedTotal != int64(fileSize) {
		t.Errorf("reported total = %d, want %d", reportedTotal, fileSize)
	}
	if len(positions) < 2 {
		t.Fatalf("got %d progress reports, want a start and an end at the very least", len(positions))
	}
	if positions[0] != 0 {
		t.Errorf("first report = %d, want the copy to start from 0", positions[0])
	}
	if positions[len(positions)-1] != int64(fileSize) {
		t.Errorf("last report = %d, want the full %d bytes", positions[len(positions)-1], fileSize)
	}

	//Positions must never walk backwards
	for i := 1; i < len(positions); i++ {
		if positions[i] < positions[i-1] {
			t.Errorf("report %d went backwards: %d after %d", i, positions[i], positions[i-1])
		}
	}
}

// A cancelled copy stops where it is and does not leave a half written file
func TestFileCopyWithProgressCancel(t *testing.T) {
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")

	srcFile := srcRoot + "big.bin"
	writeTestFile(t, srcFile, 4*1024*1024)

	err := FileCopyWithProgress(srcFsh, srcFile, destFsh, destRoot, "overwrite",
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			return FsOpr_Cancel
		})
	if err == nil {
		t.Fatal("FileCopyWithProgress() should return an error when the user cancels")
	}

	if _, statErr := os.Stat(destRoot + "big.bin"); statErr == nil {
		t.Error("a cancelled copy should not leave its destination file behind")
	}
}

/*
A folder copy weights its files by size, so the position reported while walking
a folder of mixed sizes must track the bytes rather than the file count.
*/
func TestFileCopyWithProgressFolderIsByteWeighted(t *testing.T) {
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")

	//One tiny file next to one large file
	smallSize := 16
	largeSize := 4 * 1024 * 1024
	writeTestFile(t, srcRoot+"mixed/small.txt", smallSize)
	writeTestFile(t, srcRoot+"mixed/large.bin", largeSize)

	positions := []int64{}
	var reportedTotal int64
	err := FileCopyWithProgress(srcFsh, srcRoot+"mixed", destFsh, destRoot, "overwrite",
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			positions = append(positions, bytesDone)
			reportedTotal = bytesTotal
			return FsOpr_Continue
		})
	if err != nil {
		t.Fatalf("FileCopyWithProgress() returned error: %v", err)
	}

	if reportedTotal != int64(smallSize+largeSize) {
		t.Errorf("reported total = %d, want %d", reportedTotal, smallSize+largeSize)
	}

	//The first report must be the honest starting position, not the position the
	//first file is about to reach
	if positions[0] != 0 {
		t.Errorf("first report = %d, want 0", positions[0])
	}

	//Finishing the tiny file must not move the bar anywhere near half way
	for _, position := range positions {
		ratio := float64(position) / float64(smallSize+largeSize)
		if position <= int64(smallSize) && ratio > 0.05 {
			t.Errorf("position %d is %.0f%% of the folder, the small file should barely move the bar", position, ratio*100)
		}
	}

	if positions[len(positions)-1] != int64(smallSize+largeSize) {
		t.Errorf("last report = %d, want the full %d bytes", positions[len(positions)-1], smallSize+largeSize)
	}

	//Both files must have arrived
	for _, name := range []string{"mixed/small.txt", "mixed/large.bin"} {
		if _, statErr := os.Stat(destRoot + name); statErr != nil {
			t.Errorf("%s is missing at the destination: %v", name, statErr)
		}
	}
}

// The percentage based callback of the original FileCopy must keep working
func TestFileCopyLegacyProgressStillWorks(t *testing.T) {
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")

	srcFile := srcRoot + "file.bin"
	writeTestFile(t, srcFile, 1024*1024)

	percentages := []int{}
	err := FileCopy(srcFsh, srcFile, destFsh, destRoot, "overwrite", func(progress int, filename string) int {
		percentages = append(percentages, progress)
		return FsOpr_Continue
	})
	if err != nil {
		t.Fatalf("FileCopy() returned error: %v", err)
	}

	if len(percentages) == 0 {
		t.Fatal("the legacy callback was never called")
	}
	if percentages[len(percentages)-1] != 100 {
		t.Errorf("last percentage = %d, want 100", percentages[len(percentages)-1])
	}
	if _, statErr := os.Stat(destRoot + "file.bin"); statErr != nil {
		t.Errorf("the copied file is missing: %v", statErr)
	}
}

// A move that has to stream the bytes reports its progress like a copy does
func TestFileMoveWithProgress(t *testing.T) {
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")

	srcFile := srcRoot + "moved.bin"
	fileSize := 2 * 1024 * 1024
	writeTestFile(t, srcFile, fileSize)

	var lastPosition int64
	//fastMove is off so the move goes through the copy and delete path
	err := FileMoveWithProgress(srcFsh, srcFile, destFsh, destRoot, "overwrite", false,
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			lastPosition = bytesDone
			return FsOpr_Continue
		})
	if err != nil {
		t.Fatalf("FileMoveWithProgress() returned error: %v", err)
	}

	if lastPosition != int64(fileSize) {
		t.Errorf("last report = %d, want %d", lastPosition, fileSize)
	}
	if _, statErr := os.Stat(destRoot + "moved.bin"); statErr != nil {
		t.Errorf("the moved file is missing at the destination: %v", statErr)
	}
	if _, statErr := os.Stat(srcFile); statErr == nil {
		t.Error("the source file should be gone after a move")
	}
}

/*
Moving between two folders of one storage is handed to that storage as a rename,
so nothing is streamed no matter how large the file is. This is what saves a
same-share SMB move from being downloaded and uploaded again.
*/
func TestFileMoveSameFileSystemUsesRename(t *testing.T) {
	fsh, root := newTestLocalHandler(t, "onedrive")

	srcFile := root + "from/renamed.bin"
	writeTestFile(t, srcFile, 1024*1024)
	os.MkdirAll(root+"to", 0755)

	reports := 0
	err := FileMoveWithProgress(fsh, srcFile, fsh, root+"to/", "overwrite", true,
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			reports++
			return FsOpr_Continue
		})
	if err != nil {
		t.Fatalf("FileMoveWithProgress() returned error: %v", err)
	}

	if _, statErr := os.Stat(root + "to/renamed.bin"); statErr != nil {
		t.Errorf("the moved file is missing at the destination: %v", statErr)
	}
	if _, statErr := os.Stat(srcFile); statErr == nil {
		t.Error("the source file should be gone after a move")
	}
	if reports != 0 {
		t.Errorf("a storage side move reported %d times, want it to stream nothing", reports)
	}
}

// A whole folder moves in one step too, however many files are inside it
func TestFileMoveSameFileSystemRenamesFolder(t *testing.T) {
	fsh, root := newTestLocalHandler(t, "onedrive")

	writeTestFile(t, root+"from/tree/a.bin", 1024)
	writeTestFile(t, root+"from/tree/nested/b.bin", 2048)
	os.MkdirAll(root+"to", 0755)

	reports := 0
	err := FileMoveWithProgress(fsh, root+"from/tree", fsh, root+"to/", "overwrite", true,
		func(currentFile string, bytesDone int64, bytesTotal int64) int {
			reports++
			return FsOpr_Continue
		})
	if err != nil {
		t.Fatalf("FileMoveWithProgress() returned error: %v", err)
	}

	for _, name := range []string{"to/tree/a.bin", "to/tree/nested/b.bin"} {
		if _, statErr := os.Stat(root + name); statErr != nil {
			t.Errorf("%s is missing after the move: %v", name, statErr)
		}
	}
	if _, statErr := os.Stat(root + "from/tree"); statErr == nil {
		t.Error("the source folder should be gone after a move")
	}
	if reports != 0 {
		t.Errorf("a storage side folder move reported %d times, want it to stream nothing", reports)
	}
}

// SameFileSystem decides whether the storage can be asked to do the move itself
func TestSameFileSystem(t *testing.T) {
	first, _ := newTestLocalHandler(t, "drive_a")
	second, _ := newTestLocalHandler(t, "drive_b")
	sameUUID, _ := newTestLocalHandler(t, "drive_a")

	tests := []struct {
		name string
		src  *FileSystemHandler
		dest *FileSystemHandler
		want bool
	}{
		{"the very same handler", first, first, true},
		{"two handlers of one storage", first, sameUUID, true},
		{"two different storages", first, second, false},
		{"nil source", nil, first, false},
		{"nil destination", first, nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SameFileSystem(tt.src, tt.dest); got != tt.want {
				t.Errorf("SameFileSystem() = %v, want %v", got, tt.want)
			}
		})
	}
}
