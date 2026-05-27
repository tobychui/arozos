package localfs

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestLocalFS(t *testing.T) (LocalFileSystemAbstraction, string) {
	tmpDir := t.TempDir()
	lfs := NewLocalFileSystemAbstraction("test-uuid", tmpDir, "public", false)
	return lfs, tmpDir
}

func TestNewLocalFileSystemAbstraction(t *testing.T) {
	tmpDir := t.TempDir()
	lfs := NewLocalFileSystemAbstraction("uuid-1", tmpDir, "public", false)
	if lfs.Name() == "" {
		// Name might be empty or set - just verify it doesn't panic
	}
	_ = lfs
}

func TestLocalFS_CreateAndOpen(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)

	filename := filepath.Join(tmpDir, "test.txt")
	f, err := lfs.Create(filename)
	if err != nil {
		t.Fatalf("Create() unexpected error: %v", err)
	}
	f.Close()

	f2, err := lfs.Open(filename)
	if err != nil {
		t.Fatalf("Open() unexpected error: %v", err)
	}
	f2.Close()
}

func TestLocalFS_Open_NonExistent(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	_, err := lfs.Open(filepath.Join(tmpDir, "nonexistent.txt"))
	if err == nil {
		t.Error("Expected error for non-existent file")
	}
}

func TestLocalFS_Mkdir(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	dirPath := filepath.Join(tmpDir, "testdir")
	err := lfs.Mkdir(dirPath, 0755)
	if err != nil {
		t.Fatalf("Mkdir() unexpected error: %v", err)
	}
	if _, err := os.Stat(dirPath); os.IsNotExist(err) {
		t.Error("Directory was not created")
	}
}

func TestLocalFS_MkdirAll(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	deepPath := filepath.Join(tmpDir, "a", "b", "c")
	err := lfs.MkdirAll(deepPath, 0755)
	if err != nil {
		t.Fatalf("MkdirAll() unexpected error: %v", err)
	}
	if _, err := os.Stat(deepPath); os.IsNotExist(err) {
		t.Error("Deep directory was not created")
	}
}

func TestLocalFS_Stat(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	filename := filepath.Join(tmpDir, "stat_test.txt")
	os.WriteFile(filename, []byte("test"), 0644)

	info, err := lfs.Stat(filename)
	if err != nil {
		t.Fatalf("Stat() unexpected error: %v", err)
	}
	if info.Name() != "stat_test.txt" {
		t.Errorf("Expected name stat_test.txt, got %q", info.Name())
	}
}

func TestLocalFS_Remove(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	filename := filepath.Join(tmpDir, "remove_test.txt")
	os.WriteFile(filename, []byte("test"), 0644)

	err := lfs.Remove(filename)
	if err != nil {
		t.Fatalf("Remove() unexpected error: %v", err)
	}
	if _, err := os.Stat(filename); !os.IsNotExist(err) {
		t.Error("File should have been removed")
	}
}

func TestLocalFS_RemoveAll(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	dirPath := filepath.Join(tmpDir, "removedir")
	os.MkdirAll(filepath.Join(dirPath, "sub"), 0755)
	os.WriteFile(filepath.Join(dirPath, "file.txt"), []byte("test"), 0644)

	err := lfs.RemoveAll(dirPath)
	if err != nil {
		t.Fatalf("RemoveAll() unexpected error: %v", err)
	}
	if _, err := os.Stat(dirPath); !os.IsNotExist(err) {
		t.Error("Directory should have been removed")
	}
}

func TestLocalFS_Rename(t *testing.T) {
	lfs, tmpDir := newTestLocalFS(t)
	oldPath := filepath.Join(tmpDir, "old.txt")
	newPath := filepath.Join(tmpDir, "new.txt")
	os.WriteFile(oldPath, []byte("test"), 0644)

	err := lfs.Rename(oldPath, newPath)
	if err != nil {
		t.Fatalf("Rename() unexpected error: %v", err)
	}
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Error("Renamed file not found at new path")
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error("Old file should not exist after rename")
	}
}

func TestLocalFS_Close(t *testing.T) {
	lfs, _ := newTestLocalFS(t)
	err := lfs.Close()
	if err != nil {
		t.Errorf("Close() unexpected error: %v", err)
	}
}

func TestLocalFS_VirtualPathToRealPath_Public(t *testing.T) {
	tmpDir := t.TempDir()
	lfs := NewLocalFileSystemAbstraction("test-uuid", tmpDir, "public", false)

	realPath, err := lfs.VirtualPathToRealPath("/subpath/file.txt", "admin")
	if err != nil {
		t.Fatalf("VirtualPathToRealPath() unexpected error: %v", err)
	}
	if realPath == "" {
		t.Error("Expected non-empty real path")
	}
}

func TestLocalFS_RealPathToVirtualPath(t *testing.T) {
	tmpDir := t.TempDir()
	lfs := NewLocalFileSystemAbstraction("test-uuid", tmpDir, "public", false)

	// Map a real path back to virtual
	realPath := filepath.Join(tmpDir, "subdir", "file.txt")
	vpath, err := lfs.RealPathToVirtualPath(realPath, "admin")
	if err != nil {
		t.Fatalf("RealPathToVirtualPath() unexpected error: %v", err)
	}
	if vpath == "" {
		t.Error("Expected non-empty virtual path")
	}
}
