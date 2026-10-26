package main

import (
	"os"
	"path/filepath"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/sharefs"
	"imuslab.com/arozos/mod/user"
)

// testShareResolver hands out a fixed drive root per user
type testShareResolver map[string][]*sharefs.Item

func (r testShareResolver) Items(username string) []*sharefs.Item {
	return r[username]
}

func TestSharedDriveOwnerOf(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "users", "test", "Music"), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "users", "test", "Music", "song.mp3"), []byte("mp3"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	ownerAbs := localfs.NewLocalFileSystemAbstraction("user", root, "user", false)
	ownerFsh := &fs.FileSystemHandler{UUID: "user", Hierarchy: "user", Path: root, FileSystemAbstraction: ownerAbs}
	musicRoot, _ := ownerAbs.VirtualPathToRealPath("/Music", "test")

	drive := &fs.FileSystemHandler{
		UUID:      "share",
		Hierarchy: "public",
		FileSystemAbstraction: sharefs.New("share", testShareResolver{
			"TC": {{Name: "Music", Owner: "test", IsDir: true, CanBrowse: true, Fsh: ownerFsh, Root: musicRoot}},
		}, sharefs.Options{}),
	}

	tests := []struct {
		name     string
		username string
		fsh      *fs.FileSystemHandler
		vpath    string
		want     string
	}{
		{"shared folder", "TC", drive, "share:/Music", "test"},
		{"file inside a shared folder", "TC", drive, "share:/Music/song.mp3", "test"},
		{"drive root has no single owner", "TC", drive, "share:/", ""},
		{"not shared with this user", "carol", drive, "share:/Music/song.mp3", ""},
		{"not shared at all", "TC", drive, "share:/Other/x.txt", ""},
		{"another drive", "TC", ownerFsh, "user:/Music/song.mp3", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sharedDriveOwnerOf(&user.User{Username: tc.username}, tc.fsh, tc.vpath)
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}
