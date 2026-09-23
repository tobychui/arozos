package database

import (
	"os"
	"path/filepath"
	"testing"

	"go.etcd.io/bbolt"
)

// writeLegacyEntry writes one key in the old fsdb layout.
func writeLegacyEntry(t *testing.T, legacyDir, table, fileKey, value string) {
	t.Helper()
	dir := filepath.Join(legacyDir, table)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, fileKey+legacyFsdbEntryExt), []byte(value), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}

func TestMigrateLegacyFsdb(t *testing.T) {
	t.Chdir(t.TempDir())

	dbfile := filepath.Join("system", "ao.db")
	if err := os.MkdirAll("system", 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	legacyDir := legacyFsdbPath(dbfile)
	writeLegacyEntry(t, legacyDir, "auth", "passhash-SLASH_SIGN-alice", `"hash"`)
	writeLegacyEntry(t, legacyDir, "auth", "user-SLASH_SIGN-bob", `{"n":1}`)
	if err := os.MkdirAll(filepath.Join(legacyDir, "empty"), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "empty", "ignored.txt"), []byte("x"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	writeLegacyEntry(t, legacyDir, "prefs", "theme", `"dark"`)

	db, err := NewDatabase(dbfile, false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}

	tests := []struct {
		table, key, want string
	}{
		{"auth", "passhash/alice", "hash"},
		{"prefs", "theme", "dark"},
	}
	for _, tc := range tests {
		var got string
		if err := db.Read(tc.table, tc.key, &got); err != nil || got != tc.want {
			t.Errorf("Read(%s, %s) = %q, %v; want %q", tc.table, tc.key, got, err, tc.want)
		}
	}
	var bob struct{ N int }
	if err := db.Read("auth", "user/bob", &bob); err != nil || bob.N != 1 {
		t.Errorf("slash key not restored: %+v, %v", bob, err)
	}
	if !db.TableExists("empty") {
		t.Errorf("table without entries should still be created")
	}
	if rows, _ := db.ListTable("empty"); len(rows) != 0 {
		t.Errorf("non-entry file imported: %v", rows)
	}
	db.Close()

	if _, err := os.Stat(legacyDir); !os.IsNotExist(err) {
		t.Errorf("legacy folder should be renamed, stat err = %v", err)
	}
	if _, err := os.Stat(legacyDir + ".migrated"); err != nil {
		t.Errorf("renamed legacy folder missing: %v", err)
	}
}

func TestImportLegacyFsdbKeepsExistingKeys(t *testing.T) {
	dbfile := filepath.Join(t.TempDir(), "keep.db")
	db, err := NewDatabase(dbfile, false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	defer db.Close()
	if err := db.Write("t", "k", "new"); err != nil {
		t.Fatalf("Write: %v", err)
	}

	legacyDir := filepath.Join(t.TempDir(), "legacy")
	writeLegacyEntry(t, legacyDir, "t", "k", `"old"`)
	writeLegacyEntry(t, legacyDir, "t", "k2", `"added"`)

	n, err := importLegacyFsdb(db.Db.(*bbolt.DB), legacyDir)
	if err != nil {
		t.Fatalf("importLegacyFsdb: %v", err)
	}
	if n != 1 {
		t.Errorf("imported %d keys, want 1", n)
	}
	var got string
	if err := db.Read("t", "k", &got); err != nil || got != "new" {
		t.Errorf("existing key overwritten: %q, %v", got, err)
	}
	if err := db.Read("t", "k2", &got); err != nil || got != "added" {
		t.Errorf("new key not imported: %q, %v", got, err)
	}
}

func TestMigrateLegacyFsdbNoFolder(t *testing.T) {
	dbfile := filepath.Join(t.TempDir(), "none.db")
	db, err := NewDatabase(dbfile, false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	defer db.Close()
	if err := migrateLegacyFsdb(db.Db.(*bbolt.DB), dbfile); err != nil {
		t.Errorf("migrate without legacy folder: %v", err)
	}
}
