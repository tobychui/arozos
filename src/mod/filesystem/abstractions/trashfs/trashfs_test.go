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

// setupTrashDir creates a temporary directory that acts as the trash root
// (i.e. the path you would pass to NewTrashFSAbstraction) and returns the
// path together with a teardown function.
func setupTrashDir(t *testing.T) (trashRoot string, teardown func()) {
	t.Helper()
	dir, err := os.MkdirTemp("", "trashfs_test_*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	return dir, func() { os.RemoveAll(dir) }
}

// newTestAbstraction returns a TrashFSAbstraction backed by trashRoot.
func newTestAbstraction(trashRoot string) TrashFSAbstraction {
	return NewTrashFSAbstraction(TrashFSUUID, trashRoot, "user", false)
}

// createUserDir creates the user-isolated subtree inside trashRoot so that
// VirtualPathToRealPath("trash:/", username) resolves without error.
func createUserDir(t *testing.T, trashRoot, username string) string {
	t.Helper()
	userDir := filepath.Join(trashRoot, "users", username)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll %s: %v", userDir, err)
	}
	return userDir
}

// writeFile is a small helper that writes content to path, creating parent
// directories as needed.
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}

// TestNewTrashFSAbstraction verifies that the constructor sets fields correctly
// and that the backing directory can be resolved via VirtualPathToRealPath.
func TestNewTrashFSAbstraction(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)

	if abs.UUID != TrashFSUUID {
		t.Errorf("UUID = %q, want %q", abs.UUID, TrashFSUUID)
	}
	if abs.Hierarchy != "user" {
		t.Errorf("Hierarchy = %q, want %q", abs.Hierarchy, "user")
	}
	if abs.ReadOnly {
		t.Error("ReadOnly should be false")
	}

	// VirtualPathToRealPath for the root should not error even though the
	// users/ subdirectory may not exist yet.
	username := "testuser"
	rpath, err := abs.VirtualPathToRealPath("trash:/", username)
	if err != nil {
		t.Fatalf("VirtualPathToRealPath: %v", err)
	}
	if rpath == "" {
		t.Error("VirtualPathToRealPath returned empty string")
	}
}

// TestVirtualPathRoundtrip verifies that VirtualPathToRealPath and
// RealPathToVirtualPath are inverse operations for a concrete file path.
func TestVirtualPathRoundtrip(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "alice"
	userDir := createUserDir(t, trashRoot, username)

	// Write a dummy file inside the user's trash directory.
	trashFile := filepath.Join(userDir, "1700000000_report.pdf")
	writeFile(t, trashFile, "dummy content")

	// real → virtual
	vpath, err := abs.RealPathToVirtualPath(trashFile, username)
	if err != nil {
		t.Fatalf("RealPathToVirtualPath: %v", err)
	}
	if !strings.HasPrefix(vpath, TrashFSUUID+":") {
		t.Errorf("virtual path %q should start with %q", vpath, TrashFSUUID+":")
	}

	// virtual → real (round-trip)
	rpath, err := abs.VirtualPathToRealPath(vpath, username)
	if err != nil {
		t.Fatalf("VirtualPathToRealPath: %v", err)
	}

	// Normalise separators before comparing.
	want := filepath.ToSlash(filepath.Clean(trashFile))
	got := filepath.ToSlash(filepath.Clean(rpath))
	if got != want {
		t.Errorf("round-trip mismatch:\n  got  %s\n  want %s", got, want)
	}
}

// TestRemovePermanentlyDeletesFile ensures that Remove deletes both the trashed
// file and its .trashinfo sidecar (if one exists).
func TestRemovePermanentlyDeletesFile(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "alice"
	userDir := createUserDir(t, trashRoot, username)

	trashFile := filepath.Join(userDir, "1700000001_notes.txt")
	writeFile(t, trashFile, "some notes")

	// Write a sidecar as well.
	info := TrashInfo{
		OriginalVpath:    "user:/documents/notes.txt",
		OriginalFilename: "notes.txt",
		DeletedAt:        1700000001,
	}
	if err := WriteTrashInfo(trashFile, info); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	// Both the file and sidecar should exist before the call.
	if !utils.FileExists(trashFile) {
		t.Fatal("trashFile does not exist before Remove")
	}
	sidecar := trashFile + TrashInfoExt
	if !utils.FileExists(sidecar) {
		t.Fatal("sidecar does not exist before Remove")
	}

	if err := abs.Remove(trashFile); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	// Both should be gone.
	if utils.FileExists(trashFile) {
		t.Error("trashFile still exists after Remove")
	}
	if utils.FileExists(sidecar) {
		t.Error("sidecar still exists after Remove")
	}
}

