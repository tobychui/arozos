package shareEntry

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

func openTempDB(t *testing.T) *db.Database {
	t.Helper()
	dir := t.TempDir()
	database, err := db.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}
	return database
}

func newTestTable(t *testing.T) *ShareEntryTable {
	t.Helper()
	return NewShareEntryTable(openTempDB(t))
}

// insertShareOption injects a ShareOption directly into the maps (bypassing
// filesystem checks) so we can test lookup/deletion logic in isolation.
func insertShareOption(table *ShareEntryTable, opt *ShareOption) {
	table.FileToUrlMap.Store(opt.PathHash, opt)
	table.UrlToFileMap.Store(opt.UUID, opt)
}

func makeShareOption(uuid, pathHash, owner string) *ShareOption {
	return &ShareOption{
		UUID:            uuid,
		PathHash:        pathHash,
		FileVirtualPath: "user:/test/" + uuid,
		FileRealPath:    "/data/users/" + owner + "/test/" + uuid,
		Owner:           owner,
		Accessibles:     []string{},
		Permission:      "anyone",
		IsFolder:        false,
	}
}

// --- NewShareEntryTable ---

func TestNewShareEntryTable(t *testing.T) {
	table := newTestTable(t)
	if table == nil {
		t.Fatal("NewShareEntryTable returned nil")
	}
	if table.FileToUrlMap == nil || table.UrlToFileMap == nil {
		t.Error("sync.Maps should be initialised")
	}
	if table.Database == nil {
		t.Error("Database reference should not be nil")
	}
}

// --- GetShareObjectFromUUID ---

func TestGetShareObjectFromUUID_Found(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-001", "hash-001", "alice")
	insertShareOption(table, opt)

	got := table.GetShareObjectFromUUID("uuid-001")
	if got == nil {
		t.Fatal("expected ShareOption, got nil")
	}
	if got.UUID != "uuid-001" {
		t.Errorf("expected UUID 'uuid-001', got %q", got.UUID)
	}
}

func TestGetShareObjectFromUUID_NotFound(t *testing.T) {
	table := newTestTable(t)
	got := table.GetShareObjectFromUUID("does-not-exist")
	if got != nil {
		t.Errorf("expected nil for unknown UUID, got %+v", got)
	}
}

// --- GetShareObjectFromPathHash ---

func TestGetShareObjectFromPathHash_Found(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-002", "hash-002", "bob")
	insertShareOption(table, opt)

	got := table.GetShareObjectFromPathHash("hash-002")
	if got == nil {
		t.Fatal("expected ShareOption, got nil")
	}
	if got.PathHash != "hash-002" {
		t.Errorf("expected PathHash 'hash-002', got %q", got.PathHash)
	}
}

