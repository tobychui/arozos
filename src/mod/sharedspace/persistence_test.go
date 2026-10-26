package sharedspace

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/database"
)

// persistenceEnv keeps the shared db file + roots so a "restart" can be
// simulated by building a second manager over the same state.
type persistenceEnv struct {
	dbfile      string
	ephemeral   string
	persistRoot string
}

func newPersistenceEnv(t *testing.T) *persistenceEnv {
	t.Helper()
	if raceDetectorEnabled {
		t.Skip("boltdb v1.3.1 trips checkptr under -race; run without -race to cover persistence")
	}
	base := t.TempDir()
	return &persistenceEnv{
		dbfile:      filepath.Join(base, "test.db"),
		ephemeral:   filepath.Join(base, "ephemeral"),
		persistRoot: filepath.Join(base, "persist"),
	}
}

// open builds a manager over the environment, closing the db at test end.
func (env *persistenceEnv) open(t *testing.T) (*Manager, *database.Database) {
	t.Helper()
	db, err := database.NewDatabase(env.dbfile, false)
	if err != nil {
		t.Fatalf("NewDatabase() error = %v", err)
	}
	m := NewManagerWithOptions(ManagerOptions{
		EphemeralRoot:  env.ephemeral,
		PersistentRoot: env.persistRoot,
		Database:       db,
	})
	return m, db
}

func TestPersistenceRoundTrip(t *testing.T) {
	env := newPersistenceEnv(t)
	m1, db1 := env.open(t)

	//Build a persistent space with the full feature surface
	space, err := m1.CreateSpaceWithOptions("alice", "Team chat", SpaceOptions{
		Access:     AccessPrivate,
		Persistent: true,
		Metadata:   map[string]string{"purpose": "chat"},
	})
	if err != nil {
		t.Fatalf("CreateSpaceWithOptions() error = %v", err)
	}
	space.AddMember("alice", "bob", RoleAdmin)
	space.SetMeta("alice", "topic", "launch")

	textItem, err := space.AddText("alice", "first message", "test")
	if err != nil {
		t.Fatalf("AddText() error = %v", err)
	}
	blobItem, err := space.SaveBlob(ItemTypeImage, "pic.png", "bob", "test", strings.NewReader("png-bytes"), 1024)
	if err != nil {
		t.Fatalf("SaveBlob() error = %v", err)
	}

	doc, err := space.CreateDoc("alice", "spec")
	if err != nil {
		t.Fatalf("CreateDoc() error = %v", err)
	}
	space.UpdateDoc("alice", doc.ID, 1, "v2")
	space.UpdateDoc("bob", doc.ID, 2, "v2 final")

	//An ephemeral space must NOT survive
	ephemeralSpace := m1.CreateSpace("alice", "throwaway")
	ephemeralSpace.AddText("alice", "gone after restart", "test")

	//Simulate a restart
	db1.Close()
	m2, db2 := env.open(t)
	defer db2.Close()

	if _, ok := m2.GetSpace(ephemeralSpace.ID); ok {
		t.Errorf("ephemeral space survived the restart")
	}
	restored, ok := m2.GetSpace(space.ID)
	if !ok {
		t.Fatalf("persistent space did not survive the restart")
	}

	//Space-level state
	if restored.Name != "Team chat" || restored.Owner != "alice" || !restored.Persistent {
		t.Errorf("restored space = %+v", restored)
	}
	if restored.AccessMode() != AccessPrivate {
		t.Errorf("restored access = %q, want private", restored.AccessMode())
	}
	if role, _ := restored.Role("bob"); role != RoleAdmin {
		t.Errorf("restored bob role = %q, want admin", role)
	}
	meta := restored.Metadata()
	if meta["purpose"] != "chat" || meta["topic"] != "launch" {
		t.Errorf("restored metadata = %v", meta)
	}

	//Items: order, content and blob bytes
	items := restored.Items()
	if len(items) != 2 {
		t.Fatalf("restored %d items, want 2", len(items))
	}
	if items[0].ID != textItem.ID || items[0].Text != "first message" {
		t.Errorf("first restored item = %+v", items[0])
	}
	if items[1].ID != blobItem.ID || items[1].Type != ItemTypeImage {
		t.Errorf("second restored item = %+v", items[1])
	}
	blobBytes, err := os.ReadFile(items[1].DiskPath)
	if err != nil || !bytes.Equal(blobBytes, []byte("png-bytes")) {
		t.Errorf("restored blob = %q, err = %v", blobBytes, err)
	}

	//New posts continue the sequence after the restored ones
	newItem, err := restored.AddText("bob", "after restart", "test")
	if err != nil {
		t.Fatalf("AddText() after restore error = %v", err)
	}
	if newItem.Seq <= items[1].Seq {
		t.Errorf("post-restart Seq %d not after restored max %d", newItem.Seq, items[1].Seq)
	}

	//Documents: content, revision and CAS across the restart
	restoredDoc, ok := restored.GetDoc(doc.ID)
	if !ok {
		t.Fatalf("document did not survive the restart")
	}
	if restoredDoc.Content != "v2 final" || restoredDoc.Revision != 3 || restoredDoc.UpdatedBy != "bob" {
		t.Errorf("restored doc = %+v", restoredDoc)
	}
	if _, err := restored.UpdateDoc("alice", doc.ID, 1, "stale"); err != ErrRevisionConflict {
		t.Errorf("stale update after restart error = %v, want ErrRevisionConflict", err)
	}
	if _, err := restored.UpdateDoc("alice", doc.ID, 3, "v3"); err != nil {
		t.Errorf("valid update after restart error = %v", err)
	}
}

