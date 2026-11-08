package samba

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

// driveTestRig is a smb.conf with two drives: media in the system pool and
// photos in the pool of the family group
type driveTestRig struct {
	manager *ShareManager
	media   *filesystem.FileSystemHandler
	photos  *filesystem.FileSystemHandler
	base    *storage.StoragePool
	family  *permission.PermissionGroup
}

func newDriveTestRig(t *testing.T) *driveTestRig {
	t.Helper()
	root := t.TempDir()
	conf := filepath.Join(root, "smb.conf")
	if err := os.WriteFile(conf, []byte("[global]\n    workgroup = WORKGROUP\n"), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}

	newDrive := func(uuid string) *filesystem.FileSystemHandler {
		folder := filepath.Join(root, uuid)
		if err := os.MkdirAll(folder, 0755); err != nil {
			t.Fatalf("MkdirAll() = %v", err)
		}
		return &filesystem.FileSystemHandler{UUID: uuid, Path: folder, Hierarchy: "public", Filesystem: "ext4"}
	}

	rig := &driveTestRig{media: newDrive("media"), photos: newDrive("photos")}
	rig.base = &storage.StoragePool{Owner: "system", Storages: []*filesystem.FileSystemHandler{rig.media}}
	rig.family = &permission.PermissionGroup{
		Name:        "family",
		StoragePool: &storage.StoragePool{Owner: "family", Storages: []*filesystem.FileSystemHandler{rig.photos}},
	}
	groups := &permission.PermissionHandler{PermissionGroups: []*permission.PermissionGroup{rig.family}}
	handler, err := user.NewUserHandler(nil, nil, groups, rig.base, nil)
	if err != nil {
		t.Fatalf("NewUserHandler() = %v", err)
	}
	rig.manager = &ShareManager{SambaConfigPath: conf, UserHandler: handler}
	return rig
}

func (r *driveTestRig) user(name string, inFamily bool) *user.User {
	u := &user.User{Username: name, HomeDirectories: r.base}
	if inFamily {
		u.PermissionGroup = []*permission.PermissionGroup{r.family}
	}
	return u
}

func (r *driveTestRig) share(t *testing.T, name string) *ShareConfig {
	t.Helper()
	share, err := r.manager.GetShareByName(name)
	if err != nil {
		t.Fatalf("GetShareByName(%q) = %v", name, err)
	}
	return share
}