func TestGetShareObjectFromPathHash_NotFound(t *testing.T) {
	table := newTestTable(t)
	got := table.GetShareObjectFromPathHash("ghost-hash")
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

// --- GetShareUUIDFromPathHash ---

func TestGetShareUUIDFromPathHash(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-003", "hash-003", "carol")
	insertShareOption(table, opt)

	uuid := table.GetShareUUIDFromPathHash("hash-003")
	if uuid != "uuid-003" {
		t.Errorf("expected 'uuid-003', got %q", uuid)
	}
}

func TestGetShareUUIDFromPathHash_Missing(t *testing.T) {
	table := newTestTable(t)
	if table.GetShareUUIDFromPathHash("no-such-hash") != "" {
		t.Error("expected empty string for missing path hash")
	}
}

// --- FileIsShared ---

func TestFileIsShared(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-004", "hash-004", "dave")
	insertShareOption(table, opt)

	if !table.FileIsShared("hash-004") {
		t.Error("expected FileIsShared=true for existing hash")
	}
	if table.FileIsShared("no-hash") {
		t.Error("expected FileIsShared=false for unknown hash")
	}
}

// --- DeleteShareByUUID ---

func TestDeleteShareByUUID(t *testing.T) {
	table := newTestTable(t)
	// Also write to DB so Delete won't error
	opt := makeShareOption("uuid-del", "hash-del", "eve")
	table.Database.NewTable("share")
	table.Database.Write("share", opt.UUID, opt)
	insertShareOption(table, opt)

	err := table.DeleteShareByUUID("uuid-del")
	if err != nil {
		t.Fatalf("DeleteShareByUUID error: %v", err)
	}
	if table.FileIsShared("hash-del") {
		t.Error("entry should be gone after DeleteShareByUUID")
	}
}

// --- DeleteShareByPathHash ---

func TestDeleteShareByPathHash(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-ph", "hash-ph", "frank")
	table.Database.NewTable("share")
	table.Database.Write("share", opt.UUID, opt)
	insertShareOption(table, opt)

	err := table.DeleteShareByPathHash("hash-ph")
	if err != nil {
		t.Fatalf("DeleteShareByPathHash error: %v", err)
	}
	if table.FileIsShared("hash-ph") {
		t.Error("entry should be gone after DeleteShareByPathHash")
	}
}

// --- RemoveShareByUUID / RemoveShareByPathHash ---

func TestRemoveShareByUUID(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-rm", "hash-rm", "grace")
	table.Database.NewTable("share")
	table.Database.Write("share", opt.UUID, opt)
	insertShareOption(table, opt)

	err := table.RemoveShareByUUID("uuid-rm")
	if err != nil {
		t.Fatalf("RemoveShareByUUID error: %v", err)
	}
	if table.GetShareObjectFromUUID("uuid-rm") != nil {
		t.Error("entry should be removed from UrlToFileMap")
	}
}

func TestRemoveShareByUUID_NotFound(t *testing.T) {
	table := newTestTable(t)
	err := table.RemoveShareByUUID("ghost-uuid")
	if err == nil {
		t.Error("expected error when removing non-existent UUID")
	}
}

func TestRemoveShareByPathHash(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-rph", "hash-rph", "henry")
	table.Database.NewTable("share")
	table.Database.Write("share", opt.UUID, opt)
	insertShareOption(table, opt)

	err := table.RemoveShareByPathHash("hash-rph")
	if err != nil {
		t.Fatalf("RemoveShareByPathHash error: %v", err)
	}
}

func TestRemoveShareByPathHash_NotFound(t *testing.T) {
	table := newTestTable(t)
	err := table.RemoveShareByPathHash("ghost-hash")
	if err == nil {
		t.Error("expected error when removing non-existent path hash")
	}
}

// --- ResolveShareOptionFromShareSubpath ---

func TestResolveShareOptionFromShareSubpath(t *testing.T) {
	table := newTestTable(t)
	opt := makeShareOption("uuid-sub", "hash-sub", "irene")
	insertShareOption(table, opt)

	// subpath starts with "/" + uuid + "/" + optional extra
	resolved, err := table.ResolveShareOptionFromShareSubpath("/uuid-sub/somefile.txt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resolved.UUID != "uuid-sub" {
		t.Errorf("expected UUID 'uuid-sub', got %q", resolved.UUID)
	}
}

func TestResolveShareOptionFromShareSubpath_Invalid(t *testing.T) {
	table := newTestTable(t)
	_, err := table.ResolveShareOptionFromShareSubpath("/unknown-uuid/file")
	if err == nil {
		t.Error("expected error for unknown uuid in subpath")
	}
}

// --- ShareOption methods ---

func TestShareOption_IsOwnedBy(t *testing.T) {
	opt := &ShareOption{Owner: "alice"}
	if !opt.IsOwnedBy("alice") {
		t.Error("expected IsOwnedBy('alice')=true")
	}
	if opt.IsOwnedBy("bob") {
		t.Error("expected IsOwnedBy('bob')=false")
	}
}

func TestShareOption_IsAccessibleBy_Anyone(t *testing.T) {
	opt := &ShareOption{Permission: "anyone"}
	if !opt.IsAccessibleBy("stranger", []string{}) {
		t.Error("permission 'anyone' should allow all users")
	}
}

func TestShareOption_IsAccessibleBy_SignedIn(t *testing.T) {
	opt := &ShareOption{Permission: "signedin"}
	if !opt.IsAccessibleBy("anyuser", []string{}) {
		t.Error("permission 'signedin' should allow signed-in users")
	}
}

func TestShareOption_IsAccessibleBy_Groups(t *testing.T) {
	opt := &ShareOption{Permission: "groups", Accessibles: []string{"admins", "editors"}}
	if !opt.IsAccessibleBy("bob", []string{"editors"}) {
		t.Error("user in allowed group should have access")
	}
	if opt.IsAccessibleBy("bob", []string{"viewers"}) {
		t.Error("user not in allowed group should be denied")
	}
}

func TestShareOption_IsAccessibleBy_Users(t *testing.T) {
	opt := &ShareOption{Permission: "users", Accessibles: []string{"alice"}, Owner: "carol"}
	if !opt.IsAccessibleBy("alice", []string{}) {
		t.Error("listed user should have access")
	}
	if !opt.IsAccessibleBy("carol", []string{}) {
		t.Error("owner should always have access")
	}
	if opt.IsAccessibleBy("mallory", []string{}) {
		t.Error("unlisted non-owner should be denied")
	}
}

// --- stringInSlice (package-private) ---

func TestStringInSlice(t *testing.T) {
	if !stringInSlice("b", []string{"a", "b", "c"}) {
		t.Error("expected true for existing element")
	}
	if stringInSlice("z", []string{"a", "b", "c"}) {
		t.Error("expected false for missing element")
	}
}

// --- NewShareEntryTable with pre-existing DB entries ---

// TestNewShareEntryTable_LoadsExistingEntries verifies that NewShareEntryTable
// correctly loads previously stored ShareOption entries from the database into
// the in-memory maps.
func TestNewShareEntryTable_LoadsExistingEntries(t *testing.T) {
	dir := t.TempDir()
	database, err := db.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}

	// Write a share entry into the DB before creating the table
	database.NewTable("share")
	opt := makeShareOption("uuid-preload", "hash-preload", "tester")
	if err := database.Write("share", opt.UUID, opt); err != nil {
		t.Fatalf("failed to write share entry: %v", err)
	}

	// Also write an invalid (non-JSON) entry to exercise the nil-check branch
	if err := database.Write("share", "bad-entry-key", "not-valid-json"); err != nil {
		t.Fatalf("failed to write bad entry: %v", err)
	}

	// Now create the table - it should load the previously stored entry
	table := NewShareEntryTable(database)
	if table == nil {
		t.Fatal("expected non-nil table")
	}

	got := table.GetShareObjectFromUUID("uuid-preload")
	if got == nil {
		t.Fatal("expected preloaded entry to be present in UrlToFileMap")
	}
	if got.PathHash != "hash-preload" {
		t.Errorf("expected PathHash 'hash-preload', got %q", got.PathHash)
	}
}

