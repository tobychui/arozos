package trashfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/utils"
)

// helpers ---------------------------------------------------------------

func setupDir(t *testing.T) (dir string, teardown func()) {
	t.Helper()
	d, err := os.MkdirTemp("", "trashfs_test_*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	return d, func() { os.RemoveAll(d) }
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("MkdirAll %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}

// ---- TrashFSAbstraction unit tests ----

// TestNewTrashFSAbstraction verifies the constructor sets fields correctly.
func TestNewTrashFSAbstraction(t *testing.T) {
	abs := NewTrashFSAbstraction()
	if abs.UUID != TrashFSUUID {
		t.Errorf("UUID = %q, want %q", abs.UUID, TrashFSUUID)
	}
	if abs.Hierarchy != "user" {
		t.Errorf("Hierarchy = %q, want %q", abs.Hierarchy, "user")
	}
	if abs.ReadOnly {
		t.Error("ReadOnly should be false")
	}
}

// TestVirtualPathToRealPath_Root verifies that the trash root path resolves to
// the sentinel value.
func TestVirtualPathToRealPath_Root(t *testing.T) {
	abs := NewTrashFSAbstraction()
	rpath, err := abs.VirtualPathToRealPath("trash:/", "alice")
	if err != nil {
		t.Fatalf("VirtualPathToRealPath(root): %v", err)
	}
	if rpath != TrashRootSentinel {
		t.Errorf("root resolved to %q, want TrashRootSentinel", rpath)
	}

	// Same result when subpath arrives already stripped (as GetIDFromVirtualPath produces).
	rpath2, err := abs.VirtualPathToRealPath("", "alice")
	if err != nil {
		t.Fatalf("VirtualPathToRealPath(''): %v", err)
	}
	if rpath2 != TrashRootSentinel {
		t.Errorf("empty subpath resolved to %q, want TrashRootSentinel", rpath2)
	}
}

// TestVirtualPathRoundtrip verifies that RealPathToVirtualPath and
// VirtualPathToRealPath are inverse operations for concrete file paths.
func TestVirtualPathRoundtrip(t *testing.T) {
	abs := NewTrashFSAbstraction()
	root, teardown := setupDir(t)
	defer teardown()

	realpath := filepath.Join(root, "users", "alice", "documents", ".metadata", ".trash", "report.pdf.1700000000")
	writeFile(t, realpath, "PDF bytes")

	// real → virtual
	vpath, err := abs.RealPathToVirtualPath(realpath, "alice")
	if err != nil {
		t.Fatalf("RealPathToVirtualPath: %v", err)
	}
	if !strings.HasPrefix(vpath, TrashFSUUID+":/") {
		t.Errorf("virtual path %q does not start with %q", vpath, TrashFSUUID+":/")
	}

	// virtual → real (round-trip)
	rpath, err := abs.VirtualPathToRealPath(vpath, "alice")
	if err != nil {
		t.Fatalf("VirtualPathToRealPath: %v", err)
	}
	want := filepath.ToSlash(filepath.Clean(realpath))
	got := filepath.ToSlash(filepath.Clean(rpath))
	if got != want {
		t.Errorf("round-trip mismatch:\n  got  %s\n  want %s", got, want)
	}
}

// TestVirtualPathToRealPath_Invalid checks that malformed hex paths are rejected.
func TestVirtualPathToRealPath_Invalid(t *testing.T) {
	abs := NewTrashFSAbstraction()
	_, err := abs.VirtualPathToRealPath("trash:/ZZZZ_not_hex", "alice")
	if err == nil {
		t.Error("expected error for invalid hex path, got nil")
	}
}

// TestSentinelBehaviour verifies that operations on the sentinel root behave
// as documented (FileExists=true, IsDir=true, ReadDir returns empty list).
func TestSentinelBehaviour(t *testing.T) {
	abs := NewTrashFSAbstraction()

	if !abs.FileExists(TrashRootSentinel) {
		t.Error("FileExists(sentinel) should be true")
	}
	if !abs.IsDir(TrashRootSentinel) {
		t.Error("IsDir(sentinel) should be true")
	}

	entries, err := abs.ReadDir(TrashRootSentinel)
	if err != nil {
		t.Fatalf("ReadDir(sentinel): %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("ReadDir(sentinel) returned %d entries, want 0", len(entries))
	}

	fi, err := abs.Stat(TrashRootSentinel)
	if err != nil {
		t.Fatalf("Stat(sentinel): %v", err)
	}
	if !fi.IsDir() {
		t.Error("Stat(sentinel).IsDir() should be true")
	}
}

// TestRemovePermanentlyDeletesFile verifies that Remove permanently deletes
// the underlying file (no move to another location).
func TestRemovePermanentlyDeletesFile(t *testing.T) {
	root, teardown := setupDir(t)
	defer teardown()
	abs := NewTrashFSAbstraction()

	trashFile := filepath.Join(root, "users", "alice", ".metadata", ".trash", "notes.txt.1700000001")
	writeFile(t, trashFile, "some notes")

	if err := abs.Remove(trashFile); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if utils.FileExists(trashFile) {
		t.Error("file still exists after Remove")
	}
}

// TestRemoveAllPermanentlyDeletesDirectory verifies that RemoveAll permanently
// removes an entire directory tree.
func TestRemoveAllPermanentlyDeletesDirectory(t *testing.T) {
	root, teardown := setupDir(t)
	defer teardown()
	abs := NewTrashFSAbstraction()

	trashDir := filepath.Join(root, "users", "bob", ".metadata", ".trash", "project.1700000002")
	writeFile(t, filepath.Join(trashDir, "file.go"), "package main")
	writeFile(t, filepath.Join(trashDir, "sub", "inner.go"), "package main")

	if err := abs.RemoveAll(trashDir); err != nil {
		t.Fatalf("RemoveAll: %v", err)
	}
	if utils.FileExists(trashDir) {
		t.Error("directory still exists after RemoveAll")
	}
}

// ---- Package-level helper tests ----

// TestRealPathToTrashVPath verifies the package-level convenience function.
func TestRealPathToTrashVPath(t *testing.T) {
	realpath := "/files/users/alice/.metadata/.trash/report.pdf.1700000000"
	vpath := RealPathToTrashVPath(realpath)
	if !strings.HasPrefix(vpath, TrashFSUUID+":/") {
		t.Errorf("vpath %q does not start with trash:/", vpath)
	}
	decoded, err := TrashVPathToRealPath(vpath)
	if err != nil {
		t.Fatalf("TrashVPathToRealPath: %v", err)
	}
	want := filepath.ToSlash(filepath.Clean(realpath))
	if filepath.ToSlash(filepath.Clean(decoded)) != want {
		t.Errorf("decoded = %q, want %q", decoded, want)
	}
}

// TestTrashVPathToRealPath_RootErrors verifies that the root sentinel path
// returns an error (not a real path).
func TestTrashVPathToRealPath_RootErrors(t *testing.T) {
	_, err := TrashVPathToRealPath("trash:/")
	if err == nil {
		t.Error("expected error for root vpath, got nil")
	}
}

// TestTrashVPathToRealPath_InvalidHex verifies that malformed paths are rejected.
func TestTrashVPathToRealPath_InvalidHex(t *testing.T) {
	_, err := TrashVPathToRealPath("trash:/not_valid_hex!")
	if err == nil {
		t.Error("expected error for invalid hex, got nil")
	}
}

// TestIsLegacyTrashFile verifies detection of legacy .trash directory entries.
func TestIsLegacyTrashFile(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/files/users/alice/.metadata/.trash/report.pdf.1700000000", true},
		{"/files/users/alice/documents/.metadata/.trash/notes.txt.1234567890", true},
		{"/files/users/alice/documents/notes.txt", false},
		{"/files/users/alice/.trash/notes.txt", false},   // wrong dir name
		{"/files/users/alice/.metadata/notes.txt", false}, // not in .trash
	}
	for _, tc := range cases {
		got := IsLegacyTrashFile(tc.path)
		if got != tc.want {
			t.Errorf("IsLegacyTrashFile(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

// ---- Integration-style workflow tests ----

// TestRecycleWorkflow simulates the full recycle → list → permanent-delete
// workflow at the filesystem level (no HTTP layer).
//
//  1. A file exists in a simulated user storage directory.
//  2. It is "recycled" by renaming into .metadata/.trash/ on the SAME FS
//     (mimicking what file_system.go does — no cross-device copy).
//  3. system_fs_listTrash equivalent: Walk finds the file in .trash.
//  4. The trash:/ vpath is built and round-trips correctly.
//  5. Permanently delete via TrashFSAbstraction.RemoveAll.
func TestRecycleWorkflow(t *testing.T) {
	root, teardown := setupDir(t)
	defer teardown()
	abs := NewTrashFSAbstraction()
	username := "frank"

	// Source file inside the simulated storage root.
	srcFile := filepath.Join(root, "users", username, "work", "spreadsheet.xlsx")
	writeFile(t, srcFile, "XLSX data")

	// Step 1: recycle — move to adjacent .metadata/.trash/ (same volume, fast rename).
	ts := time.Now().Unix()
	trashDir := filepath.Join(filepath.Dir(srcFile), ".metadata", ".trash")
	if err := os.MkdirAll(trashDir, 0755); err != nil {
		t.Fatalf("MkdirAll trash dir: %v", err)
	}
	trashName := filepath.Base(srcFile) + "." + utils.Int64ToString(ts)
	trashPath := filepath.Join(trashDir, trashName)
	if err := os.Rename(srcFile, trashPath); err != nil {
		t.Fatalf("simulated recycle (Rename): %v", err)
	}

	// Step 2: source must be gone.
	if utils.FileExists(srcFile) {
		t.Error("source file still exists after recycle")
	}

	// Step 3: walk the root to find .trash entries (mimics system_fs_listTrash).
	var foundPaths []string
	filepath.Walk(filepath.Join(root, "users", username), func(path string, info os.FileInfo, err error) error {
		if err == nil && filepath.Base(filepath.Dir(path)) == LegacyTrashDir {
			foundPaths = append(foundPaths, path)
		}
		return nil
	})
	if len(foundPaths) == 0 {
		t.Fatal("listTrash walk found no trashed files")
	}

	// Step 4: build trash:/ vpath and verify round-trip.
	trashVpath := RealPathToTrashVPath(trashPath)
	if !strings.HasPrefix(trashVpath, TrashFSUUID+":/") {
		t.Errorf("trash vpath %q has wrong prefix", trashVpath)
	}
	decoded, err := TrashVPathToRealPath(trashVpath)
	if err != nil {
		t.Fatalf("TrashVPathToRealPath: %v", err)
	}
	if filepath.ToSlash(filepath.Clean(decoded)) != filepath.ToSlash(filepath.Clean(trashPath)) {
		t.Errorf("decoded path mismatch: got %s, want %s", decoded, trashPath)
	}

	// Step 5: permanent delete via TrashFSAbstraction.
	if err := abs.Remove(trashPath); err != nil {
		t.Fatalf("Remove (permanent delete): %v", err)
	}
	if utils.FileExists(trashPath) {
		t.Error("trashed file still exists after permanent delete")
	}
}

// TestRestoreWorkflow simulates restoring a file from .trash to its original
// location using the same path logic as system_fs_restoreFile.
func TestRestoreWorkflow(t *testing.T) {
	root, teardown := setupDir(t)
	defer teardown()

	username := "grace"

	// Create a file as if it had already been recycled.
	trashDir := filepath.Join(root, "users", username, "media", ".metadata", ".trash")
	basename := "music.mp3"
	ts := int64(1700000100)
	trashName := basename + "." + utils.Int64ToString(ts)
	trashPath := filepath.Join(trashDir, trashName)
	writeFile(t, trashPath, "MP3 bytes")

	// Confirm the file is recognised as a legacy trash file.
	if !IsLegacyTrashFile(trashPath) {
		t.Fatal("IsLegacyTrashFile returned false for a .trash path")
	}

	// Simulate restore (same logic as system_fs_restoreFile):
	// strip timestamp suffix, go up two levels.
	origName := strings.TrimSuffix(filepath.Base(trashPath), filepath.Ext(filepath.Base(trashPath)))
	restoreRoot := filepath.Dir(filepath.Dir(filepath.Dir(trashPath)))
	targetPath := filepath.Join(restoreRoot, origName)

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		t.Fatalf("MkdirAll restore parent: %v", err)
	}
	if err := os.Rename(trashPath, targetPath); err != nil {
		t.Fatalf("Rename (restore): %v", err)
	}

	// Verify the original name was correctly reconstructed.
	if filepath.Base(targetPath) != basename {
		t.Errorf("restored filename = %q, want %q", filepath.Base(targetPath), basename)
	}
	if !utils.FileExists(targetPath) {
		t.Error("restored file not found at expected location")
	}
	if utils.FileExists(trashPath) {
		t.Error("trashed file still exists after restore")
	}
}
