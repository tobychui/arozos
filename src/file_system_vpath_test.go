package main

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

/*
virtualDirname feeds the "Location" row of the file properties dialog.

It must stay lexical and slash based. filepath.Dir looks correct on Linux
but mangles a virtual path on Windows, which is the regression this guards.
*/
func TestVirtualDirname(t *testing.T) {
	tests := []struct {
		name  string
		vpath string
		want  string
	}{
		{"nested file", "user:/cluster/hello_world.job.agi", "user:/cluster"},
		{"nested folder", "user:/Desktop/Photos", "user:/Desktop"},
		{"file at root of vroot", "user:/a.txt", "user:"},
		{"deep path", "tmp:/a/b/c/d.txt", "tmp:/a/b/c"},
		{"name with plus and space", "user:/My +Stuff/a b.mkv", "user:/My +Stuff"},
		{"other vroot id", "cluster:/shared/report.pdf", "cluster:/shared"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := virtualDirname(tt.vpath)
			if got != tt.want {
				t.Errorf("virtualDirname(%q) = %q, want %q", tt.vpath, got, tt.want)
			}
			if strings.HasPrefix(got, "./") {
				t.Errorf("virtualDirname(%q) = %q, must not carry a \"./\" prefix", tt.vpath, got)
			}
			if strings.Contains(got, "\\") {
				t.Errorf("virtualDirname(%q) = %q, must stay slash separated", tt.vpath, got)
			}
		})
	}
}

// Documents why filepath.Dir cannot be used on a virtual path. It is the exact
// call this fix replaced, and it only misbehaves on Windows.
func TestFilepathDirIsUnsafeForVirtualPathOnWindows(t *testing.T) {
	const vpath = "user:/cluster/hello_world.job.agi"
	got := filepath.ToSlash(filepath.Dir(vpath))

	if runtime.GOOS == "windows" {
		if !strings.HasPrefix(got, "./") {
			t.Skipf("filepath.Dir no longer prefixes %q with \"./\" on this Go version (got %q); virtualDirname stays correct either way", vpath, got)
		}
		if virtualDirname(vpath) == got {
			t.Errorf("virtualDirname must not reproduce filepath.Dir's %q", got)
		}
		return
	}

	if got != virtualDirname(vpath) {
		t.Errorf("on %s filepath.Dir and virtualDirname should agree, got %q vs %q", runtime.GOOS, got, virtualDirname(vpath))
	}
}
