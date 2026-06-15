package localversion

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// newTestFSH creates a FileSystemHandler backed by a temporary local directory.
func newTestFSH(t *testing.T) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	abs := localfs.NewLocalFileSystemAbstraction("TEST", dir+"/", "public", false)
	fsh := &filesystem.FileSystemHandler{
		Name:                  "test",
		UUID:                  "TEST",
		Path:                  dir + "/",
		ReadOnly:              false,
		Hierarchy:             "public",
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: abs,
		Filesystem:            "ext4",
	}
	return fsh, dir
}

// --- GetFileVersionData ---

func TestGetFileVersionData_NoVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		// Glob on a non-existent pattern is not typically an error; allow it
		t.Logf("GetFileVersionData returned non-fatal error: %v", err)
	}
	if vl == nil {
		t.Fatal("expected non-nil VersionList")
	}
	if vl.CurrentFile != "test.txt" {
		t.Errorf("expected CurrentFile = 'test.txt', got %q", vl.CurrentFile)
	}
	if len(vl.Versions) != 0 {
		t.Errorf("expected 0 versions, got %d", len(vl.Versions))
	}
}

func TestGetFileVersionData_WithVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "data.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Create a snapshot
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Fatalf("GetFileVersionData returned error: %v", err)
	}
	if len(vl.Versions) != 1 {
		t.Errorf("expected 1 version, got %d", len(vl.Versions))
	}
	if vl.CurrentFile != "data.txt" {
		t.Errorf("expected CurrentFile='data.txt', got %q", vl.CurrentFile)
	}
}

func TestGetFileVersionData_MultipleVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "multi.txt")
	if err := os.WriteFile(target, []byte("v1"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Create two snapshots with a tiny delay to get distinct IDs
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot (1) failed: %v", err)
	}
	time.Sleep(1100 * time.Millisecond) // ensure different timestamp
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot (2) failed: %v", err)
	}

	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Fatalf("GetFileVersionData returned error: %v", err)
	}
	if len(vl.Versions) != 2 {
		t.Errorf("expected 2 versions, got %d", len(vl.Versions))
	}
}

// --- CreateFileSnapshot ---

func TestCreateFileSnapshot_NonExistentFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "ghost.txt")

	err := CreateFileSnapshot(fsh, target)
	if err == nil {
		t.Fatal("expected error for non-existent source file, got nil")
	}
}

func TestCreateFileSnapshot_CreatesSnapshotFolder(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "snap.txt")
	if err := os.WriteFile(target, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// Verify the snapshot folder exists under .metadata/.localver/
	metaDir := filepath.Join(dir, ".metadata", ".localver")
	entries, err := os.ReadDir(metaDir)
	if err != nil {
		t.Fatalf("expected snapshot folder at %q: %v", metaDir, err)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one snapshot folder")
	}
}

// --- RemoveFileHistory ---

func TestRemoveFileHistory_NonExistentHistory(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := RemoveFileHistory(fsh, target, "2000-01-01_00-00-00")
	if err == nil {
		t.Fatal("expected error for non-existent history, got nil")
	}
}

func TestRemoveFileHistory_ExistingSnapshot(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "removable.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// List versions to get the historyID
	vl, err := GetFileVersionData(fsh, target)
	if err != nil || len(vl.Versions) == 0 {
		t.Fatalf("expected at least 1 version, err=%v", err)
	}
	histID := vl.Versions[0].HistoryID

	err = RemoveFileHistory(fsh, target, histID)
	if err != nil {
		t.Errorf("RemoveFileHistory returned error: %v", err)
	}
}

// --- RemoveAllRelatedFileHistory ---

func TestRemoveAllRelatedFileHistory_NoVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "noversions.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Should not error even if no versions exist
	err := RemoveAllRelatedFileHistory(fsh, target)
	if err != nil {
		t.Errorf("RemoveAllRelatedFileHistory returned error: %v", err)
	}
}

func TestRemoveAllRelatedFileHistory_WithVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "cleanup.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	err := RemoveAllRelatedFileHistory(fsh, target)
	if err != nil {
		t.Errorf("RemoveAllRelatedFileHistory returned error: %v", err)
	}
}

// --- CleanExpiredVersionBackups ---

func TestCleanExpiredVersionBackups_RemovesOldVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "old.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// maxReserveTime = -1 --> all files are guaranteed "too old" (now - mtime > -1 always true)
	// Using a negative value ensures time.Now().Unix()-mtime > maxReserveTime is always true.
	CleanExpiredVersionBackups(fsh, dir, -1)

	// After cleaning, the snapshot file itself should be removed.
	// The VersionList Glob pattern ends with "*/filename", so if the file is gone
	// it won't appear as a version even if the folder remains.
	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Logf("GetFileVersionData after clean: %v", err)
	}
	if vl != nil && len(vl.Versions) != 0 {
		t.Errorf("expected 0 versions after cleanup, got %d", len(vl.Versions))
	}
}

