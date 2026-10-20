package main

import (
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

/*
Only entries named <name>.<unix time> right inside a .trash folder are trashed
items. The .metadata folder a thumbnail of a trashed file leaves behind used
to show up in the trash as a nameless folder that could not be deleted.
*/
func TestIsTrashEntry(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"trashed file", "/u/.metadata/.trash/report.pdf.1712345678", true},
		{"trashed folder", "/u/.metadata/.trash/Photos.1712345678", true},
		{"trashed hidden file", "/u/.metadata/.trash/.bashrc.1712345678", true},
		{"thumbnail leftover", "/u/.metadata/.trash/.metadata", false},
		{"finder leftover", "/u/.metadata/.trash/.DS_Store", false},
		{"no timestamp", "/u/.metadata/.trash/report.pdf", false},
		{"no extension", "/u/.metadata/.trash/report", false},
		{"not in a trash folder", "/u/Desktop/report.pdf.1712345678", false},
		{"inside a trashed folder", "/u/.metadata/.trash/Photos.1712345678/a.jpg", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := system_fs_isTrashEntry(tt.path); got != tt.want {
				t.Errorf("system_fs_isTrashEntry(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestRemoveTrashDirIfEmpty(t *testing.T) {
	tests := []struct {
		name     string
		files    []string
		wantKept bool
	}{
		{"empty", nil, false},
		{"only thumbnail leftovers", []string{".metadata/.cache/a.png.1712345678.jpg", ".DS_Store"}, false},
		{"trashed item left", []string{"a.png.1712345678", ".metadata/.cache/a.png.1712345678.jpg"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			trashDir := filepath.Join(root, ".metadata", ".trash")
			if err := os.MkdirAll(trashDir, 0755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			for _, f := range tt.files {
				p := filepath.Join(trashDir, f)
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatalf("mkdir: %v", err)
				}
				if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
					t.Fatalf("write: %v", err)
				}
			}

			fshAbs := localfs.NewLocalFileSystemAbstraction("test", root, "user", false)
			system_fs_removeTrashDirIfEmpty(fshAbs, trashDir)

			_, err := os.Stat(trashDir)
			if kept := err == nil; kept != tt.wantKept {
				t.Errorf("trash folder kept = %v, want %v", kept, tt.wantKept)
			}
		})
	}
}
