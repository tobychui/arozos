package access

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "storage.access.json")
	return NewStore(filename), filename
}

func TestStoreMissingFileIsEmpty(t *testing.T) {
	store, _ := newTestStore(t)
	if err := store.Err(); err != nil {
		t.Fatalf("Err() = %v", err)
	}
	if _, ok := store.Rule("media"); ok {
		t.Fatalf("an empty store reported a rule")
	}
}

func TestStoreSetSurvivesReopening(t *testing.T) {
	store, filename := newTestStore(t)
	want := Rule{Other: None, Groups: map[string]string{"family": ReadWrite, "guests": Read}}
	if err := store.Set("media", want); err != nil {
		t.Fatalf("Set() = %v", err)
	}

	reopened := NewStore(filename)
	if err := reopened.Err(); err != nil {
		t.Fatalf("Err() = %v", err)
	}
	got, ok := reopened.Rule("media")
	if !ok || !reflect.DeepEqual(got, want) {
		t.Fatalf("Rule() = %v, %v, want %v", got, ok, want)
	}
}

func TestStoreSetRefuses(t *testing.T) {
	store, _ := newTestStore(t)
	tests := []struct {
		name string
		uuid string
		rule Rule
	}{
		{"no drive", "", Rule{Other: Read}},
		{"home drive", UserDriveID, Rule{Other: None}},
		{"tmp drive", TmpDriveID, Rule{Other: None}},
		{"invalid rule", "media", Rule{Other: "writeonly"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := store.Set(tt.uuid, tt.rule); err == nil {
				t.Errorf("Set(%q) succeeded", tt.uuid)
			}
		})
	}
}

func TestStoreRuleIsACopy(t *testing.T) {
	store, _ := newTestStore(t)
	if err := store.Set("media", Rule{Other: None, Groups: map[string]string{"a": Read}}); err != nil {
		t.Fatalf("Set() = %v", err)
	}
	rule, _ := store.Rule("media")
	rule.Groups["a"] = ReadWrite

	again, _ := store.Rule("media")
	if again.Groups["a"] != Read {
		t.Fatalf("changing a returned rule changed the store: %v", again.Groups)
	}
}

func TestStoreRemove(t *testing.T) {
	store, filename := newTestStore(t)
	if err := store.Set("media", Rule{Other: None}); err != nil {
		t.Fatalf("Set() = %v", err)
	}
	if err := store.Remove("media"); err != nil {
		t.Fatalf("Remove() = %v", err)
	}
	if _, ok := store.Rule("media"); ok {
		t.Fatalf("the rule is still there")
	}
	if _, ok := NewStore(filename).Rule("media"); ok {
		t.Fatalf("the rule came back after reopening")
	}
	if err := store.Remove("never-set"); err != nil {
		t.Fatalf("Remove() of an unknown drive = %v", err)
	}
}

func TestStoreRemoveGroup(t *testing.T) {
	store, filename := newTestStore(t)
	for uuid, rule := range map[string]Rule{
		"media":  {Other: None, Groups: map[string]string{"family": ReadWrite, "guests": Read}},
		"photos": {Other: ReadWrite, Groups: map[string]string{"family": None}},
		"docs":   {Other: Read},
	} {
		if err := store.Set(uuid, rule); err != nil {
			t.Fatalf("Set(%q) = %v", uuid, err)
		}
	}

	if err := store.RemoveGroup("family"); err != nil {
		t.Fatalf("RemoveGroup() = %v", err)
	}

	reopened := NewStore(filename)
	media, _ := reopened.Rule("media")
	if !reflect.DeepEqual(media.Groups, map[string]string{"guests": Read}) {
		t.Errorf("media rows = %v", media.Groups)
	}
	photos, ok := reopened.Rule("photos")
	if !ok || len(photos.Groups) != 0 || photos.Other != ReadWrite {
		t.Errorf("photos = %+v, %v", photos, ok)
	}
}