func TestCleanExpiredVersionBackups_KeepsRecentVersions(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "recent.txt")
	if err := os.WriteFile(target, []byte("data"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// maxReserveTime = 1 year --> nothing should be removed
	CleanExpiredVersionBackups(fsh, dir, 365*24*3600)

	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Fatalf("GetFileVersionData returned error: %v", err)
	}
	if len(vl.Versions) == 0 {
		t.Error("expected versions to remain after cleanup with large maxReserveTime")
	}
}

// --- RestoreFileHistory ---

func TestRestoreFileHistory_NonExistentVersion(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "restore.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := RestoreFileHistory(fsh, target, "2000-01-01_00-00-00")
	if err == nil {
		t.Fatal("expected error for non-existent version, got nil")
	}
	if err.Error() != "File version not exists" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestRestoreFileHistory_Success(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "restore.txt")
	originalContent := []byte("original content")
	if err := os.WriteFile(target, originalContent, 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Create a snapshot of the original content
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// Get the snapshot ID
	vl, err := GetFileVersionData(fsh, target)
	if err != nil || len(vl.Versions) == 0 {
		t.Fatalf("expected at least 1 version, err=%v", err)
	}
	histID := vl.Versions[0].HistoryID

	// Modify the file
	if err := os.WriteFile(target, []byte("modified content"), 0644); err != nil {
		t.Fatalf("failed to modify test file: %v", err)
	}

	// Restore
	err = RestoreFileHistory(fsh, target, histID)
	if err != nil {
		t.Fatalf("RestoreFileHistory returned error: %v", err)
	}

	// File should now contain restored content
	restored, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("failed to read restored file: %v", err)
	}
	if string(restored) != string(originalContent) {
		t.Errorf("expected restored content %q, got %q", originalContent, restored)
	}
}

func TestRestoreFileHistory_MultipleVersions_RemovesLater(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "multiversion.txt")
	if err := os.WriteFile(target, []byte("v1"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Create first snapshot (v1)
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot (v1) failed: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)

	// Modify and create second snapshot (v2)
	if err := os.WriteFile(target, []byte("v2"), 0644); err != nil {
		t.Fatalf("failed to modify file for v2: %v", err)
	}
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot (v2) failed: %v", err)
	}

	// List versions — should be sorted reverse, so [0]=v2, [1]=v1
	vl, err := GetFileVersionData(fsh, target)
	if err != nil || len(vl.Versions) < 2 {
		t.Fatalf("expected 2 versions, got %d, err=%v", len(vl.Versions), err)
	}

	// Restore to the oldest version (v1 = last in reversed list)
	oldestHistID := vl.Versions[len(vl.Versions)-1].HistoryID
	err = RestoreFileHistory(fsh, target, oldestHistID)
	if err != nil {
		t.Fatalf("RestoreFileHistory returned error: %v", err)
	}

	// After restoring to v1, v2 should be removed
	vl2, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Logf("GetFileVersionData after restore: %v", err)
	}
	if vl2 != nil && len(vl2.Versions) >= 2 {
		t.Errorf("expected versions after restored snapshot to be removed, got %d versions", len(vl2.Versions))
	}
}

// --- inLocalVersionFolder (internal, tested via snapshot path structure) ---

func TestInLocalVersionFolder_Via_SnapshotPath(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "check.txt")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create file: %v", err)
	}
	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	// Walk and verify at least one path is in the localver folder
	found := false
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if strings.Contains(filepath.ToSlash(path), "/.localver/") {
			found = true
		}
		return nil
	})
	if !found {
		t.Error("expected to find path inside .localver folder after CreateFileSnapshot")
	}
}

// --- FileSnapshot struct fields ---

func TestFileSnapshot_Fields(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "fields.txt")
	if err := os.WriteFile(target, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	if err := CreateFileSnapshot(fsh, target); err != nil {
		t.Fatalf("CreateFileSnapshot failed: %v", err)
	}

	vl, err := GetFileVersionData(fsh, target)
	if err != nil {
		t.Fatalf("GetFileVersionData returned error: %v", err)
	}
	if len(vl.Versions) == 0 {
		t.Fatal("expected at least one version")
	}

	snap := vl.Versions[0]
	if snap.Filename != "fields.txt" {
		t.Errorf("expected Filename='fields.txt', got %q", snap.Filename)
	}
	if snap.HistoryID == "" {
		t.Error("expected non-empty HistoryID")
	}
	if snap.Relpath == "" {
		t.Error("expected non-empty Relpath")
	}
	if !strings.HasPrefix(snap.Relpath, ".metadata/.localver/") {
		t.Errorf("Relpath should start with '.metadata/.localver/', got %q", snap.Relpath)
	}
}
