package sftpserver

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/quotafs"
)

// failingFsa refuses to write files with the given name
type failingFsa struct {
	filesystem.FileSystemAbstraction
	failOn string
}

func (f failingFsa) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	if filepath.Base(filename) == f.failOn {
		return errors.New("disk failure")
	}
	return f.FileSystemAbstraction.WriteStream(filename, stream, mode)
}

// newMoveTestRoot serves "src" and "dest", two drives the user may change.
// src holds a.txt and the folder docs (docs/one.txt, docs/sub/two.txt).
func newMoveTestRoot(t *testing.T, failOn string) (*root, string, string) {
	t.Helper()
	srcDir, destDir := t.TempDir(), t.TempDir()
	for name, content := range map[string]string{
		"a.txt":            "hello",
		"docs/one.txt":     "one",
		"docs/sub/two.txt": "two",
	} {
		path := filepath.Join(srcDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("MkdirAll() = %v", err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("WriteFile() = %v", err)
		}
	}
	var destFsa filesystem.FileSystemAbstraction = userDriveFsa("dest", destDir)
	if failOn != "" {
		destFsa = failingFsa{destFsa, failOn}
	}
	access := &fakeAccess{
		fshs: []*filesystem.FileSystemHandler{
			{UUID: "src", Hierarchy: "public", FileSystemAbstraction: userDriveFsa("src", srcDir)},
			{UUID: "dest", Hierarchy: "public", FileSystemAbstraction: destFsa},
		},
		levels: map[string]string{"src": "rw", "dest": "rw"},
	}
	return &root{username: "alice", rootFile: &rootFolder{name: "/", isdir: true}, startDirectory: "/", access: access}, srcDir, destDir
}

// tree lists the files below dir with their content
func tree(t *testing.T, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		files[filepath.ToSlash(rel)] = string(content)
		return nil
	})
	if err != nil {
		t.Fatalf("Walk() = %v", err)
	}
	return files
}

func TestMoveAcrossDrives(t *testing.T) {
	everything := map[string]string{"a.txt": "hello", "docs/one.txt": "one", "docs/sub/two.txt": "two"}
	tests := []struct {
		name     string
		from, to string
		existing map[string]string //Files in dest before the move
		failOn   string            //A file dest fails to write
		wantErr  bool
		wantSrc  map[string]string
		wantDest map[string]string
	}{
		{
			name: "file", from: "/src/a.txt", to: "/dest/a.txt",
			wantSrc:  map[string]string{"docs/one.txt": "one", "docs/sub/two.txt": "two"},
			wantDest: map[string]string{"a.txt": "hello"},
		},
		{
			name: "file over an existing one", from: "/src/a.txt", to: "/dest/a.txt",
			existing: map[string]string{"a.txt": "an older and longer file"},
			wantSrc:  map[string]string{"docs/one.txt": "one", "docs/sub/two.txt": "two"},
			wantDest: map[string]string{"a.txt": "hello"},
		},
		{
			name: "folder", from: "/src/docs", to: "/dest/papers",
			wantSrc:  map[string]string{"a.txt": "hello"},
			wantDest: map[string]string{"papers/one.txt": "one", "papers/sub/two.txt": "two"},
		},
		{
			name: "folder onto an existing folder", from: "/src/docs", to: "/dest/papers",
			existing: map[string]string{"papers/keep.txt": "keep"},
			wantErr:  true, wantSrc: everything,
			wantDest: map[string]string{"papers/keep.txt": "keep"},
		},
		{
			name: "failed file copy keeps the source", from: "/src/a.txt", to: "/dest/a.txt", failOn: "a.txt",
			wantErr: true, wantSrc: everything, wantDest: map[string]string{},
		},
		{
			name: "failed folder copy keeps the source", from: "/src/docs", to: "/dest/papers", failOn: "two.txt",
			wantErr: true, wantSrc: everything, wantDest: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fs, srcDir, destDir := newMoveTestRoot(t, tt.failOn)
			for name, content := range tt.existing {
				path := filepath.Join(destDir, filepath.FromSlash(name))
				os.MkdirAll(filepath.Dir(path), 0755)
				if err := os.WriteFile(path, []byte(content), 0644); err != nil {
					t.Fatalf("WriteFile() = %v", err)
				}
			}

			err := fs.rename(tt.from, tt.to)
			if (err != nil) != tt.wantErr {
				t.Fatalf("rename() = %v, want error %v", err, tt.wantErr)
			}
			if got := tree(t, srcDir); !sameFiles(got, tt.wantSrc) {
				t.Errorf("source drive = %v, want %v", got, tt.wantSrc)
			}
			if got := tree(t, destDir); !sameFiles(got, tt.wantDest) {
				t.Errorf("destination drive = %v, want %v", got, tt.wantDest)
			}
		})
	}
}

