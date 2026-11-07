package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/access"
)

type testRules map[string]access.Rule

func (m testRules) Rule(uuid string) (access.Rule, bool) {
	rule, ok := m[uuid]
	return rule, ok
}

func findDrive(t *testing.T, drives []driveInfo, pool string, uuid string) driveInfo {
	t.Helper()
	for _, drive := range drives {
		if drive.UUID == uuid && drive.Pool == pool {
			return drive
		}
	}
	t.Fatalf("no drive %s in pool %s: %+v", uuid, pool, drives)
	return driveInfo{}
}

func TestBuildDriveListStates(t *testing.T) {
	pools := []poolState{
		{
			owner: storagePoolSystem,
			live: []*fs.FileSystemHandler{
				{UUID: "user", Name: "User"},
				{UUID: "tmp", Name: "tmp"},
				{UUID: "share", Name: "Shared with me", ReadOnly: true},
				{UUID: "cluster", Name: "Cluster"},
				{UUID: "media", Name: "Media"},
				{UUID: "paused", Name: "Paused", Closed: true},
				{UUID: "deleted", Name: "Deleted"},
			},
			config: []fs.FileSystemOption{
				{Uuid: "media", Name: "Media"},
				{Uuid: "paused", Name: "Paused"},
				{Uuid: "unplugged", Name: "Unplugged", Path: "/mnt/usb", Access: "readonly"},
			},
		},
		{
			owner:  "family",
			live:   []*fs.FileSystemHandler{{UUID: "photos", Name: "Photos"}},
			config: []fs.FileSystemOption{{Uuid: "photos", Name: "Photos"}},
		},
	}

	tests := []struct {
		pool      string
		uuid      string
		wantState string
		wantKind  string
		editable  bool
	}{
		{storagePoolSystem, "user", driveStateOnline, driveKindFixed, false},
		{storagePoolSystem, "tmp", driveStateOnline, driveKindFixed, false},
		{storagePoolSystem, "share", driveStateOnline, driveKindBuiltin, true},
		{storagePoolSystem, "cluster", driveStateOnline, driveKindBuiltin, true},
		{storagePoolSystem, "media", driveStateOnline, driveKindConfigured, true},
		{storagePoolSystem, "paused", driveStateStopped, driveKindConfigured, true},
		{storagePoolSystem, "deleted", driveStateRemoved, driveKindConfigured, true},
		{storagePoolSystem, "unplugged", driveStateOffline, driveKindConfigured, true},
		{"family", "photos", driveStateOnline, driveKindConfigured, true},
	}

	drives := buildDriveList(pools, testRules{})
	for _, tt := range tests {
		t.Run(tt.uuid, func(t *testing.T) {
			got := findDrive(t, drives, tt.pool, tt.uuid)
			if got.State != tt.wantState {
				t.Errorf("State = %q, want %q", got.State, tt.wantState)
			}
			if got.Kind != tt.wantKind {
				t.Errorf("Kind = %q, want %q", got.Kind, tt.wantKind)
			}
			if got.Editable != tt.editable {
				t.Errorf("Editable = %v, want %v", got.Editable, tt.editable)
			}
		})
	}

	if !findDrive(t, drives, storagePoolSystem, "unplugged").ReadOnly {
		t.Errorf("an offline drive lost its read only setting")
	}
}

func TestBuildDriveListRules(t *testing.T) {
	pools := []poolState{
		{owner: storagePoolSystem, live: []*fs.FileSystemHandler{{UUID: "share"}, {UUID: "media"}, {UUID: "docs"}}},
		{owner: "family", live: []*fs.FileSystemHandler{{UUID: "photos"}}},
	}
	saved := access.Rule{Other: access.None, Groups: map[string]string{"family": access.Read}}
	drives := buildDriveList(pools, testRules{"docs": saved})

	tests := []struct {
		pool string
		uuid string
		want access.Rule
	}{
		{storagePoolSystem, "share", access.Rule{Other: access.Read}},
		{storagePoolSystem, "media", access.Rule{Other: access.ReadWrite}},
		{storagePoolSystem, "docs", saved},
		{"family", "photos", access.Rule{Other: access.None}},
	}
	for _, tt := range tests {
		if got := findDrive(t, drives, tt.pool, tt.uuid).Rule; !reflect.DeepEqual(got, tt.want) {
			t.Errorf("rule of %s = %+v, want %+v", tt.uuid, got, tt.want)
		}
	}
}

