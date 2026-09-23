package filesystem

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// GetFileCreationTime is platform dependent: it must never report a bogus
// timestamp, and must always report "unknown" as (0, false).
func TestGetFileCreationTime(t *testing.T) {
	tmpDir := t.TempDir()

	filePath := filepath.Join(tmpDir, "sample.txt")
	if err := os.WriteFile(filePath, []byte("hello arozos"), 0644); err != nil {
		t.Fatalf("unable to write test file: %v", err)
	}

	fileStat, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("unable to stat test file: %v", err)
	}

	dirStat, err := os.Stat(tmpDir)
	if err != nil {
		t.Fatalf("unable to stat test folder: %v", err)
	}

	tests := []struct {
		name      string
		fileInfo  os.FileInfo
		expectNil bool
	}{
		{name: "nil file info", fileInfo: nil, expectNil: true},
		{name: "regular file", fileInfo: fileStat, expectNil: false},
		{name: "directory", fileInfo: dirStat, expectNil: false},
	}

	//Anything created during this test must sit inside this window
	lowerBound := time.Now().Add(-24 * time.Hour).Unix()
	upperBound := time.Now().Add(24 * time.Hour).Unix()

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			creationTime, ok := GetFileCreationTime(test.fileInfo)
			if test.expectNil && ok {
				t.Errorf("expected no creation time for %s, got %d", test.name, creationTime)
			}

			if !ok {
				if creationTime != 0 {
					t.Errorf("unsupported creation time should be reported as 0, got %d", creationTime)
				}
				return
			}

			if creationTime < lowerBound || creationTime > upperBound {
				t.Errorf("creation time %d is outside the expected range %d - %d", creationTime, lowerBound, upperBound)
			}
		})
	}
}