// --- DeleteShareByPathHash (not-found branch) ---

func TestDeleteShareByPathHash_NotFound(t *testing.T) {
	table := newTestTable(t)
	// Deleting a non-existent pathhash should return nil (not an error)
	err := table.DeleteShareByPathHash("ghost-path-hash")
	if err != nil {
		t.Errorf("expected nil error for missing pathhash, got: %v", err)
	}
}

// --- DeleteShareByUUID (not-found branch) ---

func TestDeleteShareByUUID_NotFound(t *testing.T) {
	table := newTestTable(t)
	// Deleting a non-existent UUID should return nil (not an error)
	err := table.DeleteShareByUUID("ghost-uuid-del")
	if err != nil {
		t.Errorf("expected nil error for missing UUID, got: %v", err)
	}
}

// --- IsAccessibleBy (samegroup permission) ---

func TestShareOption_IsAccessibleBy_SameGroup(t *testing.T) {
	opt := &ShareOption{Permission: "samegroup", Accessibles: []string{"staff"}}
	if !opt.IsAccessibleBy("bob", []string{"staff"}) {
		t.Error("user in samegroup should have access")
	}
	if opt.IsAccessibleBy("bob", []string{"other"}) {
		t.Error("user not in samegroup should be denied")
	}
}

// --- IsAccessibleBy (unknown permission) ---