func TestPersistentDeletionCleansDatabase(t *testing.T) {
	env := newPersistenceEnv(t)
	m1, db1 := env.open(t)

	space, _ := m1.CreateSpaceWithOptions("alice", "Doomed", SpaceOptions{Persistent: true})
	space.AddText("alice", "message", "test")
	blob, _ := space.SaveBlob(ItemTypeFile, "f.bin", "alice", "test", strings.NewReader("data"), 1024)
	doc, _ := space.CreateDoc("alice", "doc")
	_ = doc

	removedItemID := blob.ID
	space.RemoveItem(removedItemID, "alice")
	if db1.KeyExists(dbTableItems, space.ID+"/"+removedItemID) {
		t.Errorf("removed item record still in database")
	}

	m1.DeleteSpace(space.ID)
	if db1.KeyExists(dbTableSpaces, dbSpaceKeyPrefix+space.ID) {
		t.Errorf("space record still in database after DeleteSpace")
	}

	//After a restart nothing comes back
	db1.Close()
	m2, db2 := env.open(t)
	defer db2.Close()
	if m2.SpaceCount() != 0 {
		t.Errorf("deleted space resurrected: %d spaces", m2.SpaceCount())
	}
}

func TestReloadSelfHealing(t *testing.T) {
	env := newPersistenceEnv(t)
	m1, db1 := env.open(t)

	space, _ := m1.CreateSpaceWithOptions("alice", "Healing", SpaceOptions{Persistent: true})
	blob, _ := space.SaveBlob(ItemTypeFile, "f.bin", "alice", "test", strings.NewReader("data"), 1024)
	keeper, _ := space.AddText("alice", "keeper", "test")

	//Sabotage: blob file vanishes, an orphan item record points at a dead
	//space, and an orphan blob directory has no space
	os.Remove(blob.DiskPath)
	db1.Write(dbTableItems, "deadspace/deaditem", &itemRecord{ID: "deaditem", Type: ItemTypeText, Text: "orphan"})
	orphanDir := filepath.Join(env.persistRoot, "0000deadbeef0000")
	os.MkdirAll(orphanDir, 0755)

	db1.Close()
	m2, db2 := env.open(t)
	defer db2.Close()

	restored, ok := m2.GetSpace(space.ID)
	if !ok {
		t.Fatalf("space did not survive")
	}
	items := restored.Items()
	if len(items) != 1 || items[0].ID != keeper.ID {
		t.Errorf("restored items = %d, want only the keeper", len(items))
	}
	if db2.KeyExists(dbTableItems, space.ID+"/"+blob.ID) {
		t.Errorf("missing-blob item record not self-healed")
	}
	if db2.KeyExists(dbTableItems, "deadspace/deaditem") {
		t.Errorf("orphan item record not self-healed")
	}
	if _, err := os.Stat(orphanDir); !os.IsNotExist(err) {
		t.Errorf("orphan blob directory not removed")
	}
}

