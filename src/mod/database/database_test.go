package database

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

// openTestDB opens a database in a fresh temp dir and closes it at test end.
func openTestDB(t *testing.T, readOnly bool) *Database {
	t.Helper()
	d, err := NewDatabase(filepath.Join(t.TempDir(), "test.db"), readOnly)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(d.Close)
	return d
}

/*
	Open / Close / modes
*/

func TestNewDatabase(t *testing.T) {
	tests := []struct {
		name     string
		readOnly bool
	}{
		{"read write", false},
		{"read only", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := openTestDB(t, tc.readOnly)
			if d.ReadOnly != tc.readOnly {
				t.Errorf("ReadOnly = %v, want %v", d.ReadOnly, tc.readOnly)
			}
		})
	}
}

func TestNewDatabaseInvalidPath(t *testing.T) {
	if _, err := NewDatabase(filepath.Join(t.TempDir(), "missing", "test.db"), false); err == nil {
		t.Error("expected an error for a path inside a missing folder")
	}
}

func TestUpdateReadWriteMode(t *testing.T) {
	d := openTestDB(t, false)
	d.UpdateReadWriteMode(true)
	if !d.ReadOnly {
		t.Error("expected ReadOnly=true after UpdateReadWriteMode(true)")
	}
	d.UpdateReadWriteMode(false)
	if d.ReadOnly {
		t.Error("expected ReadOnly=false after UpdateReadWriteMode(false)")
	}
}

func TestReadOnlyRejectsWrites(t *testing.T) {
	d := openTestDB(t, false)
	if err := d.NewTable("t"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	if err := d.Write("t", "k", "v"); err != nil {
		t.Fatalf("Write: %v", err)
	}
	d.UpdateReadWriteMode(true)

	tests := []struct {
		name string
		op   func() error
	}{
		{"NewTable", func() error { return d.NewTable("blocked") }},
		{"DropTable", func() error { return d.DropTable("t") }},
		{"Write", func() error { return d.Write("t", "k", "new") }},
		{"Delete", func() error { return d.Delete("t", "k") }},
		{"WriteBatch", func() error { return d.WriteBatch([]BatchOp{{Table: "t", Key: "k", Value: 1}}) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.op(); err == nil {
				t.Errorf("%s should be rejected in read only mode", tc.name)
			}
		})
	}
	var v string
	if err := d.Read("t", "k", &v); err != nil || v != "v" {
		t.Errorf("stored value changed in read only mode: %q, %v", v, err)
	}
}

func TestPersistence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	d, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	d.NewTable("persist")
	d.Write("persist", "hello", "world")
	d.Close()

	d2, err := NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("NewDatabase (reopen): %v", err)
	}
	defer d2.Close()
	if !d2.TableExists("persist") {
		t.Error("table should exist after reopen")
	}
	var val string
	if err := d2.Read("persist", "hello", &val); err != nil || val != "world" {
		t.Errorf("Read after reopen = %q, %v; want world", val, err)
	}
}

/*
	Tables
*/

func TestNewTableAndDropTable(t *testing.T) {
	d := openTestDB(t, false)
	const table = "myTable"
	if d.TableExists(table) {
		t.Error("table should not exist before NewTable")
	}
	if err := d.NewTable(table); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	if !d.TableExists(table) {
		t.Error("table should exist after NewTable")
	}
	if err := d.DropTable(table); err != nil {
		t.Fatalf("DropTable: %v", err)
	}
	if d.TableExists(table) {
		t.Error("table should not exist after DropTable")
	}
}

/*
	Keys
*/

func TestWriteAndRead(t *testing.T) {
	type payload struct {
		Name  string
		Score int
	}
	d := openTestDB(t, false)
	d.NewTable("data")

	original := payload{Name: "bob", Score: 99}
	if err := d.Write("data", "user/bob", original); err != nil {
		t.Fatalf("Write: %v", err)
	}
	var result payload
	if err := d.Read("data", "user/bob", &result); err != nil {
		t.Fatalf("Read: %v", err)
	}
	if result != original {
		t.Errorf("Read = %+v, want %+v", result, original)
	}

	//A later write to the same key replaces the value
	d.Write("data", "k", "first")
	d.Write("data", "k", "second")
	var val string
	d.Read("data", "k", &val)
	if val != "second" {
		t.Errorf("overwritten value = %q, want second", val)
	}
}

func TestManyWrites(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("bulk")
	const n = 100
	for i := 0; i < n; i++ {
		value := map[string]interface{}{fmt.Sprintf("field_%d", i): fmt.Sprintf("value_%d", i)}
		if err := d.Write("bulk", fmt.Sprintf("key_%d", i), value); err != nil {
			t.Fatalf("Write %d: %v", i, err)
		}
	}
	for i := 0; i < n; i++ {
		var got map[string]interface{}
		if err := d.Read("bulk", fmt.Sprintf("key_%d", i), &got); err != nil {
			t.Fatalf("Read %d: %v", i, err)
		}
		if got[fmt.Sprintf("field_%d", i)] != fmt.Sprintf("value_%d", i) {
			t.Errorf("key_%d = %v", i, got)
		}
	}
	if rows, _ := d.ListTable("bulk"); len(rows) != n {
		t.Errorf("ListTable returned %d rows, want %d", len(rows), n)
	}
}

