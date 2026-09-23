package database

import (
	"path/filepath"
	"testing"
)

func TestListTableWithPrefix(t *testing.T) {
	db, err := NewDatabase(filepath.Join(t.TempDir(), "prefix.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	defer db.Close()
	if err := db.NewTable("t"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	for _, k := range []string{"a/1", "a/2", "a", "b/1", "ab/1"} {
		if err := db.Write("t", k, k); err != nil {
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
		got, err := db.ListTableWithPrefix("t", tc.prefix)
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
			var v string
			if err := db.Read("t", string(got[i][0]), &v); err != nil || v != tc.want[i] {
				t.Errorf("value for %q not readable: %q %v", got[i][0], v, err)
			}
		}
	}
	if _, err := db.ListTableWithPrefix("missing", "a"); err == nil {
		t.Errorf("missing table should error")
	}
}
