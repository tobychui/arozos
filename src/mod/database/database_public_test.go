//go:build !mipsle && !riscv64
// +build !mipsle,!riscv64

package database

import (
	"os"
	"path/filepath"
	"testing"
)

// createTempDB creates a temporary bolt database and returns the path and a
// cleanup function. The caller must defer the cleanup.
func createTempDB(t *testing.T) (string, func()) {
	t.Helper()
	dir, err := os.MkdirTemp("", "arozos-db-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(dir, "test.db")
	cleanup := func() { os.RemoveAll(dir) }
	return dbPath, cleanup
}

// --- NewDatabase ---

func TestNewDatabase_CreatesDatabase(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase returned error: %v", err)
	}
	defer d.Close()

	if d == nil {
		t.Fatal("expected non-nil Database")
	}
}

func TestNewDatabase_ReadOnlyFlag(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, true)
	if err != nil {
		t.Fatalf("NewDatabase returned error: %v", err)
	}
	defer d.Close()

	if !d.ReadOnly {
		t.Error("expected ReadOnly=true")
	}
}

func TestNewDatabase_InvalidPath(t *testing.T) {
	_, err := NewDatabase("/nonexistent/dir/test.db", false)
	if err == nil {
		t.Error("expected error for invalid path, got nil")
	}
}

// --- UpdateReadWriteMode ---

func TestUpdateReadWriteMode(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	if d.ReadOnly {
		t.Error("expected ReadOnly=false initially")
	}

	d.UpdateReadWriteMode(true)
	if !d.ReadOnly {
		t.Error("expected ReadOnly=true after UpdateReadWriteMode(true)")
	}

	d.UpdateReadWriteMode(false)
	if d.ReadOnly {
		t.Error("expected ReadOnly=false after UpdateReadWriteMode(false)")
	}
}

// --- NewTable / TableExists ---

func TestNewTable_And_TableExists(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "myTable"

	// Before creation the table must not exist
	if d.TableExists(table) {
		t.Error("table should not exist before NewTable")
	}

	if err := d.NewTable(table); err != nil {
		t.Fatalf("NewTable error: %v", err)
	}

	if !d.TableExists(table) {
		t.Error("table should exist after NewTable")
	}
}

func TestNewTable_ReadOnlyRejected(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, true)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	if err := d.NewTable("blocked"); err == nil {
		t.Error("expected error creating table in read-only mode")
	}
}

// --- DropTable ---

func TestDropTable(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "dropMe"
	if err := d.NewTable(table); err != nil {
		t.Fatalf("NewTable error: %v", err)
	}

	if err := d.DropTable(table); err != nil {
		t.Fatalf("DropTable error: %v", err)
	}

	if d.TableExists(table) {
		t.Error("table should not exist after DropTable")
	}
}

func TestDropTable_ReadOnlyRejected(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	// Create the table in read-write mode first
	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	if err := d.NewTable("protected"); err != nil {
		t.Fatalf("NewTable error: %v", err)
	}
	d.Close()

	// Reopen in read-only mode
	d2, err := NewDatabase(dbPath, true)
	if err != nil {
		t.Fatalf("NewDatabase (ro) error: %v", err)
	}
	defer d2.Close()

	if err := d2.DropTable("protected"); err == nil {
		t.Error("expected error dropping table in read-only mode")
	}
}

// --- Write / Read ---

func TestWrite_And_Read(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "data"
	if err := d.NewTable(table); err != nil {
		t.Fatalf("NewTable error: %v", err)
	}

	type payload struct {
		Name  string
		Score int
	}

	original := payload{Name: "bob", Score: 99}
	if err := d.Write(table, "user/bob", original); err != nil {
		t.Fatalf("Write error: %v", err)
	}

	var result payload
	if err := d.Read(table, "user/bob", &result); err != nil {
		t.Fatalf("Read error: %v", err)
	}

	if result.Name != original.Name || result.Score != original.Score {
		t.Errorf("expected %+v, got %+v", original, result)
	}
}

