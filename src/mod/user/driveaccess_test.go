package user

import (
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/permission"
	storage "imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/storage/access"
)

// ruleMap is an access.Source over a fixed set of rules
type ruleMap map[string]access.Rule

func (m ruleMap) Rule(uuid string) (access.Rule, bool) {
	rule, ok := m[uuid]
	return rule, ok
}

func newGroup(name string, isAdmin bool, drives ...string) *permission.PermissionGroup {
	pool := &storage.StoragePool{Owner: name}
	for _, uuid := range drives {
		pool.Storages = append(pool.Storages, &fs.FileSystemHandler{UUID: uuid, Hierarchy: "public"})
	}
	return &permission.PermissionGroup{Name: name, IsAdmin: isAdmin, StoragePool: pool}
}

/*
The world of these tests: a system pool with the built-in drives and a drive
called media, the admin group "administrator", and the groups "family" (with
the drive photos) and "guests" (with no drive of their own).
*/
func newDriveTestUser(rules ruleMap, groupNames ...string) *User {
	base := &storage.StoragePool{
		Owner: "system",
		Storages: []*fs.FileSystemHandler{
			{UUID: "user", Hierarchy: "user"},
			{UUID: "tmp", Hierarchy: "user"},
			{UUID: "share", Hierarchy: "public", ReadOnly: true},
			{UUID: "cluster", Hierarchy: "public"},
			{UUID: "media", Hierarchy: "public"},
		},
	}
	all := []*permission.PermissionGroup{
		newGroup("administrator", true),
		newGroup("family", false, "photos"),
		newGroup("guests", false),
	}
	handler := &UserHandler{
		phandler:   &permission.PermissionHandler{PermissionGroups: all},
		basePool:   base,
		driveRules: rules,
	}

	u := &User{Username: "alice", HomeDirectories: base, parent: handler}
	for _, pg := range all {
		for _, name := range groupNames {
			if pg.Name == name {
				u.PermissionGroup = append(u.PermissionGroup, pg)
			}
		}
	}
	return u
}

func TestDriveAccessLevels(t *testing.T) {
	familyOnly := access.Rule{Other: access.None, Groups: map[string]string{"family": access.ReadWrite}}

	tests := []struct {
		name   string
		rules  ruleMap
		groups []string
		vpath  string
		want   string
	}{
		{"no rules: system drive", nil, []string{"guests"}, "media:/a.txt", arozfs.FsReadWrite},
		{"no rules: share", nil, []string{"guests"}, "share:/a.txt", arozfs.FsReadOnly},
		{"no rules: cluster", nil, []string{"guests"}, "cluster:/a.txt", arozfs.FsReadWrite},
		{"no rules: own group drive", nil, []string{"family"}, "photos:/a.txt", arozfs.FsReadWrite},
		{"no rules: other group drive", nil, []string{"guests"}, "photos:/a.txt", arozfs.FsDenied},
		{"no rules: admin outside the group", nil, []string{"administrator"}, "photos:/a.txt", arozfs.FsDenied},

		{"cluster closed to a stranger", ruleMap{"cluster": familyOnly}, []string{"guests"}, "cluster:/a.txt", arozfs.FsDenied},
		{"cluster open to the listed group", ruleMap{"cluster": familyOnly}, []string{"family"}, "cluster:/a.txt", arozfs.FsReadWrite},
		{"cluster stays open to an admin", ruleMap{"cluster": familyOnly}, []string{"administrator"}, "cluster:/a.txt", arozfs.FsReadWrite},

		{"share hidden from a group", ruleMap{"share": {Other: access.Read, Groups: map[string]string{"guests": access.None}}}, []string{"guests"}, "share:/a.txt", arozfs.FsDenied},
		{"share still visible to the rest", ruleMap{"share": {Other: access.Read, Groups: map[string]string{"guests": access.None}}}, []string{"family"}, "share:/a.txt", arozfs.FsReadOnly},

		{"a row reaches into another pool", ruleMap{"photos": {Other: access.None, Groups: map[string]string{"guests": access.Read}}}, []string{"guests"}, "photos:/a.txt", arozfs.FsReadOnly},
		{"the default access reaches into another pool", ruleMap{"photos": {Other: access.ReadWrite}}, []string{"guests"}, "photos:/a.txt", arozfs.FsReadWrite},
		{"the home group ignores its own row", ruleMap{"photos": {Other: access.None, Groups: map[string]string{"family": access.None}}}, []string{"family"}, "photos:/a.txt", arozfs.FsReadWrite},
		{"the home drive is out of reach of rules", ruleMap{"user": {Other: access.None}}, []string{"guests"}, "user:/a.txt", arozfs.FsReadWrite},

		{"a drive nobody has", nil, []string{"family"}, "missing:/a.txt", arozfs.FsDenied},
		{"a path leaving its drive", nil, []string{"family"}, "media:../secret", arozfs.FsDenied},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u := newDriveTestUser(tt.rules, tt.groups...)
			if got := u.GetPathAccessPermission(tt.vpath); got != tt.want {
				t.Errorf("GetPathAccessPermission(%q) = %q, want %q", tt.vpath, got, tt.want)
			}
		})
	}
}