// What the page gets must never hold a login, which is what the old raw
// config endpoint leaked
func TestDriveListCarriesNoLogin(t *testing.T) {
	pools := []poolState{{
		owner: storagePoolSystem,
		live: []*fs.FileSystemHandler{{
			UUID:         "nas",
			StartOptions: fs.FileSystemOption{Uuid: "nas", Username: "secret-user", Password: "secret-pass"},
		}},
		config: []fs.FileSystemOption{
			{Uuid: "nas", Username: "secret-user", Password: "secret-pass"},
			{Uuid: "offline", Username: "secret-user", Password: "secret-pass"},
		},
	}}

	js, err := json.Marshal(buildDriveList(pools, testRules{}))
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	if strings.Contains(string(js), "secret") {
		t.Fatalf("the drive list holds a login: %s", js)
	}
}

func TestDuplicateDriveIDs(t *testing.T) {
	pools := []poolState{
		{owner: "system", live: []*fs.FileSystemHandler{{UUID: "media"}, {UUID: "data"}}},
		{owner: "family", config: []fs.FileSystemOption{{Uuid: "data"}}},
		{owner: "guests", live: []*fs.FileSystemHandler{{UUID: "own"}}, config: []fs.FileSystemOption{{Uuid: "own"}}},
	}
	if got := duplicateDriveIDs(pools); !reflect.DeepEqual(got, []string{"data"}) {
		t.Fatalf("duplicateDriveIDs() = %v", got)
	}

	drives := buildDriveList(pools, testRules{})
	if !findDrive(t, drives, "system", "data").Duplicate || !findDrive(t, drives, "family", "data").Duplicate {
		t.Errorf("a duplicate id was not flagged on both drives")
	}
	if findDrive(t, drives, "guests", "own").Duplicate {
		t.Errorf("a drive both running and configured counted as a duplicate")
	}
}

func TestApplyClusterDriveState(t *testing.T) {
	mounted := []driveInfo{{UUID: "cluster", State: driveStateOnline, Editable: true}}
	got := applyClusterDriveState(mounted, true, testRules{})
	if len(got) != 1 || !got[0].Replicated || !got[0].Editable || got[0].State != driveStateOnline {
		t.Errorf("mounted drive in a cluster = %+v", got)
	}

	got = applyClusterDriveState([]driveInfo{}, false, testRules{})
	if len(got) != 1 {
		t.Fatalf("no row for a drive that is not mounted: %+v", got)
	}
	if got[0].State != driveStateNotActive || got[0].Editable {
		t.Errorf("a node outside a cluster = %+v, want not active and not editable", got[0])
	}

	got = applyClusterDriveState([]driveInfo{}, true, testRules{})
	if got[0].State != driveStateNotActive || !got[0].Editable {
		t.Errorf("a cluster with no volume yet = %+v, want not active but editable", got[0])
	}
}

func TestPrepareDriveRule(t *testing.T) {
	tests := []struct {
		name    string
		uuid    string
		home    string
		rule    access.Rule
		want    access.Rule
		wantErr bool
	}{
		{name: "plain rule", uuid: "media", rule: access.Rule{Other: access.Read}, want: access.Rule{Other: access.Read}},
		{name: "home drive", uuid: "user", rule: access.Rule{Other: access.None}, wantErr: true},
		{name: "tmp drive", uuid: "tmp", rule: access.Rule{Other: access.None}, wantErr: true},
		{name: "invalid level", uuid: "media", rule: access.Rule{Other: "writeonly"}, wantErr: true},
		{name: "share can be hidden", uuid: "share", rule: access.Rule{Other: access.None}, want: access.Rule{Other: access.None}},
		{name: "share cannot be writable", uuid: "share", rule: access.Rule{Other: access.ReadWrite}, wantErr: true},
		{name: "share row cannot be writable", uuid: "share", rule: access.Rule{Other: access.Read, Groups: map[string]string{"a": access.ReadWrite}}, wantErr: true},
		{
			name: "a row for the home group is dropped",
			uuid: "photos",
			home: "family",
			rule: access.Rule{Other: access.None, Groups: map[string]string{"family": access.None, "guests": access.Read}},
			want: access.Rule{Other: access.None, Groups: map[string]string{"guests": access.Read}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := tt.rule.Clone()
			err := prepareDriveRule(tt.uuid, tt.home, &rule)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && !reflect.DeepEqual(rule, tt.want) {
				t.Errorf("rule = %+v, want %+v", rule, tt.want)
			}
		})
	}
}