func TestWrite_OverwritesExistingKey(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "overwrite"
	d.NewTable(table)

	d.Write(table, "k", "first")
	d.Write(table, "k", "second")

	var val string
	d.Read(table, "k", &val)
	if val != "second" {
		t.Errorf("expected 'second', got %q", val)
	}
}

func TestWrite_ReadOnlyRejected(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, true)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	if err := d.Write("t", "k", "v"); err == nil {
		t.Error("expected error writing in read-only mode")
	}
}

// --- KeyExists ---

func TestKeyExists(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "keytest"
	d.NewTable(table)

	if d.KeyExists(table, "missing") {
		t.Error("expected KeyExists=false for non-existent key")
	}

	d.Write(table, "present", "value")

	if !d.KeyExists(table, "present") {
		t.Error("expected KeyExists=true after Write")
	}

	// Non-existent table
	if d.KeyExists("nosuchtable", "k") {
		t.Error("expected KeyExists=false for non-existent table")
	}
}

// --- Delete ---

func TestDelete(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "deltest"
	d.NewTable(table)
	d.Write(table, "bye", "seeya")

	if !d.KeyExists(table, "bye") {
		t.Fatal("key should exist before Delete")
	}

	if err := d.Delete(table, "bye"); err != nil {
		t.Fatalf("Delete error: %v", err)
	}

	if d.KeyExists(table, "bye") {
		t.Error("key should not exist after Delete")
	}
}

func TestDelete_ReadOnlyRejected(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, true)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	if err := d.Delete("t", "k"); err == nil {
		t.Error("expected error deleting in read-only mode")
	}
}

// --- ListTable ---

func TestListTable(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	const table = "listtest"
	d.NewTable(table)

	keys := []string{"alpha", "beta", "gamma"}
	for _, k := range keys {
		if err := d.Write(table, k, k+"-val"); err != nil {
			t.Fatalf("Write(%q) error: %v", k, err)
		}
	}

	entries, err := d.ListTable(table)
	if err != nil {
		t.Fatalf("ListTable error: %v", err)
	}

	if len(entries) != len(keys) {
		t.Errorf("expected %d entries, got %d", len(keys), len(entries))
	}

	// Collect returned keys for verification
	returnedKeys := map[string]bool{}
	for _, kv := range entries {
		returnedKeys[string(kv[0])] = true
	}
	for _, k := range keys {
		if !returnedKeys[k] {
			t.Errorf("key %q missing from ListTable result", k)
		}
	}
}

func TestListTable_EmptyTable(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	d.NewTable("empty")
	entries, err := d.ListTable("empty")
	if err != nil {
		t.Fatalf("ListTable error: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries for empty table, got %d", len(entries))
	}
}

// --- Dump ---

func TestDump(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	defer d.Close()

	d.NewTable("t1")
	d.Write("t1", "k1", "v1")
	d.Write("t1", "k2", "v2")

	lines, err := d.Dump("")
	if err != nil {
		t.Fatalf("Dump error: %v", err)
	}

	if len(lines) == 0 {
		t.Error("expected at least one line from Dump")
	}
}

// --- Close ---

func TestClose(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	// Close should not panic
	d.Close()
}

// --- Persistence: data survives close/reopen ---

func TestPersistence(t *testing.T) {
	dbPath, cleanup := createTempDB(t)
	defer cleanup()

	// Write data and close
	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase error: %v", err)
	}
	d.NewTable("persist")
	d.Write("persist", "hello", "world")
	d.Close()

	// Reopen and verify
	d2, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase (reopen) error: %v", err)
	}
	defer d2.Close()

	if !d2.TableExists("persist") {
		t.Error("table 'persist' should exist after reopen")
	}

	var val string
	if err := d2.Read("persist", "hello", &val); err != nil {
		t.Fatalf("Read after reopen error: %v", err)
	}
	if val != "world" {
		t.Errorf("expected 'world', got %q", val)
	}
}
