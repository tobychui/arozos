package share

import (
	"strings"
	"testing"
	"time"

	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/emptyfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/sharefs"
	"imuslab.com/arozos/mod/share/shareEntry"
)

// driveShare builds a share of bob's file for the drive tests
func driveShare(uuid string, vpath string, createdAt int64, permission string, accessibles ...string) *shareEntry.ShareOption {
	so := shareEntry.DefaultShareOption()
	so.UUID = uuid
	so.FileVirtualPath = vpath
	so.PathHash = "hash:" + vpath
	so.Owner = "bob"
	so.Permission = permission
	so.Accessibles = accessibles
	so.CreatedAt = createdAt
	so.IsFolder = !strings.Contains(vpath[strings.LastIndex(vpath, "/")+1:], ".")
	return so
}

func TestIsAddressedTo(t *testing.T) {
	groups := []string{"staff", "family"}
	tests := []struct {
		name        string
		permission  string
		accessibles []string
		owner       string
		want        bool
	}{
		{"invited by name", shareEntry.PermissionUsers, []string{"carol", "alice"}, "bob", true},
		{"someone else invited", shareEntry.PermissionUsers, []string{"carol"}, "bob", false},
		{"one of my groups", shareEntry.PermissionGroups, []string{"admin", "family"}, "bob", true},
		{"none of my groups", shareEntry.PermissionGroups, []string{"admin"}, "bob", false},
		{"all of the owner's groups", shareEntry.PermissionSameGroup, []string{"staff"}, "bob", true},
		{"only some of the owner's groups", shareEntry.PermissionSameGroup, []string{"staff", "admin"}, "bob", false},
		{"same group without groups", shareEntry.PermissionSameGroup, []string{}, "bob", false},
		{"anyone with the link", shareEntry.PermissionAnyone, []string{}, "bob", false},
		{"signed-in users with the link", shareEntry.PermissionSignedIn, []string{}, "bob", false},
		{"my own share", shareEntry.PermissionUsers, []string{"alice"}, "alice", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			so := driveShare("s", "user:/Photos", 1, tc.permission, tc.accessibles...)
			so.Owner = tc.owner
			if got := isAddressedTo(so, "alice", groups); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestItemBaseName(t *testing.T) {
	tests := []struct {
		vpath string
		want  string
	}{
		{"user:/Photos", "Photos"},
		{"user:/Photos/", "Photos"},
		{"user:/Document/report.pdf", "report.pdf"},
		{"user:\\Document\\report.pdf", "report.pdf"},
		{"user:/", "user"},
		{"storage:", "storage"},
		{"no vroot", "uuid"},
	}
	for _, tc := range tests {
		t.Run(tc.vpath, func(t *testing.T) {
			so := driveShare("uuid", "user:/x", 1, shareEntry.PermissionUsers, "alice")
			so.FileVirtualPath = tc.vpath
			if got := itemBaseName(so); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNameWithSuffix(t *testing.T) {
	tests := []struct {
		name   string
		suffix string
		isDir  bool
		want   string
	}{
		{"report.pdf", "bob", false, "report (bob).pdf"},
		{"archive.tar.gz", "bob", false, "archive.tar (bob).gz"},
		{"Photos", "bob", true, "Photos (bob)"},
		{"v1.2", "bob 2", true, "v1.2 (bob 2)"},
		{".bashrc", "bob", false, ".bashrc (bob)"},
		{"README", "bob", false, "README (bob)"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := nameWithSuffix(tc.name, tc.suffix, tc.isDir); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSharedWith(t *testing.T) {
	now := time.Unix(1000, 0)
	groups := []string{"family"}

	expired := driveShare("expired", "user:/Old", 1, shareEntry.PermissionUsers, "alice")
	expired.ExpireAt = 500
	locked := driveShare("locked", "user:/Locked", 2, shareEntry.PermissionUsers, "alice")
	locked.SetPassword("pw")

	//Two shares of the same folder: one view only, one that allows downloads
	photosView := driveShare("photos-view", "user:/Photos", 10, shareEntry.PermissionGroups, "family")
	photosView.AllowDownload = false
	photosView.ShowFileList = false
	photosEdit := driveShare("photos-edit", "user:/Photos", 20, shareEntry.PermissionUsers, "alice")
	photosEdit.AccessLevel = shareEntry.AccessLevelEdit

	//Three different things that all want to be called "report.pdf"
	report1 := driveShare("report-1", "user:/A/report.pdf", 30, shareEntry.PermissionUsers, "alice")
	report2 := driveShare("report-2", "user:/B/report.pdf", 31, shareEntry.PermissionUsers, "alice")
	report3 := driveShare("report-3", "user:/C/Report.PDF", 32, shareEntry.PermissionUsers, "alice")
	report3.Owner = "carol"
	report4 := driveShare("report-4", "user:/D/report.pdf", 33, shareEntry.PermissionUsers, "alice")

	public := driveShare("public", "user:/Public", 40, shareEntry.PermissionAnyone)
	notMine := driveShare("not-mine", "user:/Other", 41, shareEntry.PermissionUsers, "carol")

	//Listed newest first to show the order does not depend on the input
	all := []*shareEntry.ShareOption{notMine, public, report4, report3, report2, report1, photosEdit, photosView, locked, expired}
	entries := sharedWith(all, "alice", groups, now)

	type result struct {
		name   string
		shares string
	}
	got := []result{}
	for _, e := range entries {
		ids := []string{}
		for _, so := range e.Shares {
			ids = append(ids, so.UUID)
		}
		got = append(got, result{e.Name, strings.Join(ids, ",")})
	}
	want := []result{
		{"Photos", "photos-view,photos-edit"},
		{"report.pdf", "report-1"},
		{"report (bob).pdf", "report-2"},
		//Differs only in case, so it takes a suffix too
		{"Report (carol).PDF", "report-3"},
		{"report (bob 2).pdf", "report-4"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("entry %d: got %v, want %v", i, got[i], want[i])
		}
	}

	canBrowse, canDownload, canUpload := entries[0].permissions()
	if !canBrowse || !canDownload || !canUpload {
		t.Errorf("merged permissions of Photos: browse %v download %v upload %v", canBrowse, canDownload, canUpload)
	}
	canBrowse, canDownload, canUpload = entries[1].permissions()
	if canBrowse || !canDownload || canUpload {
		t.Errorf("permissions of a file: browse %v download %v upload %v", canBrowse, canDownload, canUpload)
	}

	//Someone with nothing shared sees nothing
	if entries := sharedWith(all, "dave", nil, now); len(entries) != 0 {
		t.Errorf("dave sees %d entries", len(entries))
	}
}

func TestSharedWithNamesAreStable(t *testing.T) {
	now := time.Unix(1000, 0)
	first := driveShare("first", "user:/A/notes.txt", 1, shareEntry.PermissionUsers, "alice")
	second := driveShare("second", "user:/B/notes.txt", 2, shareEntry.PermissionUsers, "alice")

	before := sharedWith([]*shareEntry.ShareOption{first, second}, "alice", nil, now)
	after := sharedWith([]*shareEntry.ShareOption{second, first}, "alice", nil, now)
	for i := range before {
		if before[i].Name != after[i].Name {
			t.Errorf("name %d changed from %q to %q with the input order", i, before[i].Name, after[i].Name)
		}
	}
}

func TestSharedDriveCache(t *testing.T) {
	var cache sharedDriveCache
	now := time.Unix(1000, 0)
	items := []*sharefs.Item{{Name: "Photos"}}

	if _, ok := cache.get("alice", now); ok {
		t.Fatalf("empty cache returned a root")
	}
	cache.put("alice", items, now)
	if got, ok := cache.get("alice", now.Add(time.Second)); !ok || len(got) != 1 {
		t.Errorf("fresh root not returned: %v %v", got, ok)
	}
	if _, ok := cache.get("bob", now); ok {
		t.Errorf("another user's root returned")
	}
	if _, ok := cache.get("alice", now.Add(sharedDriveCacheTTL+time.Second)); ok {
		t.Errorf("stale root returned")
	}
	cache.put("alice", items, now)
	cache.clear()
	if _, ok := cache.get("alice", now); ok {
		t.Errorf("root returned after clear")
	}
}

func TestIsSharedDrive(t *testing.T) {
	drive := &filesystem.FileSystemHandler{FileSystemAbstraction: sharefs.New(SharedDriveUUID, nil, sharefs.Options{})}
	other := &filesystem.FileSystemHandler{FileSystemAbstraction: emptyfs.NewEmptyFileSystemAbstraction()}
	if !IsSharedDrive(drive) {
		t.Errorf("the share drive was not recognised")
	}
	if IsSharedDrive(other) || IsSharedDrive(nil) {
		t.Errorf("another drive was taken for the share drive")
	}
}

func TestManagerItemsWithoutBackends(t *testing.T) {
	m := NewShareManager(Options{})
	if items := m.Items("alice"); len(items) != 0 {
		t.Errorf("a manager without user handler listed %d items", len(items))
	}
}