func sameFiles(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}

// Both ends must be writable, as before
func TestMoveAcrossDrivesNeedsWriteAccess(t *testing.T) {
	for _, readOnly := range []string{"src", "dest"} {
		t.Run(readOnly+" read only", func(t *testing.T) {
			fs, srcDir, destDir := newMoveTestRoot(t, "")
			fs.access.(*fakeAccess).levels[readOnly] = "r"
			if err := fs.rename("/src/a.txt", "/dest/a.txt"); !errors.Is(err, os.ErrPermission) {
				t.Fatalf("rename() = %v, want permission denied", err)
			}
			if _, err := os.Stat(filepath.Join(srcDir, "a.txt")); err != nil {
				t.Errorf("source gone: %v", err)
			}
			if got := tree(t, destDir); len(got) != 0 {
				t.Errorf("destination changed: %v", got)
			}
		})
	}
}

func TestMoveAcrossDrivesQuota(t *testing.T) {
	//a.txt is 5 bytes, docs holds 6
	tests := []struct {
		name         string
		counted      []string //The drives that count against the quota
		from, to     string
		existing     string //Content of dest/a.txt before the move, if any
		left         int64  //Free space of the quota
		wantRefused  bool
		wantUsedDiff int64
	}{
		{name: "into a counted drive", counted: []string{"dest"}, from: "/src/docs", to: "/dest/docs", left: 100, wantUsedDiff: 6},
		{name: "into a counted drive, too big", counted: []string{"dest"}, from: "/src/docs", to: "/dest/docs", left: 6, wantRefused: true},
		{name: "over a file in a counted drive", counted: []string{"dest"}, from: "/src/a.txt", to: "/dest/a.txt", existing: "xx", left: 100, wantUsedDiff: 3},
		{name: "out of a counted drive", counted: []string{"src"}, from: "/src/docs", to: "/dest/docs", left: 100, wantUsedDiff: -6},
		{name: "between counted drives", counted: []string{"src", "dest"}, from: "/src/docs", to: "/dest/docs", left: 0, wantUsedDiff: 0},
		{name: "between counted drives over a file", counted: []string{"src", "dest"}, from: "/src/a.txt", to: "/dest/a.txt", existing: "xx", left: 0, wantUsedDiff: -2},
		{name: "neither counted", from: "/src/docs", to: "/dest/docs", left: 0, wantUsedDiff: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fs, srcDir, destDir := newMoveTestRoot(t, "")
			for _, fsh := range fs.access.(*fakeAccess).fshs {
				for _, uuid := range tt.counted {
					if fsh.UUID == uuid {
						fsh.Hierarchy = "user"
					}
				}
			}
			if tt.existing != "" {
				if err := os.WriteFile(filepath.Join(destDir, "a.txt"), []byte(tt.existing), 0644); err != nil {
					t.Fatalf("WriteFile() = %v", err)
				}
			}
			const used = 1000
			q := &fakeQuota{total: used + tt.left, used: used}
			fs.quota = q

			err := fs.rename(tt.from, tt.to)
			if tt.wantRefused {
				if !errors.Is(err, quotafs.ErrQuotaExceeded) {
					t.Fatalf("rename() = %v, want %v", err, quotafs.ErrQuotaExceeded)
				}
				if _, err := os.Stat(filepath.Join(srcDir, filepath.FromSlash(tt.from[len("/src/"):]))); err != nil {
					t.Errorf("source gone: %v", err)
				}
			} else if err != nil {
				t.Fatalf("rename() = %v", err)
			}
			if got, _ := q.state(); got-used != tt.wantUsedDiff {
				t.Errorf("usage changed by %d, want %d", got-used, tt.wantUsedDiff)
			}
		})
	}
}