func TestShareOption_IsAccessibleBy_Unknown(t *testing.T) {
	opt := &ShareOption{Permission: "unknown"}
	if opt.IsAccessibleBy("anyuser", []string{}) {
		t.Error("unknown permission should deny access")
	}
}

// newTestFSH creates a minimal local FileSystemHandler rooted at a temp dir.
// hierarchy is "user" so vpath "uuid:/file" expands under <root>/users/<username>/file.
func newTestFSH(t *testing.T) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	root := t.TempDir()
	uuid := "testfsh"
	hierarchy := "user"
	fsa := localfs.NewLocalFileSystemAbstraction(uuid, root, hierarchy, false)
	fsh := &filesystem.FileSystemHandler{
		UUID:                  uuid,
		Name:                  "test",
		Path:                  root,
		Hierarchy:             hierarchy,
		FileSystemAbstraction: fsa,
	}
	return fsh, root
}

// --- GetPathHash ---

func TestGetPathHash(t *testing.T) {
	fsh, _ := newTestFSH(t)
	hash, err := GetPathHash(fsh, "/some/path", "alice")
	if err != nil {
		t.Fatalf("GetPathHash returned unexpected error: %v", err)
	}
	if hash == "" {
		t.Error("expected non-empty hash")
	}
}

// --- CreateNewShare ---

func TestCreateNewShare_New(t *testing.T) {
	fsh, root := newTestFSH(t)

	// Create a real file that the FSH can find via its path translation.
	// With "user" hierarchy and uuid "testfsh", virtual path "testfsh:/file.txt"
	// maps to <root>/users/alice/file.txt.
	userDir := filepath.Join(root, "users", "alice")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	filePath := filepath.Join(userDir, "file.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	table := newTestTable(t)
	opt, err := table.CreateNewShare(fsh, "testfsh:/file.txt", "alice", []string{})
	if err != nil {
		t.Fatalf("CreateNewShare returned error: %v", err)
	}
	if opt == nil {
		t.Fatal("expected non-nil ShareOption")
	}
	if opt.Owner != "alice" {
		t.Errorf("expected owner 'alice', got %q", opt.Owner)
	}
	if opt.UUID == "" {
		t.Error("expected non-empty UUID")
	}
}

// TestCreateNewShare_ExistingShare verifies that calling CreateNewShare for
// a path that is already shared returns the existing ShareOption.
func TestCreateNewShare_ExistingShare(t *testing.T) {
	fsh, root := newTestFSH(t)

	userDir := filepath.Join(root, "users", "bob")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	filePath := filepath.Join(userDir, "doc.txt")
	if err := os.WriteFile(filePath, []byte("content"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	table := newTestTable(t)
	opt1, err := table.CreateNewShare(fsh, "testfsh:/doc.txt", "bob", []string{})
	if err != nil {
		t.Fatalf("first CreateNewShare error: %v", err)
	}

	opt2, err := table.CreateNewShare(fsh, "testfsh:/doc.txt", "bob", []string{})
	if err != nil {
		t.Fatalf("second CreateNewShare error: %v", err)
	}

	if opt1.UUID != opt2.UUID {
		t.Errorf("expected same UUID for existing share, got %q vs %q", opt1.UUID, opt2.UUID)
	}
}

// TestCreateNewShare_FileNotFound verifies that CreateNewShare returns an error
// when the specified file does not exist on the file system.
func TestCreateNewShare_FileNotFound(t *testing.T) {
	fsh, _ := newTestFSH(t)
	table := newTestTable(t)

	_, err := table.CreateNewShare(fsh, "testfsh:/nonexistent.txt", "alice", []string{})
	if err == nil {
		t.Error("expected error for non-existent file, got nil")
	}
}

// Compile-time check that sync is imported
var _ sync.Map