func TestValidateNewDrive(t *testing.T) {
	folder := t.TempDir()
	pools := []poolState{
		{owner: "system", config: []fs.FileSystemOption{{Uuid: "media"}}},
		{owner: "family", live: []*fs.FileSystemHandler{{UUID: "photos"}}},
	}
	valid := func(uuid string) *fs.FileSystemOption {
		return &fs.FileSystemOption{Name: "Drive", Uuid: uuid, Path: folder, Access: "readwrite", Hierarchy: "public", Filesystem: "ext4"}
	}

	tests := []struct {
		name    string
		uuid    string
		wantErr bool
	}{
		{"new id", "docs", false},
		{"id with dash and underscore", "my-drive_2", false},
		{"id configured in another pool", "media", true},
		{"id running in another pool", "photos", true},
		{"reserved home drive", "user", true},
		{"reserved cluster drive", "cluster", true},
		{"reserved share drive", "share", true},
		{"a colon would split the path", "a:b", true},
		{"a slash would split the path", "a/b", true},
		{"a space", "my drive", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateNewDrive(valid(tt.uuid), pools); (err != nil) != tt.wantErr {
				t.Errorf("error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func useTestStorageConfig(t *testing.T, options []fs.FileSystemOption) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "storage.json")
	content, err := json.Marshal(options)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	if err := os.WriteFile(filename, content, 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	previous := *storage_config_file
	*storage_config_file = filename
	t.Cleanup(func() { *storage_config_file = previous })
	return filename
}

func TestEditingADriveKeepsItsRowAndLogin(t *testing.T) {
	folder := t.TempDir()
	useTestStorageConfig(t, []fs.FileSystemOption{
		{Name: "First", Uuid: "first", Path: folder, Access: "readwrite", Hierarchy: "public", Filesystem: "ext4"},
		{Name: "NAS", Uuid: "nas", Path: "10.0.0.2/share", Access: "readwrite", Hierarchy: "public", Filesystem: "smb", Username: "kept", Password: "stored"},
		{Name: "Last", Uuid: "last", Path: folder, Access: "readwrite", Hierarchy: "public", Filesystem: "ext4"},
	})

	edited := fs.FileSystemOption{Name: "Renamed", Uuid: "nas", Path: "10.0.0.3/share", Access: "readonly", Hierarchy: "public", Filesystem: "smb"}
	if err := setFSHConfigByGroupAndId(storagePoolSystem, "nas", &edited); err != nil {
		t.Fatalf("setFSHConfigByGroupAndId() = %v", err)
	}

	got, err := readPoolConfig(storagePoolSystem)
	if err != nil {
		t.Fatalf("readPoolConfig() = %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("%d rows, want 3: %+v", len(got), got)
	}
	if got[1].Uuid != "nas" || got[1].Name != "Renamed" || got[1].Path != "10.0.0.3/share" {
		t.Errorf("row in the wrong place or not updated: %+v", got[1])
	}
	if got[1].Username != "kept" || got[1].Password != "stored" {
		t.Errorf("the stored login was lost: %+v", got[1])
	}
	if edited.Password != "stored" {
		t.Errorf("the option to mount has no login: %+v", edited)
	}
}

func TestEditingRefusesAnInvalidDrive(t *testing.T) {
	useTestStorageConfig(t, []fs.FileSystemOption{
		{Name: "Media", Uuid: "media", Path: t.TempDir(), Access: "readwrite", Hierarchy: "public", Filesystem: "ext4"},
	})
	edited := fs.FileSystemOption{Name: "Media", Uuid: "media", Path: filepath.Join(t.TempDir(), "missing"), Access: "readwrite", Hierarchy: "public", Filesystem: "ext4"}
	if err := setFSHConfigByGroupAndId(storagePoolSystem, "media", &edited); err == nil {
		t.Fatalf("a path that does not exist was saved")
	}
}

func TestParseClusterDriveRule(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want access.Rule
	}{
		{"valid", `{"other":"denied","groups":{"family":"readwrite"}}`, access.Rule{Other: access.None, Groups: map[string]string{"family": access.ReadWrite}}},
		{"not json closes the drive", `nonsense`, access.Rule{Other: access.None}},
		{"unknown level closes the drive", `{"other":"everything"}`, access.Rule{Other: access.None}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseClusterDriveRule([]byte(tt.raw)); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseClusterDriveRule() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
