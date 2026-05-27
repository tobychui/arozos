package fspermission

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
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

// --- GetFilePermissions ---

func TestGetFilePermissions_ExistingFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	perm, err := GetFilePermissions(fsh, target)
	if err != nil {
		t.Fatalf("GetFilePermissions returned error: %v", err)
	}
	// Permissions should be a 4-character octal string like "0644"
	if len(perm) != 4 {
		t.Errorf("expected 4-char permission string, got %q (len=%d)", perm, len(perm))
	}
}

func TestGetFilePermissions_NonExistentFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "no_such_file.txt")

	_, err := GetFilePermissions(fsh, target)
	if err == nil {
		t.Fatal("expected error for non-existent file, got nil")
	}
}

func TestGetFilePermissions_Directory(t *testing.T) {
	fsh, dir := newTestFSH(t)
	subdir := filepath.Join(dir, "subdir")
	if err := os.Mkdir(subdir, 0755); err != nil {
		t.Fatalf("failed to create subdirectory: %v", err)
	}

	perm, err := GetFilePermissions(fsh, subdir)
	if err != nil {
		t.Fatalf("GetFilePermissions returned error for directory: %v", err)
	}
	if len(perm) != 4 {
		t.Errorf("expected 4-char permission string for directory, got %q", perm)
	}
}

// --- SetFilePermisson ---

func TestSetFilePermisson_ValidPermission(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := SetFilePermisson(fsh, target, "0755")
	if err != nil {
		t.Fatalf("SetFilePermisson returned error: %v", err)
	}

	// Verify new permission
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("failed to stat file: %v", err)
	}
	// 0755 in decimal = 493
	if info.Mode().Perm() != 0755 {
		t.Errorf("expected permission 0755, got %04o", info.Mode().Perm())
	}
}

func TestSetFilePermisson_ReadOnlyPermission(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "readonly.txt")
	if err := os.WriteFile(target, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := SetFilePermisson(fsh, target, "0444")
	if err != nil {
		t.Fatalf("SetFilePermisson returned error: %v", err)
	}

	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("failed to stat file: %v", err)
	}
	if info.Mode().Perm() != 0444 {
		t.Errorf("expected permission 0444, got %04o", info.Mode().Perm())
	}
	// Restore to allow cleanup
	os.Chmod(target, 0644)
}

func TestSetFilePermisson_InvalidKeyLength(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Key too short
	err := SetFilePermisson(fsh, target, "644")
	if err == nil {
		t.Fatal("expected error for invalid key length, got nil")
	}
}

func TestSetFilePermisson_InvalidKeyTooLong(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := SetFilePermisson(fsh, target, "06444")
	if err == nil {
		t.Fatal("expected error for invalid key length, got nil")
	}
}

func TestSetFilePermisson_NonZeroFirstDigit(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// First digit must be 0
	err := SetFilePermisson(fsh, target, "1755")
	if err == nil {
		t.Fatal("expected error for non-zero first digit, got nil")
	}
}

func TestSetFilePermisson_PermissionValueTooHigh(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// 8 is > 7, invalid octal digit
	err := SetFilePermisson(fsh, target, "0855")
	if err == nil {
		t.Fatal("expected error for permission value > 7, got nil")
	}
}

func TestSetFilePermisson_NonNumericKey(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	err := SetFilePermisson(fsh, target, "0abc")
	if err == nil {
		t.Fatal("expected error for non-numeric key, got nil")
	}
}

func TestSetFilePermisson_NonExistentFile(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "nonexistent.txt")

	// File doesn't exist → should return ErrOperationNotSupported
	err := SetFilePermisson(fsh, target, "0644")
	if err == nil {
		t.Fatal("expected error for non-existent file, got nil")
	}
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("expected ErrOperationNotSupported, got %v", err)
	}
}

func TestSetFilePermisson_ThirdDigitTooHigh(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// third digit is 8 (> 7)
	err := SetFilePermisson(fsh, target, "0685")
	if err == nil {
		t.Fatal("expected error for third digit > 7, got nil")
	}
}

func TestSetFilePermisson_FourthDigitTooHigh(t *testing.T) {
	fsh, dir := newTestFSH(t)
	target := filepath.Join(dir, "testfile.txt")
	if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// fourth digit is 9 (> 7)
	err := SetFilePermisson(fsh, target, "0649")
	if err == nil {
		t.Fatal("expected error for fourth digit > 7, got nil")
	}
}
