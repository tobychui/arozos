package ftp

import (
	"os"
	"sort"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

// newTestAofs returns an aofs whose user can reach a local storage, a
// buffered remote storage and a closed storage.
func newTestAofs() aofs {
	return aofs{
		userinfo: &user.User{
			Username: "alice",
			HomeDirectories: &storage.StoragePool{
				Storages: []*filesystem.FileSystemHandler{
					{UUID: "user"},
					{UUID: "remote", RequireBuffer: true},
					{UUID: "closed", Closed: true},
				},
			},
		},
	}
}

func TestIsVirtualRootPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/", true},
		{"/README.txt", true},
		{"/user/../README.txt", true},
		{"/user", false},
		{"/user/README.txt", false},
		{"/readme.txt", false},
	}
	for _, c := range cases {
		if got := isVirtualRootPath(c.path); got != c.want {
			t.Errorf("isVirtualRootPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

func TestRootListing(t *testing.T) {
	a := newTestAofs()

	fi, err := a.Stat("/")
	if err != nil {
		t.Fatalf("Stat root: %v", err)
	}
	if !fi.IsDir() {
		t.Error("expected root to be a directory")
	}

	f, err := a.Open("/")
	if err != nil {
		t.Fatalf("Open root: %v", err)
	}
	defer f.Close()
	names, err := f.Readdirnames(-1)
	if err != nil {
		t.Fatalf("Readdirnames: %v", err)
	}
	sort.Strings(names)
	want := []string{"README.txt", "user"}
	if len(names) != len(want) {
		t.Fatalf("root entries = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("root entries = %v, want %v", names, want)
			break
		}
	}
}

func TestRootReadmeReadable(t *testing.T) {
	a := newTestAofs()
	f, err := a.Open("/README.txt")
	if err != nil {
		t.Fatalf("Open README: %v", err)
	}
	defer f.Close()
	buf := make([]byte, 64)
	n, _ := f.Read(buf)
	if n == 0 {
		t.Error("expected README.txt to have content")
	}
}

func TestRootIsReadOnly(t *testing.T) {
	a := newTestAofs()

	if _, err := a.OpenFile("/README.txt", os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
		t.Error("expected writing README.txt to fail")
	}
	if _, err := a.Create("/README.txt"); err == nil {
		t.Error("expected creating README.txt to fail")
	}
	if err := a.Remove("/README.txt"); err == nil {
		t.Error("expected removing README.txt to fail")
	}
	if err := a.Mkdir("/", 0755); err == nil {
		t.Error("expected mkdir on root to fail")
	}
	if err := a.Rename("/README.txt", "/user/README.txt"); err == nil {
		t.Error("expected renaming README.txt to fail")
	}
}
