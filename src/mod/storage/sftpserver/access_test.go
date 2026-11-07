package sftpserver

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// fakeAccess stands in for the signed in user. levels holds what the user may
// do per drive id: "r", "rw", or nothing for a drive they cannot use.
type fakeAccess struct {
	fshs   []*filesystem.FileSystemHandler
	levels map[string]string
}

func (a *fakeAccess) levelOf(vpath string) string {
	return a.levels[strings.SplitN(vpath, ":", 2)[0]]
}

func (a *fakeAccess) GetAllFileSystemHandler() []*filesystem.FileSystemHandler {
	results := []*filesystem.FileSystemHandler{}
	for _, fsh := range a.fshs {
		if a.levels[fsh.UUID] != "" {
			results = append(results, fsh)
		}
	}
	return results
}

func (a *fakeAccess) CanRead(vpath string) bool {
	return a.levelOf(vpath) != ""
}

func (a *fakeAccess) CanWrite(vpath string) bool {
	return a.levelOf(vpath) == "rw"
}

// newAccessTestRoot serves one local drive, "media", holding docs/a.txt
func newAccessTestRoot(t *testing.T, level string) (*root, *fakeAccess, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0755); err != nil {
		t.Fatalf("MkdirAll() = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	fsh := &filesystem.FileSystemHandler{
		UUID:                  "media",
		Hierarchy:             "public",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("media", dir, "public", false),
	}
	userAccess := &fakeAccess{
		fshs:   []*filesystem.FileSystemHandler{fsh},
		levels: map[string]string{"media": level},
	}
	return &root{username: "alice", rootFile: &rootFolder{name: "/", isdir: true}, startDirectory: "/", access: userAccess}, userAccess, dir
}

func TestWriteOperationsNeedWriteAccess(t *testing.T) {
	tests := []struct {
		name    string
		perform func(fs *root) error
		changed func(dir string) bool
	}{
		{
			name:    "mkdir",
			perform: func(fs *root) error { return fs.mkdir("/media/new") },
			changed: func(dir string) bool {
				_, err := os.Stat(filepath.Join(dir, "new"))
				return err == nil
			},
		},
		{
			name:    "unlink",
			perform: func(fs *root) error { return fs.unlink("/media/docs/a.txt") },
			changed: func(dir string) bool {
				_, err := os.Stat(filepath.Join(dir, "docs", "a.txt"))
				return err != nil
			},
		},
		{
			name:    "rmdir",
			perform: func(fs *root) error { return fs.rmdir("/media/docs") },
			changed: func(dir string) bool {
				_, err := os.Stat(filepath.Join(dir, "docs"))
				return err != nil
			},
		},
		{
			name:    "rename",
			perform: func(fs *root) error { return fs.rename("/media/docs/a.txt", "/media/docs/b.txt") },
			changed: func(dir string) bool {
				_, err := os.Stat(filepath.Join(dir, "docs", "b.txt"))
				return err == nil
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name+" with write access", func(t *testing.T) {
			fs, _, dir := newAccessTestRoot(t, "rw")
			if err := tt.perform(fs); err != nil {
				t.Fatalf("error = %v", err)
			}
			if !tt.changed(dir) {
				t.Fatalf("nothing changed on disk")
			}
		})
		t.Run(tt.name+" with read access", func(t *testing.T) {
			fs, _, dir := newAccessTestRoot(t, "r")
			if err := tt.perform(fs); !errors.Is(err, os.ErrPermission) {
				t.Fatalf("error = %v, want permission denied", err)
			}
			if tt.changed(dir) {
				t.Fatalf("the drive was changed")
			}
		})
	}
}

func TestReadAccessCanStillRead(t *testing.T) {
	fs, _, _ := newAccessTestRoot(t, "r")
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname("/media/docs/a.txt")
	if err != nil {
		t.Fatalf("resolving a readable path = %v", err)
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		t.Fatalf("file not found at %s", rpath)
	}
	entries, err := fs.readdir("/media/docs")
	if err != nil || len(entries) != 1 {
		t.Fatalf("readdir() = %v, %v", entries, err)
	}
}

// Rules are read on every operation, so a session that is already open loses
// a drive the moment its access list says so
func TestAccessChangeReachesAnOpenSession(t *testing.T) {
	fs, userAccess, _ := newAccessTestRoot(t, "rw")
	if entries, err := fs.readdir("/"); err != nil || len(entries) != 1 {
		t.Fatalf("root before the change = %v, %v", entries, err)
	}

	userAccess.levels["media"] = ""

	entries, err := fs.readdir("/")
	if err != nil || len(entries) != 0 {
		t.Fatalf("root after the change = %v, %v, want no drives", entries, err)
	}
	if _, err := fs.readdir("/media/docs"); err == nil {
		t.Fatalf("readdir() of a lost drive succeeded")
	}
}
