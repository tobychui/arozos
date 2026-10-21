package filesystem

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// makeZipSourceFolder creates a folder with fileCount small files and one
// hidden file, and returns its path
func makeZipSourceFolder(t *testing.T, fileCount int) string {
	t.Helper()
	srcFolder := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(filepath.Join(srcFolder, "sub"), 0755); err != nil {
		t.Fatalf("failed to create source folder: %v", err)
	}
	for i := 0; i < fileCount; i++ {
		thisFile := filepath.Join(srcFolder, "file"+strconv.Itoa(i)+".txt")
		if i%2 == 1 {
			thisFile = filepath.Join(srcFolder, "sub", "file"+strconv.Itoa(i)+".txt")
		}
		if err := os.WriteFile(thisFile, []byte("content "+strconv.Itoa(i)), 0644); err != nil {
			t.Fatalf("failed to write source file: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(srcFolder, ".hidden"), []byte("hidden"), 0644); err != nil {
		t.Fatalf("failed to write hidden file: %v", err)
	}
	return srcFolder
}

func TestArozZipFileWithProgressCompletes(t *testing.T) {
	srcFolder := makeZipSourceFolder(t, 6)
	output := filepath.Join(t.TempDir(), "out.zip")

	lastCurrent, lastTotal, lastProgress := 0, 0, float64(0)
	err := ArozZipFileWithProgress([]*FileSystemHandler{nil}, []string{srcFolder}, nil, output, false, func(_ string, current int, total int, progress float64) int {
		lastCurrent, lastTotal, lastProgress = current, total, progress
		return FsOpr_Continue
	})
	if err != nil {
		t.Fatalf("ArozZipFileWithProgress() returned error: %v", err)
	}

	//The hidden file is neither zipped nor counted, so the progress ends at 100%
	if lastTotal != 6 || lastCurrent != 6 {
		t.Errorf("last progress report = %d / %d files, want 6 / 6", lastCurrent, lastTotal)
	}
	if lastProgress != 100 {
		t.Errorf("last progress = %v, want 100", lastProgress)
	}

	archive, err := zip.OpenReader(output)
	if err != nil {
		t.Fatalf("output is not a readable zip: %v", err)
	}
	defer archive.Close()
	if len(archive.File) != 6 {
		t.Errorf("archive holds %d entries, want 6", len(archive.File))
	}
}

func TestArozZipFileWithoutProgressHandler(t *testing.T) {
	srcFolder := makeZipSourceFolder(t, 3)
	output := filepath.Join(t.TempDir(), "out.zip")

	if err := ArozZipFile([]*FileSystemHandler{nil}, []string{srcFolder}, nil, output, false); err != nil {
		t.Fatalf("ArozZipFile() returned error: %v", err)
	}

	archive, err := zip.OpenReader(output)
	if err != nil {
		t.Fatalf("output is not a readable zip: %v", err)
	}
	defer archive.Close()
	if len(archive.File) != 3 {
		t.Errorf("archive holds %d entries, want 3", len(archive.File))
	}
}

func TestArozZipFileWithProgressCancel(t *testing.T) {
	tests := []struct {
		name string
		//Whether the handler cancels at this report
		cancelAt func(current int, total int) bool
		makeSrc  func(t *testing.T) string
	}{
		{
			//Nothing is counted yet while the source folder is still being scanned
			name:     "while scanning",
			cancelAt: func(current int, total int) bool { return total == 0 },
			makeSrc:  func(t *testing.T) string { return makeZipSourceFolder(t, 20) },
		},
		{
			//The only file is counted but not finished, so it is still streaming
			name:     "inside a file",
			cancelAt: func(current int, total int) bool { return total == 1 && current == 0 },
			makeSrc: func(t *testing.T) string {
				srcFile := filepath.Join(t.TempDir(), "large.bin")
				if err := os.WriteFile(srcFile, bytes.Repeat([]byte("arozos"), 1<<20), 0644); err != nil {
					t.Fatalf("failed to write source file: %v", err)
				}
				return srcFile
			},
		},
		{
			name:     "between files",
			cancelAt: func(current int, total int) bool { return current == 2 },
			makeSrc:  func(t *testing.T) string { return makeZipSourceFolder(t, 10) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := tt.makeSrc(t)
			output := filepath.Join(t.TempDir(), "out.zip")

			cancelled := false
			err := ArozZipFileWithProgress([]*FileSystemHandler{nil}, []string{src}, nil, output, false, func(_ string, current int, total int, _ float64) int {
				if cancelled || tt.cancelAt(current, total) {
					cancelled = true
					return FsOpr_Cancel
				}
				return FsOpr_Continue
			})

			if !cancelled {
				t.Fatal("the handler never reached the point where it cancels")
			}
			if err == nil {
				t.Fatal("ArozZipFileWithProgress() should return an error once cancelled")
			}
			if _, statErr := os.Stat(output); !os.IsNotExist(statErr) {
				t.Errorf("a cancelled archive should be removed, stat error = %v", statErr)
			}
		})
	}
}

func TestArozZipFileWithProgressPauseWhileScanning(t *testing.T) {
	srcFolder := makeZipSourceFolder(t, 4)
	output := filepath.Join(t.TempDir(), "out.zip")

	//Pause on the first report, which comes from the scan, then resume
	signals := []int{FsOpr_Pause, FsOpr_Pause}
	pausedReports := 0
	err := ArozZipFileWithProgress([]*FileSystemHandler{nil}, []string{srcFolder}, nil, output, false, func(_ string, current int, total int, _ float64) int {
		if len(signals) > 0 {
			if total != 0 {
				t.Errorf("the pause should be applied while scanning, got a report of %d / %d files", current, total)
			}
			thisSignal := signals[0]
			signals = signals[1:]
			pausedReports++
			return thisSignal
		}
		return FsOpr_Continue
	})
	if err != nil {
		t.Fatalf("ArozZipFileWithProgress() returned error after resuming: %v", err)
	}
	if pausedReports != 2 {
		t.Errorf("handler answered %d pause signals, want 2", pausedReports)
	}

	archive, err := zip.OpenReader(output)
	if err != nil {
		t.Fatalf("output is not a readable zip: %v", err)
	}
	defer archive.Close()
	if len(archive.File) != 4 {
		t.Errorf("archive holds %d entries, want 4", len(archive.File))
	}
}

func TestArozUnzipFileWithProgressCancelInsideFile(t *testing.T) {
	//Build an archive holding one large file
	tmp := t.TempDir()
	srcFile := filepath.Join(tmp, "large.bin")
	if err := os.WriteFile(srcFile, bytes.Repeat([]byte("arozos"), 1<<20), 0644); err != nil {
		t.Fatalf("failed to write source file: %v", err)
	}
	archivePath := filepath.Join(tmp, "large.zip")
	if err := ArozZipFile([]*FileSystemHandler{nil}, []string{srcFile}, nil, archivePath, false); err != nil {
		t.Fatalf("ArozZipFile() returned error: %v", err)
	}

	//The file count only moves once a file is done, so 0 means mid stream
	dest := filepath.Join(tmp, "extracted")
	err := ArozUnzipFileWithProgress([]string{archivePath}, dest, func(_ string, current int, _ int, _ float64) int {
		if current == 0 {
			return FsOpr_Cancel
		}
		return FsOpr_Continue
	})
	if err == nil {
		t.Fatal("ArozUnzipFileWithProgress() should return an error once cancelled")
	}
	if _, statErr := os.Stat(filepath.Join(dest, "large.bin")); !os.IsNotExist(statErr) {
		t.Errorf("a cancelled extraction should not leave the partial file behind, stat error = %v", statErr)
	}
}
