package filesystem

import (
	"fmt"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem/abstractions/emptyfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// pointerFS is an abstraction used through a pointer, to build a nil one
type pointerFS struct {
	emptyfs.EmptyFileSystemAbstraction
}

// TestHandlerDebugString describes handlers in their risky states.
func TestHandlerDebugString(t *testing.T) {
	local := localfs.NewLocalFileSystemAbstraction("photos", t.TempDir(), "public", false)
	tests := []struct {
		name string
		fsh  *FileSystemHandler
		want string
	}{
		{"nil handler", nil, "<nil drive handler>"},
		{"empty handler", &FileSystemHandler{}, `"" (:/ - - rw, abstraction <nil>)`},
		{"local", &FileSystemHandler{Name: "Photos", UUID: "photos", Filesystem: "ext4", Hierarchy: "public", FileSystemAbstraction: local},
			`"Photos" (photos:/ ext4 public rw, localfs.LocalFileSystemAbstraction)`},
		{"read only and closed", &FileSystemHandler{Name: "Old", UUID: "old", Filesystem: "ntfs", Hierarchy: "user", ReadOnly: true, Closed: true, FileSystemAbstraction: local},
			`"Old" (old:/ ntfs user ro, localfs.LocalFileSystemAbstraction, CLOSED)`},
		{"nil pointer abstraction", &FileSystemHandler{Name: "NAS", UUID: "nas", Filesystem: "webdav", Hierarchy: "public", FileSystemAbstraction: (*pointerFS)(nil)},
			`"NAS" (nas:/ webdav public rw, *filesystem.pointerFS <nil pointer>)`},
		{"pointer abstraction", &FileSystemHandler{Name: "NAS", UUID: "nas", Filesystem: "webdav", Hierarchy: "public", FileSystemAbstraction: &pointerFS{}},
			`"NAS" (nas:/ webdav public rw, *filesystem.pointerFS)`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.fsh.DebugString(); got != tt.want {
				t.Errorf("DebugString() = %s, want %s", got, tt.want)
			}
		})
	}
}

// TestDescribe checks that Describe prints as DebugString, nil included.
func TestDescribe(t *testing.T) {
	handlers := []*FileSystemHandler{nil, {Name: "Photos", UUID: "photos", Closed: true}}
	for _, fsh := range handlers {
		if got, want := fmt.Sprintf("%s|%v", fsh.Describe(), fsh.Describe()), fsh.DebugString()+"|"+fsh.DebugString(); got != want {
			t.Errorf("Describe() printed %s, want %s", got, want)
		}
	}
}

// TestOptionDebugString checks that options are described without the
// password.
func TestOptionDebugString(t *testing.T) {
	tests := []struct {
		name    string
		option  FileSystemOption
		want    []string
		notWant []string
	}{
		{"local", FileSystemOption{Name: "Data", Uuid: "data", Filesystem: "ext4", Path: "./data", Hierarchy: "public", Access: "readwrite"},
			[]string{`name="Data"`, "uuid=data", "fs=ext4", `path="./data"`, "hierarchy=public", "access=readwrite"},
			[]string{"automount", "username", "password"}},
		{"automount", FileSystemOption{Name: "USB", Uuid: "usb", Filesystem: "vfat", Automount: true, Mountdev: "sdb1", Mountpt: "./media/usb", DiskUUID: "1234-ABCD"},
			[]string{"automount=true", "mountdev=sdb1", `mountpt="./media/usb"`, "diskuuid=1234-ABCD", "access=-"},
			[]string{"password"}},
		{"network", FileSystemOption{Name: "NAS", Uuid: "nas", Filesystem: "webdav", Path: "https://nas.example.com/dav", Username: "alice", Password: "hunter2"},
			[]string{`username="alice"`, "password=<set>"},
			[]string{"hunter2"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.option.DebugString()
			for _, w := range tt.want {
				if !strings.Contains(got, w) {
					t.Errorf("%q missing from %s", w, got)
				}
			}
			for _, w := range tt.notWant {
				if strings.Contains(got, w) {
					t.Errorf("%q should not be in %s", w, got)
				}
			}
		})
	}
}

// TestDebugHandlerList lists handler ids with their risky states.
func TestDebugHandlerList(t *testing.T) {
	local := localfs.NewLocalFileSystemAbstraction("user", t.TempDir(), "user", false)
	tests := []struct {
		name     string
		handlers []*FileSystemHandler
		want     string
	}{
		{"empty", nil, "[]"},
		{"mixed", []*FileSystemHandler{
			{UUID: "user", FileSystemAbstraction: local},
			nil,
			{UUID: "usb"},
			{UUID: "old", Closed: true, FileSystemAbstraction: local},
		}, "[user:/, <nil>, usb:/(no abstraction), old:/(closed)]"},
	}
	for _, tt := range tests {
		if got := DebugHandlerList(tt.handlers); got != tt.want {
			t.Errorf("%s: DebugHandlerList() = %s, want %s", tt.name, got, tt.want)
		}
	}
}
