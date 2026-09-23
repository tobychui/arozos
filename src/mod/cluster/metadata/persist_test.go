package metadata

import (
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/database"
)

func persistDB(t *testing.T) *database.Database {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "persist.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(db.Close)
	db.NewTable("t")
	return db
}

func readInt(t *testing.T, db *database.Database, key string) (int, bool) {
	t.Helper()
	if !db.KeyExists("t", key) {
		return 0, false
	}
	var v int
	if err := db.Read("t", key, &v); err != nil {
		t.Fatalf("Read(%s): %v", key, err)
	}
	return v, true
}

func TestPersisterWritesBehind(t *testing.T) {
	db := persistDB(t)
	p := newPersister(db)
	defer p.close()

	p.put("t", "a", 1)
	p.put("t", "a", 2) //coalesced: only the newest value is written
	p.put("t", "b", 1)
	p.del("t", "b") //a put then a delete of one key is just a delete
	if p.pending() != 2 {
		t.Errorf("two keys should be queued, got %d", p.pending())
	}
	p.flush()
	if p.pending() != 0 {
		t.Errorf("flush should empty the queue, %d left", p.pending())
	}
	if v, ok := readInt(t, db, "a"); !ok || v != 2 {
		t.Errorf("a = %v (%v), want 2", v, ok)
	}
	if db.KeyExists("t", "b") {
		t.Errorf("b should have been deleted")
	}

	//The background writer commits without an explicit flush
	p.put("t", "c", 3)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := readInt(t, db, "c"); ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("the background writer never committed c")
}

func TestPersisterCapturesValueAtPut(t *testing.T) {
	db := persistDB(t)
	p := newPersister(db)
	defer p.close()
	v := map[string]int{"n": 1}
	p.put("t", "m", v)
	v["n"] = 99 //changing the caller's copy afterwards must not leak into the write
	p.flush()
	var got map[string]int
	db.Read("t", "m", &got)
	if got["n"] != 1 {
		t.Errorf("stored %v, want the value as it was at put", got)
	}
}

func TestPersisterCloseAndDiscard(t *testing.T) {
	tests := []struct {
		name      string
		finish    func(p *persister)
		wantSaved bool
	}{
		{"close commits what is queued", func(p *persister) { p.close() }, true},
		{"discard drops what is queued", func(p *persister) { p.discard() }, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db := persistDB(t)
			old := FlushInterval
			FlushInterval = time.Hour //keep the background writer out of the way
			p := newPersister(db)
			FlushInterval = old

			p.put("t", "k", 7)
			tc.finish(p)
			if _, ok := readInt(t, db, "k"); ok != tc.wantSaved {
				t.Errorf("saved = %v, want %v", ok, tc.wantSaved)
			}
			//After either, further changes are ignored and both calls are safe to repeat
			p.put("t", "late", 1)
			p.close()
			p.discard()
			if db.KeyExists("t", "late") {
				t.Errorf("a stopped persister must not write")
			}
		})
	}
}

func TestPersisterRetriesAFailedWrite(t *testing.T) {
	db := persistDB(t)
	p := newPersister(db)
	defer p.close()

	db.UpdateReadWriteMode(true) //every write fails
	p.put("t", "r", 1)
	p.flush()
	if p.pending() != 1 {
		t.Fatalf("a failed write must stay queued, %d queued", p.pending())
	}
	db.UpdateReadWriteMode(false)
	p.flush()
	if v, ok := readInt(t, db, "r"); !ok || v != 1 {
		t.Errorf("the retried write did not land: %v %v", v, ok)
	}
}

func TestPersisterConcurrentPuts(t *testing.T) {
	db := persistDB(t)
	p := newPersister(db)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			js, _ := json.Marshal(i)
			p.put("t", string(rune('a'+i%26))+string(js), i)
		}(i)
	}
	wg.Wait()
	p.close()
	rows, err := db.ListTable("t")
	if err != nil {
		t.Fatalf("ListTable: %v", err)
	}
	if len(rows) != 50 {
		t.Errorf("want 50 rows after close, got %d", len(rows))
	}
}
