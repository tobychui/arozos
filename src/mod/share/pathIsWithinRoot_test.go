package share

import (
	"os"
	"path/filepath"
	"testing"
)

// Regression test for the share-download relpath check in HandleShareAccess.
// A strings.HasPrefix(target, root) check (what this used to be) let a
// sibling directory whose name starts with root's name through: sharing
// "/data/shared_folder" and asking for
// "/data/shared_folder/../shared_folder_evil/secret.txt" resolves to
// "/data/shared_folder_evil/secret.txt", which is not inside the share at
// all, but the old string-prefix check accepted it.
func TestPathIsWithinRoot(t *testing.T) {
	root := filepath.Join(string(os.PathSeparator), "data", "shared_folder")

	cases := []struct {
		name   string
		target string
		want   bool
	}{
		{"the root itself", root, true},
		{"a file directly inside", filepath.Join(root, "notes.txt"), true},
		{"a file in a subdirectory", filepath.Join(root, "sub", "notes.txt"), true},
		{
			"sibling directory sharing a name prefix",
			filepath.Join(root+"_evil", "secret.txt"),
			false,
		},
		{
			"traversal that resolves into that sibling",
			filepath.Join(root, "..", "shared_folder_evil", "secret.txt"),
			false,
		},
		{"plain parent traversal", filepath.Join(root, "..", "..", "etc", "passwd"), false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := pathIsWithinRoot(root, c.target)
			if got != c.want {
				t.Errorf("pathIsWithinRoot(%q, %q) = %v, want %v", root, c.target, got, c.want)
			}
		})
	}
}
