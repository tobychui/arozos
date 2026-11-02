package filesystem

import (
	"errors"
	"testing"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

func TestGetIDFromVirtualPath(t *testing.T) {
	tests := []struct {
		vpath   string
		id      string
		subpath string
	}{
		{"user:/", "user", ""},
		{"user:", "user", ""},
		{"user:/Desktop", "user", "/Desktop"},
		{"user:/Desktop/", "user", "/Desktop"},
		{"user://Desktop//a.txt", "user", "/Desktop/a.txt"},
		{"user:\\Desktop\\a.txt", "user", "/Desktop/a.txt"},
		{"user:/Desktop/../Music", "user", "/Music"},
		{"user:/a:b.txt", "user", "/a:b.txt"},
		{"./user:/Desktop", "user", "/Desktop"},
		{"tmp:/x/y.zip", "tmp", "/x/y.zip"},
	}

	for _, tt := range tests {
		id, subpath, err := GetIDFromVirtualPath(tt.vpath)
		if err != nil {
			t.Errorf("GetIDFromVirtualPath(%q) unexpected error: %v", tt.vpath, err)
			continue
		}
		if id != tt.id || subpath != tt.subpath {
			t.Errorf("GetIDFromVirtualPath(%q) = %q, %q; want %q, %q", tt.vpath, id, subpath, tt.id, tt.subpath)
		}
	}
}

func TestGetIDFromVirtualPath_MissingID(t *testing.T) {
	if _, _, err := GetIDFromVirtualPath("/Desktop/a.txt"); err == nil {
		t.Error("GetIDFromVirtualPath without a vdID: want an error")
	}
}

// A subpath must not climb out of the storage it names: the storage alone
// decides permissions, and user homes are siblings under one root.
func TestGetIDFromVirtualPath_RejectsTraversal(t *testing.T) {
	for _, vpath := range []string{
		"user:../bob/secret.txt",
		"user:..",
		"user:/..",
		"user:/../bob",
		"user:/Desktop/../../bob/secret.txt",
		"user:..\\bob\\secret.txt",
		"user:/.. /bob",
	} {
		id, subpath, err := GetIDFromVirtualPath(vpath)
		if !errors.Is(err, arozfs.ErrPathEscapesRoot) {
			t.Errorf("GetIDFromVirtualPath(%q) = %q, %q, %v; want %v", vpath, id, subpath, err, arozfs.ErrPathEscapesRoot)
		}
	}
}
