package shareEntry

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool    { return &b }
func int64Ptr(i int64) *int64 { return &i }

// writeUserFile creates <root>/users/<username>/<name> so a "testfsh:/<name>"
// virtual path resolves for that user. It returns the virtual path.
func writeUserFile(t *testing.T, root, username, name string, isDir bool) string {
	t.Helper()
	target := filepath.Join(root, "users", username, name)
	if isDir {
		if err := os.MkdirAll(target, 0755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := os.WriteFile(target, []byte("hello"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}
	return "testfsh:/" + name
}

func TestDefaultShareOption(t *testing.T) {
	so := DefaultShareOption()
	if so.Permission != PermissionAnyone {
		t.Errorf("Permission = %q, want %q", so.Permission, PermissionAnyone)
	}
	if so.AccessLevel != AccessLevelView {
		t.Errorf("AccessLevel = %q, want %q", so.AccessLevel, AccessLevelView)
	}
	if !so.AllowDownload || !so.ShowFileList {
		t.Error("default share should allow download and show the file list")
	}
	if so.HasPassword() || so.ExpireAt != 0 {
		t.Error("default share should have no password and no expiry")
	}
}

func TestShareOption_Migrate(t *testing.T) {
	legacy := &ShareOption{UUID: "u", PathHash: "p", Permission: PermissionSignedIn}
	if !legacy.migrate() {
		t.Fatal("legacy share should be migrated")
	}
	if !legacy.AllowDownload || !legacy.ShowFileList || legacy.AccessLevel != AccessLevelView {
		t.Errorf("legacy share should keep its old behaviour, got %+v", legacy)
	}
	if legacy.Permission != PermissionSignedIn {
		t.Errorf("migration must not change the permission, got %q", legacy.Permission)
	}
	if legacy.migrate() {
		t.Error("an up to date share should not be migrated again")
	}

	//A current share that disabled download must stay disabled
	current := DefaultShareOption()
	current.AllowDownload = false
	if current.migrate() || current.AllowDownload {
		t.Error("migration must not touch a current share")
	}
}

func TestShareOption_IsExpired(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	tests := []struct {
		name     string
		expireAt int64
		want     bool
	}{
		{"never", 0, false},
		{"future", now.Unix() + 60, false},
		{"exactly now", now.Unix(), true},
		{"past", now.Unix() - 60, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			so := &ShareOption{ExpireAt: tc.expireAt}
			if got := so.IsExpired(now); got != tc.want {
				t.Errorf("IsExpired() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestShareOption_Password(t *testing.T) {
	so := DefaultShareOption()
	if !so.CheckPassword("anything") {
		t.Error("a share without password should accept any password")
	}
	if err := so.SetPassword("s3cret"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	if !so.HasPassword() {
		t.Fatal("HasPassword should be true after SetPassword")
	}
	if so.PasswordHash == "s3cret" {
		t.Fatal("password must not be stored in plain text")
	}
	if !so.CheckPassword("s3cret") {
		t.Error("correct password rejected")
	}
	if so.CheckPassword("wrong") || so.CheckPassword("") {
		t.Error("wrong password accepted")
	}
	if err := so.SetPassword(""); err != nil {
		t.Fatalf("SetPassword(\"\"): %v", err)
	}
	if so.HasPassword() {
		t.Error("empty password should remove the protection")
	}

	tooLong := make([]byte, maxPasswordLength+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}
	if err := so.SetPassword(string(tooLong)); err == nil {
		t.Error("expected an error for a password over the bcrypt limit")
	}
}

func TestShareOption_Apply(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	tests := []struct {
		name     string
		isFolder bool
		settings ShareSettings
		wantErr  bool
		check    func(t *testing.T, so *ShareOption)
	}{
		{
			name:     "users with list",
			settings: ShareSettings{Permission: strPtr(PermissionUsers), Accessibles: []string{" alice ", "bob", "alice", ""}},
			check: func(t *testing.T, so *ShareOption) {
				if so.Permission != PermissionUsers || len(so.Accessibles) != 2 {
					t.Errorf("got %q %v, want users [alice bob]", so.Permission, so.Accessibles)
				}
			},
		},
		{
			name:     "users without list",
			settings: ShareSettings{Permission: strPtr(PermissionUsers)},
			wantErr:  true,
		},
		{
			name:     "anyone clears list",
			settings: ShareSettings{Permission: strPtr(PermissionAnyone), Accessibles: []string{"x"}},
			check: func(t *testing.T, so *ShareOption) {
				if len(so.Accessibles) != 0 {
					t.Errorf("Accessibles = %v, want empty", so.Accessibles)
				}
			},
		},
		{
			name:     "unknown permission",
			settings: ShareSettings{Permission: strPtr("everyone")},
			wantErr:  true,
		},
		{
			name:     "edit on file",
			settings: ShareSettings{AccessLevel: strPtr(AccessLevelEdit)},
			wantErr:  true,
		},
		{
			name:     "edit on folder",
			isFolder: true,
			settings: ShareSettings{AccessLevel: strPtr(AccessLevelEdit)},
			check: func(t *testing.T, so *ShareOption) {
				if !so.CanUpload() {
					t.Error("edit folder share should allow upload")
				}
			},
		},
		{
			name:     "unknown access level",
			settings: ShareSettings{AccessLevel: strPtr("admin")},
			wantErr:  true,
		},
		{
			name:     "expiry in the past",
			settings: ShareSettings{ExpireAt: int64Ptr(now.Unix() - 1)},
			wantErr:  true,
		},
		{
			name:     "expiry in the future",
			settings: ShareSettings{ExpireAt: int64Ptr(now.Unix() + 3600)},
			check: func(t *testing.T, so *ShareOption) {
				if so.ExpireAt != now.Unix()+3600 {
					t.Errorf("ExpireAt = %d", so.ExpireAt)
				}
			},
		},
		{
			name:     "flags and password",
			settings: ShareSettings{AllowDownload: boolPtr(false), ShowFileList: boolPtr(false), Password: strPtr("pw")},
			check: func(t *testing.T, so *ShareOption) {
				if so.AllowDownload || so.ShowFileList || !so.CheckPassword("pw") || so.CheckPassword("nope") {
					t.Errorf("flags or password not applied: %+v", so)
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			so := DefaultShareOption()
			so.IsFolder = tc.isFolder
			before := *so
			err := so.Apply(tc.settings, now)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				if so.Permission != before.Permission || so.AccessLevel != before.AccessLevel || so.ExpireAt != before.ExpireAt {
					t.Error("a failed Apply must leave the share untouched")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.check != nil {
				tc.check(t, so)
			}
		})
	}
}

func TestCreateShare_MultipleSharesOnOnePath(t *testing.T) {
	fsh, root := newTestFSH(t)
	vpath := writeUserFile(t, root, "alice", "report.pdf", false)
	table := newTestTable(t)

	first, err := table.CreateShare(fsh, vpath, "alice", ShareSettings{})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	second, err := table.CreateShare(fsh, vpath, "alice", ShareSettings{Password: strPtr("pw")})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if first.UUID == second.UUID {
		t.Fatal("CreateShare should always create a new share")
	}

	shares := table.GetSharesFromPathHash(first.PathHash)
	if len(shares) != 2 {
		t.Fatalf("got %d shares on the path, want 2", len(shares))
	}
	if !shares[1].HasPassword() {
		t.Error("second share should be password protected")
	}

	//The legacy get-or-create entry point returns the first share
	legacy, err := table.CreateNewShare(fsh, vpath, "alice", nil)
	if err != nil {
		t.Fatalf("CreateNewShare: %v", err)
	}
	if legacy.UUID != first.UUID {
		t.Errorf("CreateNewShare returned %q, want the first share %q", legacy.UUID, first.UUID)
	}

	//Removing one share keeps the other
	if err := table.DeleteShareByUUID(first.UUID); err != nil {
		t.Fatalf("DeleteShareByUUID: %v", err)
	}
	if !table.FileIsShared(first.PathHash) {
		t.Error("path should still be shared by the second share")
	}
	if err := table.DeleteShareByPathHash(first.PathHash); err != nil {
		t.Fatalf("DeleteShareByPathHash: %v", err)
	}
	if table.FileIsShared(first.PathHash) || table.GetShareObjectFromUUID(second.UUID) != nil {
		t.Error("deleting by path hash should remove every share on the path")
	}
}

func TestCreateShare_InvalidSettings(t *testing.T) {
	fsh, root := newTestFSH(t)
	vpath := writeUserFile(t, root, "alice", "notes.txt", false)
	table := newTestTable(t)

	if _, err := table.CreateShare(fsh, vpath, "alice", ShareSettings{AccessLevel: strPtr(AccessLevelEdit)}); err == nil {
		t.Fatal("expected an error for edit access on a file")
	}
	if len(table.ListAllShares()) != 0 {
		t.Error("an invalid share must not be stored")
	}
}

func TestUpdateShare(t *testing.T) {
	fsh, root := newTestFSH(t)
	vpath := writeUserFile(t, root, "alice", "album", true)
	table := newTestTable(t)

	so, err := table.CreateShare(fsh, vpath, "alice", ShareSettings{})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if !so.IsFolder {
		t.Fatal("share of a directory should be a folder share")
	}

	updated, err := table.UpdateShare(so.UUID, ShareSettings{AccessLevel: strPtr(AccessLevelEdit), AllowDownload: boolPtr(false)})
	if err != nil {
		t.Fatalf("UpdateShare: %v", err)
	}
	if !updated.CanUpload() || updated.AllowDownload {
		t.Errorf("update not applied: %+v", updated)
	}

	//The change survives a reload from the database
	reloaded := NewShareEntryTable(table.Database).GetShareObjectFromUUID(so.UUID)
	if reloaded == nil || !reloaded.CanUpload() || reloaded.AllowDownload {
		t.Errorf("update not persisted: %+v", reloaded)
	}

	if _, err := table.UpdateShare(so.UUID, ShareSettings{Permission: strPtr("bogus")}); err == nil {
		t.Error("expected an error for an invalid update")
	}
	if _, err := table.UpdateShare("missing", ShareSettings{}); err == nil {
		t.Error("expected an error for an unknown share")
	}
}

func TestGetters_ReturnCopies(t *testing.T) {
	table := newTestTable(t)
	insertShareOption(table, makeShareOption("uuid-copy", "hash-copy", "alice"))

	got := table.GetShareObjectFromUUID("uuid-copy")
	got.Permission = PermissionUsers
	got.Accessibles = append(got.Accessibles, "mallory")

	again := table.GetShareObjectFromUUID("uuid-copy")
	if again.Permission != PermissionAnyone || len(again.Accessibles) != 0 {
		t.Errorf("mutating a returned share leaked into the table: %+v", again)
	}
}

func TestRemoveExpiredShares(t *testing.T) {
	table := newTestTable(t)
	now := time.Unix(2_000_000, 0)

	expired := makeShareOption("uuid-old", "hash-a", "alice")
	expired.ExpireAt = now.Unix() - 10
	active := makeShareOption("uuid-new", "hash-a", "alice")
	active.ExpireAt = now.Unix() + 10
	forever := makeShareOption("uuid-forever", "hash-b", "alice")
	for _, so := range []*ShareOption{expired, active, forever} {
		if err := table.AddShare(so); err != nil {
			t.Fatalf("AddShare: %v", err)
		}
	}

	removed := table.RemoveExpiredShares(now)
	if len(removed) != 1 || removed[0].UUID != "uuid-old" {
		t.Fatalf("removed = %v, want only uuid-old", removed)
	}
	if table.GetShareObjectFromUUID("uuid-old") != nil {
		t.Error("expired share should be gone")
	}
	if table.GetShareObjectFromUUID("uuid-new") == nil || table.GetShareObjectFromUUID("uuid-forever") == nil {
		t.Error("active shares must be kept")
	}
	if len(NewShareEntryTable(table.Database).ListAllShares()) != 2 {
		t.Error("expired share should also be removed from the database")
	}
}

func TestFileIsShared_IgnoresExpired(t *testing.T) {
	table := newTestTable(t)
	so := makeShareOption("uuid-exp", "hash-exp", "alice")
	so.ExpireAt = time.Now().Unix() - 1
	insertShareOption(table, so)

	if table.FileIsShared("hash-exp") {
		t.Error("a path with only expired shares should not count as shared")
	}
}