func TestSyncUserSharesCreatesAShareForEveryDrive(t *testing.T) {
	rig := newDriveTestRig(t)
	if err := rig.manager.syncUserShares(rig.user("alice", true)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	for _, name := range []string{"media", "photos"} {
		share := rig.share(t, name)
		if !rig.manager.UserCanAccessShare(share, "alice") {
			t.Errorf("alice is not on share %s: %v", name, share.ValidUsers)
		}
		if len(share.ReadList) != 0 {
			t.Errorf("share %s has a read list: %v", name, share.ReadList)
		}
	}
}

func TestSyncUserSharesPutsReadOnlyUsersOnTheReadList(t *testing.T) {
	rig := newDriveTestRig(t)
	rig.media.ReadOnly = true
	if err := rig.manager.syncUserShares(rig.user("alice", false)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if got := rig.share(t, "media").ReadList; len(got) != 1 || got[0] != "alice" {
		t.Fatalf("read list = %v, want alice", got)
	}

	rig.media.ReadOnly = false
	if err := rig.manager.syncUserShares(rig.user("alice", false)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if got := rig.share(t, "media").ReadList; len(got) != 0 {
		t.Fatalf("read list = %v, want empty once the drive is writable", got)
	}
}

func TestSyncUserSharesKeepsOtherUsersOnASharedShare(t *testing.T) {
	rig := newDriveTestRig(t)
	if err := rig.manager.syncUserShares(rig.user("alice", true)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if err := rig.manager.syncUserShares(rig.user("bob", true)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if err := rig.manager.syncUserShares(rig.user("bob", false)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}

	share := rig.share(t, "photos")
	if rig.manager.UserCanAccessShare(share, "bob") {
		t.Errorf("bob kept a drive he lost: %v", share.ValidUsers)
	}
	if !rig.manager.UserCanAccessShare(share, "alice") {
		t.Errorf("alice lost a drive she still has: %v", share.ValidUsers)
	}
}

func TestSyncUserSharesRemovesAShareNobodyHasLeft(t *testing.T) {
	rig := newDriveTestRig(t)
	if err := rig.manager.syncUserShares(rig.user("alice", true)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if err := rig.manager.syncUserShares(rig.user("alice", false)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if exists, _ := rig.manager.ShareExists("photos"); exists {
		t.Fatalf("the share of a drive nobody can use is still there")
	}
}

func TestSyncUserSharesLeavesHandMadeSharesAlone(t *testing.T) {
	rig := newDriveTestRig(t)
	if err := rig.manager.CreateNewSambaShare(&ShareConfig{
		Name:       "scans",
		Path:       rig.media.Path,
		ValidUsers: []string{"alice"},
	}); err != nil {
		t.Fatalf("CreateNewSambaShare() = %v", err)
	}
	if err := rig.manager.syncUserShares(rig.user("alice", false)); err != nil {
		t.Fatalf("syncUserShares() = %v", err)
	}
	if !rig.manager.UserCanAccessShare(rig.share(t, "scans"), "alice") {
		t.Fatalf("a share made by hand lost its user")
	}
}

func TestReadListSurvivesRewritingAShare(t *testing.T) {
	rig := newDriveTestRig(t)
	share := &ShareConfig{Name: "docs", Path: rig.media.Path, ValidUsers: []string{"alice", "bob"}, ReadList: []string{"bob"}}
	if !strings.Contains(convertShareConfigToString(share), "read list = bob") {
		t.Fatalf("the read list was not written")
	}
	if err := rig.manager.CreateNewSambaShare(share); err != nil {
		t.Fatalf("CreateNewSambaShare() = %v", err)
	}
	if err := rig.manager.AddUserToSambaShare("docs", "carol"); err != nil {
		t.Fatalf("AddUserToSambaShare() = %v", err)
	}
	if got := rig.share(t, "docs").ReadList; len(got) != 1 || got[0] != "bob" {
		t.Fatalf("read list after a rewrite = %v", got)
	}

	if err := rig.manager.RemoveUserFromSambaShare("docs", "bob"); err != nil {
		t.Fatalf("RemoveUserFromSambaShare() = %v", err)
	}
	if got := rig.share(t, "docs").ReadList; len(got) != 0 {
		t.Fatalf("read list after removing bob = %v", got)
	}
}

func TestParsePdbeditHashes(t *testing.T) {
	output := "alice:1000:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:8846F7EAEE8FB117AD06BDD830B7586C:[U          ]:LCT-69100000:\n" +
		"nopass:1001:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:NO PASSWORDXXXXXXXXXXXXXXXXXXXXX:[NU         ]:LCT-00000000:\n" +
		"locked:1002:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:[DU         ]:LCT-00000000:\n" +
		"not a valid line\n\n"
	got := parsePdbeditHashes(output)
	if len(got) != 1 {
		t.Fatalf("parsed %d entries: %v", len(got), got)
	}
	if want := []byte{0x88, 0x46, 0xF7, 0xEA}; string(got["alice"][:4]) != string(want) {
		t.Errorf("hash = %x", got["alice"])
	}
}

// Samba keeps the hash of an account it refuses, so the flags decide.
func TestParsePdbeditHashesSkipsRestrictedAccounts(t *testing.T) {
	const hash = "8846F7EAEE8FB117AD06BDD830B7586C"
	tests := []struct {
		name  string
		flags string
		want  bool
	}{
		{"normal", "[U          ]", true},
		{"noexpiry", "[UX         ]", true},
		{"disabled", "[DU         ]", false},
		{"locked", "[UL         ]", false},
		{"disabledlocked", "[DUL        ]", false},
		{"pc$", "[W          ]", false},
		{"server$", "[S          ]", false},
		{"trust$", "[I          ]", false},
		{"noflags", "", false},
		{"brokenflags", "U", false},
	}
	for _, tt := range tests {
		line := tt.name + ":1000:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:" + hash + ":" + tt.flags + ":LCT-69100000:\n"
		_, got := parsePdbeditHashes(line)[tt.name]
		if got != tt.want {
			t.Errorf("%s %q: imported = %v, want %v", tt.name, tt.flags, got, tt.want)
		}
	}
}
