package main

import (
	"os"
	"path/filepath"
	"sort"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// Only names ending with .<unix time> are trashed item names
func TestIsTrashName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"report.pdf.1712345678", true},
		{"Photos.1712345678", true},
		{".bashrc.1712345678", true},
		{"backup.2024", true},
		{".metadata", false},
		{".DS_Store", false},
		{"report.pdf", false},
		{"report", false},
		{".1712345678", false},
		{"report.-12", false},
		{"report.+12", false},
		{"report.12a", false},
		{"report.99999999999999999999", false},
		{"backup.2024~", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := system_fs_isTrashName(tt.name); got != tt.want {
				t.Errorf("system_fs_isTrashName(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

// Folder names on the way to a trashed item survive the round trip and are never taken for one
func TestTrashFolderEscaping(t *testing.T) {
	tests := []struct {
		name    string
		escaped string
	}{
		{"foo", "foo"},
		{"foo~", "foo~"},
		{".metadata", ".metadata"},
		{"backup.2024", "backup.2024~"},
		{"backup.2024~", "backup.2024~~"},
		{"backup.2024~~", "backup.2024~~~"},
		{"~", "~"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			escaped := system_fs_escapeTrashFolder(tt.name)
			if escaped != tt.escaped {
				t.Errorf("escape(%q) = %q, want %q", tt.name, escaped, tt.escaped)
			}
			if system_fs_isTrashName(escaped) {
				t.Errorf("escaped name %q is taken for a trashed item", escaped)
			}
			if back := system_fs_unescapeTrashFolder(escaped); back != tt.name {
				t.Errorf("unescape(%q) = %q, want %q", escaped, back, tt.name)
			}
		})
	}
}

func TestTrashSubpathOf(t *testing.T) {
	tests := []struct {
		name     string
		original string
		want     string
	}{
		{"nested file", "/foo/bar/deleteme.txt", "/.trash/foo/bar/deleteme.txt.1712345678"},
		{"root file", "/deleteme.txt", "/.trash/deleteme.txt.1712345678"},
		{"no leading slash", "foo/deleteme.txt", "/.trash/foo/deleteme.txt.1712345678"},
		{"folder", "/foo/Photos/", "/.trash/foo/Photos.1712345678"},
		{"folder looking like a trashed item", "/backup.2024/a.txt", "/.trash/backup.2024~/a.txt.1712345678"},
		{"item looking like a trashed item", "/foo/backup.2024", "/.trash/foo/backup.2024.1712345678"},
		{"root", "/", ""},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := system_fs_trashSubpathOf(tt.original, 1712345678); got != tt.want {
				t.Errorf("system_fs_trashSubpathOf(%q) = %q, want %q", tt.original, got, tt.want)
			}
		})
	}
}

func TestOriginalSubpathOf(t *testing.T) {
	tests := []struct {
		name         string
		trashSubpath string
		wantOriginal string
		wantOK       bool
	}{
		{"nested file", "/.trash/foo/bar/deleteme.txt.1712345678", "/foo/bar/deleteme.txt", true},
		{"root file", "/.trash/deleteme.txt.1712345678", "/deleteme.txt", true},
		{"escaped folder", "/.trash/backup.2024~/a.txt.1712345678", "/backup.2024/a.txt", true},
		{"hidden file", "/.trash/foo/.bashrc.1712345678", "/foo/.bashrc", true},
		{"folder on the way", "/.trash/foo/bar", "", false},
		{"inside a trashed folder", "/.trash/Photos.1712345678/a.jpg.1700000000", "", false},
		{"thumbnail leftover", "/.trash/foo/.metadata/.cache/a.jpg.1712345678.jpg", "", false},
		{"the trash itself", "/.trash", "", false},
		{"outside the trash", "/foo/report.pdf.1712345678", "", false},
		{"escapes the trash", "/.trash/../report.pdf.1712345678", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original, timestamp, ok := system_fs_originalSubpathOf(tt.trashSubpath)
			if ok != tt.wantOK || original != tt.wantOriginal {
				t.Fatalf("system_fs_originalSubpathOf(%q) = %q, %v, want %q, %v", tt.trashSubpath, original, ok, tt.wantOriginal, tt.wantOK)
			}
			if ok && timestamp != 1712345678 {
				t.Errorf("timestamp = %d, want 1712345678", timestamp)
			}
		})
	}
}

func TestIsInTrash(t *testing.T) {
	tests := []struct {
		subpath string
		want    bool
	}{
		{"/.trash", true},
		{"/.trash/", true},
		{"/.trash/foo/a.txt.1712345678", true},
		{".trash/foo", true},
		{"/.trashcan", false},
		{"/foo/.trash", false},
		{"/", false},
	}

	for _, tt := range tests {
		t.Run(tt.subpath, func(t *testing.T) {
			if got := system_fs_isInTrash(tt.subpath); got != tt.want {
				t.Errorf("system_fs_isInTrash(%q) = %v, want %v", tt.subpath, got, tt.want)
			}
		})
	}
}

