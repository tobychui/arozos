package emptyfs

import (
	"os"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

func TestNewEmptyFileSystemAbstraction(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	// Verify it's a zero-value struct
	_ = fs
}

func TestEmptyFS_Chmod(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Chmod("test.txt", 0644)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Chown(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Chown("test.txt", 0, 0)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Chtimes(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Chtimes("test.txt", time.Now(), time.Now())
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Create(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	f, err := fs.Create("test.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
	if f != nil {
		t.Error("Expected nil file")
	}
}

func TestEmptyFS_Mkdir(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Mkdir("testdir", 0755)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_MkdirAll(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.MkdirAll("testdir/subdir", 0755)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Name(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	name := fs.Name()
	if name != "" {
		t.Errorf("Expected empty name, got %q", name)
	}
}

func TestEmptyFS_Open(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	f, err := fs.Open("test.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
	if f != nil {
		t.Error("Expected nil file")
	}
}

func TestEmptyFS_OpenFile(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	f, err := fs.OpenFile("test.txt", os.O_RDONLY, 0644)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
	if f != nil {
		t.Error("Expected nil file")
	}
}

func TestEmptyFS_Remove(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Remove("test.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_RemoveAll(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.RemoveAll("testdir")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Rename(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Rename("old.txt", "new.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_Stat(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	info, err := fs.Stat("test.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
	if info != nil {
		t.Error("Expected nil FileInfo")
	}
}

func TestEmptyFS_Close(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Close()
	if err != nil {
		t.Errorf("Expected nil error on Close, got %v", err)
	}
}

func TestEmptyFS_VirtualPathToRealPath(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	_, err := fs.VirtualPathToRealPath("/path", "user")
	if err != arozfs.ErrVpathResolveFailed {
		t.Errorf("Expected ErrVpathResolveFailed, got %v", err)
	}
}

func TestEmptyFS_RealPathToVirtualPath(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	_, err := fs.RealPathToVirtualPath("/path", "user")
	if err != arozfs.ErrRpathResolveFailed {
		t.Errorf("Expected ErrRpathResolveFailed, got %v", err)
	}
}

func TestEmptyFS_FileExists(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	if fs.FileExists("/any/path") {
		t.Error("Expected FileExists to always return false")
	}
	if fs.FileExists("") {
		t.Error("Expected FileExists to always return false for empty path")
	}
}

func TestEmptyFS_IsDir(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	if fs.IsDir("/any/dir") {
		t.Error("Expected IsDir to always return false")
	}
	if fs.IsDir("") {
		t.Error("Expected IsDir to always return false for empty path")
	}
}

func TestEmptyFS_Glob(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	results, err := fs.Glob("*.txt")
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
	if len(results) != 0 {
		t.Errorf("Expected empty results, got %v", results)
	}
}

func TestEmptyFS_GetFileSize(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	size := fs.GetFileSize("/any/file")
	if size != 0 {
		t.Errorf("Expected 0 file size, got %d", size)
	}
}

func TestEmptyFS_GetModTime(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	modtime, err := fs.GetModTime("/any/file")
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("Expected ErrOperationNotSupported, got %v", err)
	}
	if modtime != 0 {
		t.Errorf("Expected 0 modtime, got %d", modtime)
	}
}

func TestEmptyFS_WriteFile(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.WriteFile("test.txt", []byte("data"), 0644)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_ReadFile(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	data, err := fs.ReadFile("test.txt")
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("Expected ErrOperationNotSupported, got %v", err)
	}
	if string(data) != "" {
		t.Errorf("Expected empty data, got %q", string(data))
	}
}

func TestEmptyFS_ReadDir(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	entries, err := fs.ReadDir("/some/dir")
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("Expected ErrOperationNotSupported, got %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("Expected empty entries, got %v", entries)
	}
}

func TestEmptyFS_WriteStream(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.WriteStream("test.txt", nil, 0644)
	if err != arozfs.ErrNullOperation {
		t.Errorf("Expected ErrNullOperation, got %v", err)
	}
}

func TestEmptyFS_ReadStream(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	rc, err := fs.ReadStream("test.txt")
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("Expected ErrOperationNotSupported, got %v", err)
	}
	if rc != nil {
		t.Error("Expected nil ReadCloser")
	}
}

func TestEmptyFS_Walk(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Walk("/some/root", func(path string, info os.FileInfo, err error) error {
		return nil
	})
	if err != arozfs.ErrOperationNotSupported {
		t.Errorf("Expected ErrOperationNotSupported, got %v", err)
	}
}

func TestEmptyFS_Heartbeat(t *testing.T) {
	fs := NewEmptyFileSystemAbstraction()
	err := fs.Heartbeat()
	if err != nil {
		t.Errorf("Expected nil from Heartbeat, got %v", err)
	}
}