func driveIDs(fshs []*fs.FileSystemHandler) map[string]bool {
	ids := map[string]bool{}
	for _, fsh := range fshs {
		ids[fsh.UUID] = true
	}
	return ids
}

func TestDeniedDriveIsNotListed(t *testing.T) {
	u := newDriveTestUser(ruleMap{"cluster": {Other: access.None}}, "guests")
	ids := driveIDs(u.GetAllFileSystemHandler())
	if ids["cluster"] {
		t.Errorf("a drive the user cannot use was listed")
	}
	for _, uuid := range []string{"user", "tmp", "share", "media"} {
		if !ids[uuid] {
			t.Errorf("%s is missing from %v", uuid, ids)
		}
	}
	if _, err := u.GetFileSystemHandlerFromVirtualPath("cluster:/a.txt"); err == nil {
		t.Errorf("a denied drive can still be resolved through the user")
	}
}

func TestDriveOfAnotherPoolIsListedThroughARow(t *testing.T) {
	rules := ruleMap{"photos": {Other: access.None, Groups: map[string]string{"guests": access.Read}}}
	if ids := driveIDs(newDriveTestUser(rules, "guests").GetAllFileSystemHandler()); !ids["photos"] {
		t.Errorf("photos is missing from %v", ids)
	}
	if ids := driveIDs(newDriveTestUser(rules, "administrator").GetAllFileSystemHandler()); ids["photos"] {
		t.Errorf("an admin outside the group got photos: %v", ids)
	}
}

func TestClosedDriveIsNotListed(t *testing.T) {
	u := newDriveTestUser(nil, "guests")
	for _, fsh := range u.HomeDirectories.Storages {
		if fsh.UUID == "media" {
			fsh.Closed = true
		}
	}
	if ids := driveIDs(u.GetAllFileSystemHandler()); ids["media"] {
		t.Errorf("a stopped drive was listed")
	}
}

// A drive id used by two pools is listed once, and the user keeps the higher
// of the two levels. Decided on review: such ids only warn, they stay loaded.
func TestDuplicateDriveID(t *testing.T) {
	u := newDriveTestUser(nil, "family")
	u.HomeDirectories.Storages = append(u.HomeDirectories.Storages, &fs.FileSystemHandler{UUID: "photos", ReadOnly: true})

	count := 0
	for _, fsh := range u.GetAllFileSystemHandler() {
		if fsh.UUID == "photos" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("photos was listed %d times", count)
	}
	if got := u.GetPathAccessPermission("photos:/a.txt"); got != arozfs.FsReadWrite {
		t.Errorf("level = %q, want the higher of the two", got)
	}
}

func TestExplainDriveAccess(t *testing.T) {
	rules := ruleMap{"cluster": {Other: access.None, Groups: map[string]string{"family": access.Read}}}
	u := newDriveTestUser(rules, "family")

	decision, found := u.ExplainDriveAccess("cluster")
	if !found || decision.Reason != access.ReasonGroup || decision.Group != "family" || decision.Level != access.Read {
		t.Errorf("ExplainDriveAccess() = %+v, %v", decision, found)
	}
	if _, found := u.ExplainDriveAccess("missing"); found {
		t.Errorf("a drive nobody has was found")
	}
}

func TestResetQuotaManagers(t *testing.T) {
	quotaManagerBuffer.Store("alice", true)
	quotaManagerBuffer.Store("bob", true)

	(&UserHandler{}).ResetQuotaManagers()

	quotaManagerBuffer.Range(func(key, value interface{}) bool {
		t.Errorf("%v is still buffered", key)
		return true
	})
}