// Write files (and folders for names ending in "/") below root
func writeTrashFixture(t *testing.T, root string, files []string) {
	t.Helper()
	for _, f := range files {
		p := filepath.Join(root, filepath.FromSlash(f))
		if f[len(f)-1] == '/' {
			if err := os.MkdirAll(p, 0755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
}

// The scan finds trashed items in the root .trash folder only, without looking inside trashed folders
func TestScanTrashOf(t *testing.T) {
	root := t.TempDir()
	writeTrashFixture(t, root, []string{
		"Desktop/report.pdf.1712345678",
		".trash/report.pdf.1712345678",
		".trash/foo/bar/deleteme.txt.1712345678",
		".trash/foo/Photos.1712345678/a.jpg.1700000000",
		".trash/foo/.metadata/.cache/deleteme.txt.1712345678.jpg",
		".trash/backup.2024~/a.txt.1712345678",
		".trash/empty/",
		".trash/.DS_Store",
	})

	fsh := &filesystem.FileSystemHandler{
		UUID:                  "test",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("test", root, "public", false),
	}

	got := []string{}
	err := system_fs_scanTrashOf(fsh, "alice", func(item trashItem) error {
		got = append(got, item.Subpath+" -> "+item.OriginalSubpath)
		if _, err := os.Stat(item.Realpath); err != nil {
			t.Errorf("realpath %q of %q: %v", item.Realpath, item.Subpath, err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	sort.Strings(got)

	want := []string{
		"/.trash/backup.2024~/a.txt.1712345678 -> /backup.2024/a.txt",
		"/.trash/foo/Photos.1712345678 -> /foo/Photos",
		"/.trash/foo/bar/deleteme.txt.1712345678 -> /foo/bar/deleteme.txt",
		"/.trash/report.pdf.1712345678 -> /report.pdf",
	}
	if len(got) != len(want) {
		t.Fatalf("scan found %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("item %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestScanTrashOfWithoutTrash(t *testing.T) {
	fsh := &filesystem.FileSystemHandler{
		UUID:                  "test",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("test", t.TempDir(), "public", false),
	}
	calls := 0
	err := system_fs_scanTrashOf(fsh, "alice", func(item trashItem) error {
		calls++
		return nil
	})
	if err != nil || calls != 0 {
		t.Errorf("scan of a root without .trash = %d items, %v; want none", calls, err)
	}
}

// Removing a trashed item drops the folders it leaves empty, up to .trash itself
func TestPruneTrashParents(t *testing.T) {
	tests := []struct {
		name     string
		files    []string
		removed  string
		wantGone []string
		wantKept []string
	}{
		{
			name:     "last item",
			files:    []string{".trash/foo/bar/a.txt.1712345678", ".trash/foo/bar/.metadata/.cache/a.txt.1712345678.jpg", ".trash/.DS_Store"},
			removed:  ".trash/foo/bar/a.txt.1712345678",
			wantGone: []string{".trash"},
		},
		{
			name:     "sibling folder left",
			files:    []string{".trash/foo/bar/a.txt.1712345678", ".trash/foo/baz/b.txt.1712345678"},
			removed:  ".trash/foo/bar/a.txt.1712345678",
			wantGone: []string{".trash/foo/bar"},
			wantKept: []string{".trash/foo/baz/b.txt.1712345678"},
		},
		{
			name:     "item higher up left",
			files:    []string{".trash/foo/bar/a.txt.1712345678", ".trash/c.txt.1712345678"},
			removed:  ".trash/foo/bar/a.txt.1712345678",
			wantGone: []string{".trash/foo"},
			wantKept: []string{".trash/c.txt.1712345678"},
		},
		{
			name:     "trashed .metadata folder content kept",
			files:    []string{".trash/foo/bar/a.txt.1712345678", ".trash/foo/.metadata/x.1712345678"},
			removed:  ".trash/foo/bar/a.txt.1712345678",
			wantGone: []string{".trash/foo/bar"},
			wantKept: []string{".trash/foo/.metadata/x.1712345678"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			writeTrashFixture(t, root, tt.files)
			fsh := &filesystem.FileSystemHandler{
				UUID:                  "test",
				FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("test", root, "public", false),
			}

			removed := filepath.Join(root, filepath.FromSlash(tt.removed))
			if err := os.RemoveAll(removed); err != nil {
				t.Fatalf("remove: %v", err)
			}
			system_fs_pruneTrashParents(fsh, "alice", filepath.ToSlash(filepath.Dir(removed)))

			for _, p := range tt.wantGone {
				if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(p))); err == nil {
					t.Errorf("%s still exists", p)
				}
			}
			for _, p := range tt.wantKept {
				if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(p))); err != nil {
					t.Errorf("%s was removed: %v", p, err)
				}
			}
		})
	}
}

// Pruning never walks out of the .trash folder
func TestPruneTrashParentsStaysInTrash(t *testing.T) {
	root := t.TempDir()
	writeTrashFixture(t, root, []string{"foo/empty/"})
	fsh := &filesystem.FileSystemHandler{
		UUID:                  "test",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("test", root, "public", false),
	}
	system_fs_pruneTrashParents(fsh, "alice", filepath.ToSlash(filepath.Join(root, "foo", "empty")))
	if _, err := os.Stat(filepath.Join(root, "foo", "empty")); err != nil {
		t.Errorf("folder outside the trash was removed: %v", err)
	}
}
