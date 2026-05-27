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