func TestKeyExistsAndDelete(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("keys")
	d.Write("keys", "present", "value")

	tests := []struct {
		name, table, key string
		want             bool
	}{
		{"present key", "keys", "present", true},
		{"missing key", "keys", "missing", false},
		{"missing table", "nosuchtable", "k", false},
	}
	for _, tc := range tests {
		if got := d.KeyExists(tc.table, tc.key); got != tc.want {
			t.Errorf("%s: KeyExists = %v, want %v", tc.name, got, tc.want)
		}
	}

	if err := d.Delete("keys", "present"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if d.KeyExists("keys", "present") {
		t.Error("key should not exist after Delete")
	}
}

/*
	Listing
*/

func TestListTable(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("empty")
	if entries, err := d.ListTable("empty"); err != nil || len(entries) != 0 {
		t.Errorf("empty table: %d entries, %v", len(entries), err)
	}

	d.NewTable("list")
	keys := []string{"alpha", "beta", "gamma"}
	for _, k := range keys {
		if err := d.Write("list", k, k+"-val"); err != nil {
			t.Fatalf("Write(%q): %v", k, err)
		}
	}
	entries, err := d.ListTable("list")
	if err != nil {
		t.Fatalf("ListTable: %v", err)
	}
	if len(entries) != len(keys) {
		t.Fatalf("got %d entries, want %d", len(entries), len(keys))
	}
	//Bolt keeps keys sorted, so the listing comes back in key order
	for i, k := range keys {
		if string(entries[i][0]) != k || string(entries[i][1]) != `"`+k+`-val"` {
			t.Errorf("entry %d = %s:%s, want %s", i, entries[i][0], entries[i][1], k)
		}
	}
}

func TestListTableWithPrefix(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("t")
	for _, k := range []string{"a/1", "a/2", "a", "b/1", "ab/1"} {
		if err := d.Write("t", k, k); err != nil {
			t.Fatalf("Write %s: %v", k, err)
		}
	}

	tests := []struct {
		prefix string
		want   []string
	}{
		{"a/", []string{"a/1", "a/2"}},
		{"a", []string{"a", "a/1", "a/2", "ab/1"}},
		{"b/", []string{"b/1"}},
		{"zzz", []string{}},
		{"", []string{"a", "a/1", "a/2", "ab/1", "b/1"}},
	}
	for _, tc := range tests {
		got, err := d.ListTableWithPrefix("t", tc.prefix)
		if err != nil {
			t.Fatalf("prefix %q: %v", tc.prefix, err)
		}
		if len(got) != len(tc.want) {
			t.Errorf("prefix %q: got %d entries want %d", tc.prefix, len(got), len(tc.want))
			continue
		}
		for i := range got {
			if string(got[i][0]) != tc.want[i] {
				t.Errorf("prefix %q: entry %d = %q want %q", tc.prefix, i, got[i][0], tc.want[i])
			}
			if string(got[i][1]) != `"`+tc.want[i]+`"` {
				t.Errorf("prefix %q: value %d = %s", tc.prefix, i, got[i][1])
			}
		}
	}
	if _, err := d.ListTableWithPrefix("missing", "a"); err == nil {
		t.Errorf("missing table should error")
	}
}

func TestDump(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("t1")
	d.Write("t1", "k1", "v1")
	d.Write("t1", "k2", "v2")

	lines, err := d.Dump("")
	if err != nil {
		t.Fatalf("Dump: %v", err)
	}
	if len(lines) != 2 || lines[0] != "k1:\"v1\"\n" {
		t.Errorf("Dump = %q", lines)
	}
}

/*
	Batches
*/

func TestWriteBatch(t *testing.T) {
	d := openTestDB(t, false)
	d.NewTable("existing")
	d.Write("existing", "gone", "old")

	err := d.WriteBatch([]BatchOp{
		{Table: "existing", Key: "a", Value: 1},
		{Table: "existing", Key: "gone", Delete: true},
		{Table: "created", Key: "b", Value: map[string]string{"x": "y"}},
		{Table: "existing", Key: "raw", Value: json.RawMessage(`{"n":2}`)},
		{Table: "existing", Key: "a", Value: 3}, //later op on the same key wins
	})
	if err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	tests := []struct {
		name  string
		table string
		key   string
		want  string //JSON of the stored value, "" when it must be absent
	}{
		{"put", "existing", "a", "3"},
		{"delete", "existing", "gone", ""},
		{"table is created", "created", "b", `{"x":"y"}`},
		{"raw JSON is stored as is", "existing", "raw", `{"n":2}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.want == "" {
				if d.KeyExists(tc.table, tc.key) {
					t.Errorf("%s/%s should not exist", tc.table, tc.key)
				}
				return
			}
			var got json.RawMessage
			if err := d.Read(tc.table, tc.key, &got); err != nil {
				t.Fatalf("Read: %v", err)
			}
			if string(got) != tc.want {
				t.Errorf("%s/%s = %s, want %s", tc.table, tc.key, got, tc.want)
			}
		})
	}
}

func TestWriteBatchEdgeCases(t *testing.T) {
	d := openTestDB(t, false)
	if err := d.WriteBatch(nil); err != nil {
		t.Errorf("an empty batch should be a no-op, got %v", err)
	}

	//A value that cannot be marshalled fails the batch before anything lands
	err := d.WriteBatch([]BatchOp{
		{Table: "t", Key: "first", Value: 1},
		{Table: "t", Key: "bad", Value: make(chan int)},
	})
	if err == nil {
		t.Fatalf("an unmarshallable value must fail the batch")
	}
	if d.KeyExists("t", "first") {
		t.Errorf("a failed batch must not write its other operations")
	}
}
