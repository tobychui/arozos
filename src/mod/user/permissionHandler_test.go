package user

import (
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	storage "imuslab.com/arozos/mod/storage"
)

// alice with the base pool: a "user" home drive and a read only "share" drive
func newPermissionTestUser() *User {
	return &User{
		Username: "alice",
		HomeDirectories: &storage.StoragePool{
			Owner: "system",
			Storages: []*fs.FileSystemHandler{
				{UUID: "user", Hierarchy: "user"},
				{UUID: "share", Hierarchy: "public", ReadOnly: true},
			},
		},
	}
}

func TestGetPathAccessPermission(t *testing.T) {
	u := newPermissionTestUser()
	tests := []struct {
		vpath string
		want  string
	}{
		{"user:/", arozfs.FsReadWrite},
		{"user:/Desktop/notes.txt", arozfs.FsReadWrite},
		{"user:/Desktop/../Music", arozfs.FsReadWrite},
		{"share:/report.pdf", arozfs.FsReadOnly},
		{"other:/report.pdf", arozfs.FsDenied},
		{"no-vroot-id", arozfs.FsDenied},
	}

	for _, tt := range tests {
		if got := u.GetPathAccessPermission(tt.vpath); got != tt.want {
			t.Errorf("GetPathAccessPermission(%q) = %q, want %q", tt.vpath, got, tt.want)
		}
	}
}

/*
The permission is decided by the storage pool, which alice owns for "user:",
so a subpath leaving her home ("user:../bob/...") must be denied by the
subpath check rather than slip through on the pool.
*/
func TestGetPathAccessPermission_DeniesTraversal(t *testing.T) {
	u := newPermissionTestUser()
	for _, vpath := range []string{
		"user:../bob/secret.txt",
		"user:..",
		"user:/../bob/secret.txt",
		"user:/Desktop/../../bob",
		"user:..\\bob\\secret.txt",
		"share:../user/users/bob",
	} {
		if got := u.GetPathAccessPermission(vpath); got != arozfs.FsDenied {
			t.Errorf("GetPathAccessPermission(%q) = %q, want %q", vpath, got, arozfs.FsDenied)
		}
		if u.CanRead(vpath) || u.CanWrite(vpath) {
			t.Errorf("CanRead/CanWrite(%q) allowed a path outside the drive", vpath)
		}
	}
}
