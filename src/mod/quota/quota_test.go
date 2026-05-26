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