func TestPersistentTrimAtCap(t *testing.T) {
	env := newPersistenceEnv(t)
	m, db := env.open(t)
	defer db.Close()

	space, _ := m.CreateSpaceWithOptions("alice", "Trim", SpaceOptions{Persistent: true, MaxItems: 3})
	first, _ := space.AddText("alice", "one", "test")
	space.AddText("alice", "two", "test")
	space.AddText("alice", "three", "test")

	//Persistent spaces trim the oldest instead of failing
	fourth, err := space.AddText("alice", "four", "test")
	if err != nil {
		t.Fatalf("AddText at cap error = %v (persistent spaces must trim)", err)
	}
	if space.ItemCount() != 3 {
		t.Errorf("ItemCount() = %d, want 3", space.ItemCount())
	}
	if _, ok := space.GetItem(first.ID); ok {
		t.Errorf("oldest item still present after trim")
	}
	if db.KeyExists(dbTableItems, space.ID+"/"+first.ID) {
		t.Errorf("trimmed item record still in database")
	}
	if _, ok := space.GetItem(fourth.ID); !ok {
		t.Errorf("newest item missing after trim")
	}
}

func TestPersistenceToggle(t *testing.T) {
	env := newPersistenceEnv(t)
	m, db := env.open(t)
	defer db.Close()

	if !m.PersistenceAvailable() {
		t.Fatalf("PersistenceAvailable() = false on a persistence-enabled manager")
	}
	m.SetAllowPersistent(false)
	if m.PersistenceAvailable() {
		t.Errorf("PersistenceAvailable() = true after disable")
	}
	if _, err := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{Persistent: true}); err != ErrPersistenceOff {
		t.Errorf("persistent create while disabled error = %v, want ErrPersistenceOff", err)
	}
	m.SetAllowPersistent(true)
	if _, err := m.CreateSpaceWithOptions("alice", "x", SpaceOptions{Persistent: true}); err != nil {
		t.Errorf("persistent create after re-enable error = %v", err)
	}
}

func TestSweepStaleSpaces(t *testing.T) {
	env := newPersistenceEnv(t)
	m, db := env.open(t)
	defer db.Close()

	stale, _ := m.CreateSpaceWithOptions("alice", "Stale", SpaceOptions{Persistent: true})
	fresh, _ := m.CreateSpaceWithOptions("alice", "Fresh", SpaceOptions{Persistent: true})
	fresh.AddText("alice", "recent activity", "test")
	occupied, _ := m.CreateSpaceWithOptions("alice", "Occupied", SpaceOptions{Persistent: true})
	occupied.Channel().Join("alice")
	ephemeral := m.CreateSpace("alice", "Ephemeral")

	//Backdate the stale and occupied spaces
	for _, space := range []*Space{stale, occupied} {
		space.mu.Lock()
		space.CreatedAt = time.Now().Add(-48 * time.Hour)
		space.mu.Unlock()
	}
	ephemeral.mu.Lock()
	ephemeral.CreatedAt = time.Now().Add(-48 * time.Hour)
	ephemeral.mu.Unlock()

	swept := m.SweepStaleSpaces(24 * time.Hour)
	if len(swept) != 1 || swept[0] != stale.ID {
		t.Errorf("SweepStaleSpaces() = %v, want [%s]", swept, stale.ID)
	}
	if _, ok := m.GetSpace(fresh.ID); !ok {
		t.Errorf("fresh space was swept")
	}
	if _, ok := m.GetSpace(occupied.ID); !ok {
		t.Errorf("occupied space was swept despite live subscriber")
	}
	if _, ok := m.GetSpace(ephemeral.ID); !ok {
		t.Errorf("ephemeral space was swept (not this sweeper's job)")
	}
	//maxAge <= 0 disables the sweep
	if swept := m.SweepStaleSpaces(0); swept != nil {
		t.Errorf("SweepStaleSpaces(0) = %v, want nil", swept)
	}
}