/*
A rule file that cannot be read must not reopen what an admin closed, nor be
replaced by a write that would lose the rules still in it.
*/
func TestStoreUnreadableFile(t *testing.T) {
	tests := []struct {
		name    string
		content string
	}{
		{"not json", "{ this is not json"},
		{"a level that does not exist", `{"version":1,"drives":{"media":{"other":"everything"}}}`},
		{"written by a newer build", `{"version":99,"drives":{}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filename := filepath.Join(t.TempDir(), "storage.access.json")
			if err := os.WriteFile(filename, []byte(tt.content), 0644); err != nil {
				t.Fatalf("WriteFile() = %v", err)
			}

			store := NewStore(filename)
			if store.Err() == nil {
				t.Fatalf("Err() = nil")
			}
			rule, ok := store.Rule("anything")
			if !ok || rule.Other != None {
				t.Errorf("Rule() = %+v, %v, want None for every drive", rule, ok)
			}
			if err := store.Set("media", Rule{Other: ReadWrite}); err == nil {
				t.Errorf("Set() succeeded on an unreadable store")
			}
			content, _ := os.ReadFile(filename)
			if string(content) != tt.content {
				t.Errorf("the rule file was changed: %s", content)
			}
		})
	}
}

func TestStoreLeavesNoTemporaryFiles(t *testing.T) {
	store, filename := newTestStore(t)
	if err := store.Set("media", Rule{Other: Read}); err != nil {
		t.Fatalf("Set() = %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(filename))
	if err != nil {
		t.Fatalf("ReadDir() = %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected only the rule file, found %d entries", len(entries))
	}
}

func writeBridgeFile(t *testing.T, records []bridgeRecord) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "bridge.json")
	content, err := json.Marshal(records)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	if err := os.WriteFile(filename, content, 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	return filename
}

func TestMigrateBridges(t *testing.T) {
	homes := map[string]string{"photos": "family", "media": ""}
	homeOf := func(uuid string) (string, bool) {
		home, ok := homes[uuid]
		return home, ok
	}

	tests := []struct {
		name    string
		records []bridgeRecord
		uuid    string
		want    Rule
	}{
		{
			name:    "bridge into a group becomes a row",
			records: []bridgeRecord{{"photos", "guests"}},
			uuid:    "photos",
			want:    Rule{Other: None, Groups: map[string]string{"guests": ReadWrite}},
		},
		{
			name:    "bridges into two groups become two rows",
			records: []bridgeRecord{{"photos", "guests"}, {"photos", "staff"}},
			uuid:    "photos",
			want:    Rule{Other: None, Groups: map[string]string{"guests": ReadWrite, "staff": ReadWrite}},
		},
		{
			name:    "bridge into the system pool opens the drive to everyone",
			records: []bridgeRecord{{"photos", "system"}},
			uuid:    "photos",
			want:    Rule{Other: ReadWrite},
		},
		{
			name:    "a system drive bridged into a group stays open",
			records: []bridgeRecord{{"media", "guests"}},
			uuid:    "media",
			want:    Rule{Other: ReadWrite, Groups: map[string]string{"guests": ReadWrite}},
		},
		{
			name:    "an offline drive keeps its row and is not opened to others",
			records: []bridgeRecord{{"unplugged", "guests"}},
			uuid:    "unplugged",
			want:    Rule{Other: None, Groups: map[string]string{"guests": ReadWrite}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, _ := newTestStore(t)
			bridgeFile := writeBridgeFile(t, tt.records)

			count, err := store.MigrateBridges(bridgeFile, homeOf)
			if err != nil {
				t.Fatalf("MigrateBridges() = %v", err)
			}
			if count != len(tt.records) {
				t.Errorf("count = %d, want %d", count, len(tt.records))
			}
			got, ok := store.Rule(tt.uuid)
			if !ok || !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Rule() = %+v, %v, want %+v", got, ok, tt.want)
			}
		})
	}
}

func TestMigrateBridgesKeepsExistingRule(t *testing.T) {
	store, _ := newTestStore(t)
	if err := store.Set("photos", Rule{Other: Read, Groups: map[string]string{"staff": None}}); err != nil {
		t.Fatalf("Set() = %v", err)
	}
	bridgeFile := writeBridgeFile(t, []bridgeRecord{{"photos", "guests"}})

	if _, err := store.MigrateBridges(bridgeFile, func(string) (string, bool) { return "family", true }); err != nil {
		t.Fatalf("MigrateBridges() = %v", err)
	}
	got, _ := store.Rule("photos")
	want := Rule{Other: Read, Groups: map[string]string{"staff": None, "guests": ReadWrite}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Rule() = %+v, want %+v", got, want)
	}
}

func TestMigrateBridgesRunsOnce(t *testing.T) {
	store, _ := newTestStore(t)
	bridgeFile := writeBridgeFile(t, []bridgeRecord{{"photos", "guests"}})
	homeOf := func(string) (string, bool) { return "family", true }

	if _, err := store.MigrateBridges(bridgeFile, homeOf); err != nil {
		t.Fatalf("MigrateBridges() = %v", err)
	}
	if _, err := os.Stat(bridgeFile); !os.IsNotExist(err) {
		t.Errorf("the bridge file is still there: %v", err)
	}
	if _, err := os.Stat(bridgeFile + ".migrated"); err != nil {
		t.Errorf("no backup of the bridge file: %v", err)
	}

	count, err := store.MigrateBridges(bridgeFile, homeOf)
	if err != nil || count != 0 {
		t.Fatalf("second run = %d, %v, want nothing to do", count, err)
	}
}

func TestMigrateBridgesLeavesBuiltinDrivesAlone(t *testing.T) {
	store, _ := newTestStore(t)
	bridgeFile := writeBridgeFile(t, []bridgeRecord{{ClusterDriveID, "guests"}, {ShareDriveID, "guests"}, {UserDriveID, "guests"}})
	if _, err := store.MigrateBridges(bridgeFile, func(string) (string, bool) { return "", true }); err != nil {
		t.Fatalf("MigrateBridges() = %v", err)
	}
	for _, uuid := range []string{ClusterDriveID, ShareDriveID, UserDriveID} {
		if _, ok := store.Rule(uuid); ok {
			t.Errorf("%s got a rule", uuid)
		}
	}
}

func TestMigrateBridgesKeepsAnUnreadableFile(t *testing.T) {
	store, _ := newTestStore(t)
	filename := filepath.Join(t.TempDir(), "bridge.json")
	if err := os.WriteFile(filename, []byte("not json"), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	if _, err := store.MigrateBridges(filename, func(string) (string, bool) { return "", true }); err == nil {
		t.Fatalf("MigrateBridges() succeeded")
	}
	if _, err := os.Stat(filename); err != nil {
		t.Fatalf("the bridge file is gone: %v", err)
	}
}
