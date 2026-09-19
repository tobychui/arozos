package database

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func openBatchDB(t *testing.T) *Database {
	t.Helper()
	db, err := NewDatabase(filepath.Join(t.TempDir(), "batch.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestWriteBatch(t *testing.T) {
	db := openBatchDB(t)
	db.NewTable("existing")
	db.Write("existing", "gone", "old")

	err := db.WriteBatch([]BatchOp{
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
				if db.KeyExists(tc.table, tc.key) {
					t.Errorf("%s/%s should not exist", tc.table, tc.key)
				}
				return
			}
			var got json.RawMessage
			if err := db.Read(tc.table, tc.key, &got); err != nil {
				t.Fatalf("Read: %v", err)
			}
			if string(got) != tc.want {
				t.Errorf("%s/%s = %s, want %s", tc.table, tc.key, got, tc.want)
			}
		})
	}
}

func TestWriteBatchEdgeCases(t *testing.T) {
	db := openBatchDB(t)
	if err := db.WriteBatch(nil); err != nil {
		t.Errorf("an empty batch should be a no-op, got %v", err)
	}

	//A value that cannot be marshalled fails the batch before anything lands
	err := db.WriteBatch([]BatchOp{
		{Table: "t", Key: "first", Value: 1},
		{Table: "t", Key: "bad", Value: make(chan int)},
	})
	if err == nil {
		t.Fatalf("an unmarshallable value must fail the batch")
	}
	if db.KeyExists("t", "first") {
		t.Errorf("a failed batch must not write its other operations")
	}

	db.UpdateReadWriteMode(true)
	if err := db.WriteBatch([]BatchOp{{Table: "t", Key: "k", Value: 1}}); err == nil {
		t.Errorf("a read only database must reject a batch")
	}
}