// TestRemoveAllPermanentlyDeletesDirectory verifies that RemoveAll removes a
// directory and its sidecar.
func TestRemoveAllPermanentlyDeletesDirectory(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "bob"
	userDir := createUserDir(t, trashRoot, username)

	trashDir := filepath.Join(userDir, "1700000002_project")
	if err := os.MkdirAll(filepath.Join(trashDir, "subdir"), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	writeFile(t, filepath.Join(trashDir, "file.go"), "package main")
	writeFile(t, filepath.Join(trashDir, "subdir", "inner.go"), "package main")

	info := TrashInfo{
		OriginalVpath:    "user:/project",
		OriginalFilename: "project",
		DeletedAt:        1700000002,
		IsDir:            true,
	}
	if err := WriteTrashInfo(trashDir, info); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	if err := abs.RemoveAll(trashDir); err != nil {
		t.Fatalf("RemoveAll: %v", err)
	}

	if utils.FileExists(trashDir) {
		t.Error("trashDir still exists after RemoveAll")
	}
	if utils.FileExists(trashDir + TrashInfoExt) {
		t.Error("sidecar still exists after RemoveAll")
	}
}

// TestWriteReadTrashInfo verifies round-trip serialisation of TrashInfo.
func TestWriteReadTrashInfo(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	// Create a file for the sidecar to accompany.
	target := filepath.Join(trashRoot, "somefile.dat")
	writeFile(t, target, "content")

	want := TrashInfo{
		OriginalVpath:    "user:/downloads/somefile.dat",
		OriginalFilename: "somefile.dat",
		DeletedAt:        time.Now().Unix(),
		IsDir:            false,
	}

	if err := WriteTrashInfo(target, want); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	if !TrashInfoExists(target) {
		t.Fatal("TrashInfoExists returned false after WriteTrashInfo")
	}

	got, err := ReadTrashInfo(target)
	if err != nil {
		t.Fatalf("ReadTrashInfo: %v", err)
	}

	if got.OriginalVpath != want.OriginalVpath {
		t.Errorf("OriginalVpath = %q, want %q", got.OriginalVpath, want.OriginalVpath)
	}
	if got.OriginalFilename != want.OriginalFilename {
		t.Errorf("OriginalFilename = %q, want %q", got.OriginalFilename, want.OriginalFilename)
	}
	if got.DeletedAt != want.DeletedAt {
		t.Errorf("DeletedAt = %d, want %d", got.DeletedAt, want.DeletedAt)
	}
	if got.IsDir != want.IsDir {
		t.Errorf("IsDir = %v, want %v", got.IsDir, want.IsDir)
	}
}

// TestReadTrashInfo_Missing verifies that ReadTrashInfo returns an error when
// no sidecar file exists.
func TestReadTrashInfo_Missing(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	_, err := ReadTrashInfo(filepath.Join(trashRoot, "nonexistent.txt"))
	if err == nil {
		t.Error("expected error for missing sidecar, got nil")
	}
}

// TestBuildParseTrashFilename checks the Build/Parse round-trip.
func TestBuildParseTrashFilename(t *testing.T) {
	cases := []struct {
		originalName string
		ts           int64
	}{
		{"report.pdf", 1700000000},
		{"my file with spaces.docx", 1234567890},
		{"no_ext", 9999999999},
		{"subdir", 1111111111},
	}

	for _, tc := range cases {
		built := BuildTrashFilename(tc.originalName, tc.ts)

		gotTs, gotName, err := ParseTrashFilename(built)
		if err != nil {
			t.Errorf("ParseTrashFilename(%q): %v", built, err)
			continue
		}
		if gotTs != tc.ts {
			t.Errorf("timestamp mismatch: got %d, want %d", gotTs, tc.ts)
		}
		if gotName != tc.originalName {
			t.Errorf("name mismatch: got %q, want %q", gotName, tc.originalName)
		}
	}
}

// TestParseTrashFilename_Invalid ensures bad inputs are rejected.
func TestParseTrashFilename_Invalid(t *testing.T) {
	invalids := []string{
		"",           // empty
		"noUnderscore", // no '_' separator
		"_missingTs",   // empty timestamp part
		"abc_file.txt", // non-numeric timestamp
	}
	for _, s := range invalids {
		_, _, err := ParseTrashFilename(s)
		if err == nil {
			t.Errorf("ParseTrashFilename(%q): expected error, got nil", s)
		}
	}
}

// TestWalkSkipsSidecars verifies that Walk does not surface .trashinfo files.
func TestWalkSkipsSidecars(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "charlie"
	userDir := createUserDir(t, trashRoot, username)

	// Create a file + sidecar in the user dir.
	trashFile := filepath.Join(userDir, "1700000003_image.png")
	writeFile(t, trashFile, "PNG content")

	info := TrashInfo{
		OriginalVpath:    "user:/pictures/image.png",
		OriginalFilename: "image.png",
		DeletedAt:        1700000003,
	}
	if err := WriteTrashInfo(trashFile, info); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	// Walk from the trash root and collect all visited paths.
	rroot, err := abs.VirtualPathToRealPath("trash:/", username)
	if err != nil {
		t.Fatalf("VirtualPathToRealPath: %v", err)
	}
	// Ensure the root dir exists for the walk.
	os.MkdirAll(rroot, 0755)

	var visited []string
	if err := abs.Walk(rroot, func(path string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		visited = append(visited, path)
		return nil
	}); err != nil {
		t.Fatalf("Walk: %v", err)
	}

	for _, p := range visited {
		if strings.HasSuffix(p, TrashInfoExt) {
			t.Errorf("Walk yielded sidecar file: %s", p)
		}
	}

	// The actual trashed file should be present.
	found := false
	for _, p := range visited {
		if filepath.Base(p) == filepath.Base(trashFile) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Walk did not yield trashed file %q; visited: %v", trashFile, visited)
	}
}

// TestReadDirSkipsSidecars verifies that ReadDir hides .trashinfo files.
func TestReadDirSkipsSidecars(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "dave"
	userDir := createUserDir(t, trashRoot, username)

	trashFile := filepath.Join(userDir, "1700000004_doc.odt")
	writeFile(t, trashFile, "ODT content")
	if err := WriteTrashInfo(trashFile, TrashInfo{
		OriginalVpath:    "user:/docs/doc.odt",
		OriginalFilename: "doc.odt",
		DeletedAt:        1700000004,
	}); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	entries, err := abs.ReadDir(userDir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}

	for _, e := range entries {
		if strings.HasSuffix(e.Name(), TrashInfoExt) {
			t.Errorf("ReadDir returned sidecar entry: %s", e.Name())
		}
	}

	// The trash file itself must be listed.
	found := false
	for _, e := range entries {
		if e.Name() == filepath.Base(trashFile) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("ReadDir did not return trashed file %q", filepath.Base(trashFile))
	}
}

// TestGlobSkipsSidecars verifies that Glob results exclude .trashinfo files.
func TestGlobSkipsSidecars(t *testing.T) {
	trashRoot, teardown := setupTrashDir(t)
	defer teardown()

	abs := newTestAbstraction(trashRoot)
	username := "eve"
	userDir := createUserDir(t, trashRoot, username)

	for i, name := range []string{"file1.txt", "file2.txt"} {
		tf := filepath.Join(userDir, BuildTrashFilename(name, int64(1700000010+i)))
		writeFile(t, tf, "content")
		if err := WriteTrashInfo(tf, TrashInfo{
			OriginalVpath:    "user:/" + name,
			OriginalFilename: name,
			DeletedAt:        int64(1700000010 + i),
		}); err != nil {
			t.Fatalf("WriteTrashInfo: %v", err)
		}
	}

	matches, err := abs.Glob(filepath.Join(userDir, "*"))
	if err != nil {
		t.Fatalf("Glob: %v", err)
	}

	for _, m := range matches {
		if strings.HasSuffix(m, TrashInfoExt) {
			t.Errorf("Glob returned sidecar: %s", m)
		}
	}
	if len(matches) != 2 {
		t.Errorf("Glob returned %d entries, want 2; entries: %v", len(matches), matches)
	}
}

// TestRecycleWorkflow performs an end-to-end test of the recycle + permanent
// delete workflow without the HTTP layer:
//
//  1. A "source" file exists in a simulated user storage directory.
//  2. RecycleToTrash moves it to the trash directory and writes a .trashinfo sidecar.
//  3. The original file no longer exists.
//  4. The trash directory lists the file.
//  5. PermanentDeleteFromTrash removes the file and sidecar permanently.
func TestRecycleWorkflow(t *testing.T) {
	// Set up a "source" storage area and a trash area.
	srcRoot, teardownSrc := setupTrashDir(t)
	defer teardownSrc()
	trashRoot, teardownTrash := setupTrashDir(t)
	defer teardownTrash()

	username := "frank"

	// Create a source file the user wants to delete.
	srcFile := filepath.Join(srcRoot, "users", username, "work", "spreadsheet.xlsx")
	writeFile(t, srcFile, "XLSX data")
	originalVpath := "user:/work/spreadsheet.xlsx"

	abs := newTestAbstraction(trashRoot)
	userTrashDir := createUserDir(t, trashRoot, username)

	// --- Step 1: recycle the file ---
	ts := time.Now().Unix()
	basename := filepath.Base(srcFile)
	trashName := BuildTrashFilename(basename, ts)
	trashFilePath := filepath.Join(userTrashDir, trashName)

	if err := os.Rename(srcFile, trashFilePath); err != nil {
		t.Fatalf("simulated recycle (Rename): %v", err)
	}
	if err := WriteTrashInfo(trashFilePath, TrashInfo{
		OriginalVpath:    originalVpath,
		OriginalFilename: basename,
		DeletedAt:        ts,
	}); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	// --- Step 2: source file must be gone ---
	if utils.FileExists(srcFile) {
		t.Error("source file still exists after recycle")
	}

	// --- Step 3: trash file must exist and sidecar must be readable ---
	if !utils.FileExists(trashFilePath) {
		t.Fatal("trashed file not found in trash directory")
	}
	info, err := ReadTrashInfo(trashFilePath)
	if err != nil {
		t.Fatalf("ReadTrashInfo: %v", err)
	}
	if info.OriginalVpath != originalVpath {
		t.Errorf("OriginalVpath = %q, want %q", info.OriginalVpath, originalVpath)
	}
	if info.OriginalFilename != basename {
		t.Errorf("OriginalFilename = %q, want %q", info.OriginalFilename, basename)
	}

	// --- Step 4: Walk should return the trashed file ---
	rroot, _ := abs.VirtualPathToRealPath("trash:/", username)
	os.MkdirAll(rroot, 0755)
	var trashEntries []string
	abs.Walk(rroot, func(path string, fi os.FileInfo, err error) error {
		if err == nil && !fi.IsDir() {
			trashEntries = append(trashEntries, path)
		}
		return nil
	})
	foundInTrash := false
	for _, e := range trashEntries {
		if filepath.Base(e) == trashName {
			foundInTrash = true
			break
		}
	}
	if !foundInTrash {
		t.Errorf("trashed file %q not found during Walk; entries: %v", trashName, trashEntries)
	}

	// --- Step 5: permanently delete from trash ---
	if err := abs.Remove(trashFilePath); err != nil {
		t.Fatalf("Remove (permanent delete): %v", err)
	}
	if utils.FileExists(trashFilePath) {
		t.Error("trashed file still exists after permanent delete")
	}
	if utils.FileExists(trashFilePath + TrashInfoExt) {
		t.Error("sidecar still exists after permanent delete")
	}
}

// TestRestoreWorkflow simulates reading a .trashinfo sidecar to determine the
// restore destination and renaming the file back.
func TestRestoreWorkflow(t *testing.T) {
	srcRoot, teardownSrc := setupTrashDir(t)
	defer teardownSrc()
	trashRoot, teardownTrash := setupTrashDir(t)
	defer teardownTrash()

	username := "grace"

	// Create a file in the trash directory as if it had been recycled.
	userTrashDir := createUserDir(t, trashRoot, username)
	ts := int64(1700000100)
	basename := "music.mp3"
	trashName := BuildTrashFilename(basename, ts)
	trashFilePath := filepath.Join(userTrashDir, trashName)
	writeFile(t, trashFilePath, "MP3 bytes")

	// Original path was inside srcRoot.
	originalRealPath := filepath.Join(srcRoot, "users", username, "media", basename)
	originalVpath := "user:/media/" + basename

	if err := WriteTrashInfo(trashFilePath, TrashInfo{
		OriginalVpath:    originalVpath,
		OriginalFilename: basename,
		DeletedAt:        ts,
	}); err != nil {
		t.Fatalf("WriteTrashInfo: %v", err)
	}

	// Simulate restore: read sidecar, determine destination, move file back.
	info, err := ReadTrashInfo(trashFilePath)
	if err != nil {
		t.Fatalf("ReadTrashInfo: %v", err)
	}
	if info.OriginalFilename != basename {
		t.Fatalf("unexpected OriginalFilename: %q", info.OriginalFilename)
	}

	// Recreate the original directory structure.
	if err := os.MkdirAll(filepath.Dir(originalRealPath), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	// Move the file back.
	if err := os.Rename(trashFilePath, originalRealPath); err != nil {
		t.Fatalf("Rename (restore): %v", err)
	}
	// Remove the sidecar.
	os.Remove(trashFilePath + TrashInfoExt)

	// Verify outcomes.
	if !utils.FileExists(originalRealPath) {
		t.Error("restored file not found at original location")
	}
	if utils.FileExists(trashFilePath) {
		t.Error("trashed file still exists after restore")
	}
	if utils.FileExists(trashFilePath + TrashInfoExt) {
		t.Error("sidecar still exists after restore")
	}
}
