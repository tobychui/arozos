package quota

import (
	"os"
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
	fs "imuslab.com/arozos/mod/filesystem"
)

// openTempDB creates a temporary BoltDB database for testing.
func openTempDB(t *testing.T) *db.Database {
	t.Helper()
	dir := t.TempDir()
	database, err := db.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}
	return database
}

func TestNewUserQuotaHandler(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 1024*1024)
	if qh == nil {
		t.Fatal("NewUserQuotaHandler returned nil")
	}
	if qh.TotalStorageQuota != 1024*1024 {
		t.Errorf("expected TotalStorageQuota=%d, got %d", 1024*1024, qh.TotalStorageQuota)
	}
}

func TestSetAndGetUserStorageQuota(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 500)
	qh.SetUserStorageQuota(2048)
	got := qh.GetUserStorageQuota()
	if got != 2048 {
		t.Errorf("expected quota 2048, got %d", got)
	}
}

func TestHaveSpace(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 1000)
	qh.UsedStorageQuota = 500

	if !qh.HaveSpace(400) {
		t.Error("should have space for 400 bytes when 500 of 1000 used")
	}
	if qh.HaveSpace(600) {
		t.Error("should not have space for 600 bytes when 500 of 1000 used")
	}
}

func TestHaveSpace_UnlimitedQuota(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, -1)
	qh.TotalStorageQuota = -1
	if !qh.HaveSpace(1 << 40) {
		t.Error("unlimited quota (-1) should always have space")
	}
}

func TestAllocateAndReclaimSpace(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 10000)

	if err := qh.AllocateSpace(300); err != nil {
		t.Fatalf("AllocateSpace error: %v", err)
	}
	if qh.UsedStorageQuota != 300 {
		t.Errorf("expected UsedStorageQuota=300 after allocation, got %d", qh.UsedStorageQuota)
	}

	if err := qh.ReclaimSpace(100); err != nil {
		t.Fatalf("ReclaimSpace error: %v", err)
	}
	if qh.UsedStorageQuota != 200 {
		t.Errorf("expected UsedStorageQuota=200 after reclaim, got %d", qh.UsedStorageQuota)
	}
}

func TestReclaimSpace_NeverNegative(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 10000)
	qh.UsedStorageQuota = 50
	qh.ReclaimSpace(200) // reclaim more than used
	if qh.UsedStorageQuota < 0 {
		t.Errorf("UsedStorageQuota went negative: %d", qh.UsedStorageQuota)
	}
}

func TestRemoveUserQuota(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 1000)
	qh.RemoveUserQuota()
	// After removal the key no longer exists; GetUserStorageQuota should return -2
	got := qh.GetUserStorageQuota()
	if got != -2 {
		t.Errorf("expected -2 after quota removal, got %d", got)
	}
}

func TestCalculateQuotaUsage_EmptyPool(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, 1000)
	// CalculateQuotaUsage with no filesystem handlers should not panic
	qh.CalculateQuotaUsage()
	if qh.UsedStorageQuota != 0 {
		t.Errorf("expected 0 used quota with empty pool, got %d", qh.UsedStorageQuota)
	}
}

func TestInSlice(t *testing.T) {
	slice := []string{"a", "b", "c"}
	if idx, ok := inSlice(slice, "b"); !ok || idx != 1 {
		t.Errorf("inSlice: expected (1, true) for 'b', got (%d, %v)", idx, ok)
	}
	if _, ok := inSlice(slice, "z"); ok {
		t.Error("inSlice: expected false for 'z'")
	}
}

// Ensure the package can be imported and os/filepath are usable (compile check).
var _ = os.DevNull
var _ = filepath.Separator

// ----- IsQuotaInitialized -----

func TestIsQuotaInitialized_True(t *testing.T) {
	database := openTempDB(t)
	// NewUserQuotaHandler writes a quota entry, so it should be initialized
	qh := NewUserQuotaHandler(database, "inituser", []*fs.FileSystemHandler{}, 1024)
	if !qh.IsQuotaInitialized() {
		t.Error("expected IsQuotaInitialized=true for a freshly created handler")
	}
}

func TestIsQuotaInitialized_FalseAfterRemoval(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "removeuser", []*fs.FileSystemHandler{}, 512)
	qh.RemoveUserQuota()
	if qh.IsQuotaInitialized() {
		t.Error("expected IsQuotaInitialized=false after quota removal")
	}
}

// ----- UpdateUserStoragePool -----

func TestUpdateUserStoragePool(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "pooluser", []*fs.FileSystemHandler{}, 2048)

	// Initial pool is empty
	if len(qh.fspool) != 0 {
		t.Fatalf("expected initial fspool length 0, got %d", len(qh.fspool))
	}

	// Update to a new (still empty) pool — confirms the method doesn't panic
	newPool := []*fs.FileSystemHandler{}
	qh.UpdateUserStoragePool(newPool)

	if len(qh.fspool) != 0 {
		t.Errorf("expected fspool length 0 after update, got %d", len(qh.fspool))
	}
}

func TestUpdateUserStoragePool_QuotaCalculationAfterUpdate(t *testing.T) {
	database := openTempDB(t)
	qh := NewUserQuotaHandler(database, "calcuser", []*fs.FileSystemHandler{}, 4096)

	// Replace pool with nil and recalculate — should not panic and keep quota at 0
	qh.UpdateUserStoragePool([]*fs.FileSystemHandler{})
	qh.CalculateQuotaUsage()

	if qh.UsedStorageQuota != 0 {
		t.Errorf("expected 0 used quota after update with empty pool, got %d", qh.UsedStorageQuota)
	}
}

// TestCalculateQuotaUsage_WithUserHierarchy tests the quota walk on a real directory tree.
func TestCalculateQuotaUsage_WithUserHierarchy(t *testing.T) {
	database := openTempDB(t)

	// Create a temp filesystem root that mimics a "user" hierarchy.
	root := t.TempDir()
	username := "walkuser"
	userDir := filepath.Join(root, "users", username)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("failed to create user dir: %v", err)
	}

	// Write two files with known sizes.
	if err := os.WriteFile(filepath.Join(userDir, "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatalf("write a.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(userDir, "b.txt"), []byte("world!"), 0644); err != nil {
		t.Fatalf("write b.txt: %v", err)
	}

	// Build a minimal FileSystemHandler with Hierarchy="user" pointing to root.
	fsh := &fs.FileSystemHandler{
		Hierarchy: "user",
		Path:      root,
	}

	qh := NewUserQuotaHandler(database, username, []*fs.FileSystemHandler{fsh}, 1<<20)
	// CalculateQuotaUsage is called inside NewUserQuotaHandler; check it found the files.
	if qh.UsedStorageQuota != 11 { // "hello"=5, "world!"=6
		t.Errorf("expected UsedStorageQuota=11, got %d", qh.UsedStorageQuota)
	}
}

// TestCalculateQuotaUsage_NonExistentUserDir verifies that a user dir that
// doesn't exist inside the hierarchy is gracefully skipped.
func TestCalculateQuotaUsage_NonExistentUserDir(t *testing.T) {
	database := openTempDB(t)

	root := t.TempDir()
	// Do NOT create users/<username> — verify it is skipped without error.
	fsh := &fs.FileSystemHandler{
		Hierarchy: "user",
		Path:      root,
	}

	qh := NewUserQuotaHandler(database, "ghost", []*fs.FileSystemHandler{fsh}, 1<<20)
	if qh.UsedStorageQuota != 0 {
		t.Errorf("expected 0 for missing user dir, got %d", qh.UsedStorageQuota)
	}
}

// TestCalculateQuotaUsage_NonUserHierarchy confirms that handlers with a
// hierarchy other than "user" do not contribute to quota.
func TestCalculateQuotaUsage_NonUserHierarchy(t *testing.T) {
	database := openTempDB(t)

	root := t.TempDir()
	// Hierarchy is "public" — should be ignored.
	fsh := &fs.FileSystemHandler{
		Hierarchy: "public",
		Path:      root,
	}

	qh := NewUserQuotaHandler(database, "pubuser", []*fs.FileSystemHandler{fsh}, 1<<20)
	if qh.UsedStorageQuota != 0 {
		t.Errorf("expected 0 for non-user hierarchy, got %d", qh.UsedStorageQuota)
	}
}
