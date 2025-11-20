package quota

import (
	"os"
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
	fs "imuslab.com/arozos/mod/filesystem"
)

func TestNewUserQuotaHandler(t *testing.T) {
	// Create temporary database
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	// Test case 1: Create new quota handler
	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))
	if quotaHandler == nil {
		t.Error("Test case 1 failed. Expected non-nil QuotaHandler")
	}
	if quotaHandler.username != "testuser" {
		t.Errorf("Test case 1 failed. Expected username: 'testuser', Got: '%s'", quotaHandler.username)
	}
	if quotaHandler.TotalStorageQuota != 1000000 {
		t.Errorf("Test case 1 failed. Expected quota: 1000000, Got: %d", quotaHandler.TotalStorageQuota)
	}
}

func TestSetUserStorageQuota(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))

	// Test case 1: Set new quota
	quotaHandler.SetUserStorageQuota(2000000)
	if quotaHandler.TotalStorageQuota != 2000000 {
		t.Errorf("Test case 1 failed. Expected quota: 2000000, Got: %d", quotaHandler.TotalStorageQuota)
	}

	// Test case 2: Verify quota is persisted
	quota := quotaHandler.GetUserStorageQuota()
	if quota != 2000000 {
		t.Errorf("Test case 2 failed. Expected quota: 2000000, Got: %d", quota)
	}
}

func TestGetUserStorageQuota(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))

	// Test case 1: Get default quota
	quota := quotaHandler.GetUserStorageQuota()
	if quota == int64(-2) {
		t.Error("Test case 1 failed. Quota should be initialized")
	}
}

func TestIsQuotaInitialized(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))

	// Test case 1: Quota should be initialized
	if !quotaHandler.IsQuotaInitialized() {
		t.Error("Test case 1 failed. Quota should be initialized")
	}
}

func TestRemoveUserQuota(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))

	// Test case 1: Remove quota
	quotaHandler.RemoveUserQuota()

	// After removal, quota should not be initialized
	if quotaHandler.IsQuotaInitialized() {
		t.Error("Test case 1 failed. Quota should be removed")
	}
}

func TestHaveSpace(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))
	quotaHandler.UsedStorageQuota = 500000

	// Test case 1: Have space for small file
	if !quotaHandler.HaveSpace(100000) {
		t.Error("Test case 1 failed. Should have space for 100000 bytes")
	}

	// Test case 2: No space for large file
	if quotaHandler.HaveSpace(600000) {
		t.Error("Test case 2 failed. Should not have space for 600000 bytes")
	}

	// Test case 3: Unlimited quota (-1)
	quotaHandler.TotalStorageQuota = -1
	if !quotaHandler.HaveSpace(9999999999) {
		t.Error("Test case 3 failed. Should have unlimited space when quota is -1")
	}
}

func TestAllocateSpace(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))
	initialUsed := quotaHandler.UsedStorageQuota

	// Test case 1: Allocate space
	err = quotaHandler.AllocateSpace(50000)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}
	expectedUsed := initialUsed + 50000
	if quotaHandler.UsedStorageQuota != expectedUsed {
		t.Errorf("Test case 1 failed. Expected used quota: %d, Got: %d", expectedUsed, quotaHandler.UsedStorageQuota)
	}

	// Test case 2: Allocate more space
	err = quotaHandler.AllocateSpace(30000)
	if err != nil {
		t.Errorf("Test case 2 failed. Error: %v", err)
	}
	expectedUsed = initialUsed + 80000
	if quotaHandler.UsedStorageQuota != expectedUsed {
		t.Errorf("Test case 2 failed. Expected used quota: %d, Got: %d", expectedUsed, quotaHandler.UsedStorageQuota)
	}
}

func TestReclaimSpace(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))
	quotaHandler.UsedStorageQuota = 100000

	// Test case 1: Reclaim space
	err = quotaHandler.ReclaimSpace(30000)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}
	if quotaHandler.UsedStorageQuota != 70000 {
		t.Errorf("Test case 1 failed. Expected used quota: 70000, Got: %d", quotaHandler.UsedStorageQuota)
	}

	// Test case 2: Reclaim more than used (should not go negative)
	err = quotaHandler.ReclaimSpace(100000)
	if err != nil {
		t.Errorf("Test case 2 failed. Error: %v", err)
	}
	if quotaHandler.UsedStorageQuota != 0 {
		t.Errorf("Test case 2 failed. Expected used quota: 0, Got: %d", quotaHandler.UsedStorageQuota)
	}
}

func TestUpdateUserStoragePool(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "quota_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	quotaHandler := NewUserQuotaHandler(database, "testuser", []*fs.FileSystemHandler{}, int64(1000000))

	// Test case 1: Update storage pool
	newPool := []*fs.FileSystemHandler{}
	quotaHandler.UpdateUserStoragePool(newPool)
	if len(quotaHandler.fspool) != 0 {
		t.Errorf("Test case 1 failed. Expected empty pool, Got: %d handlers", len(quotaHandler.fspool))
	}
}

func TestInSlice(t *testing.T) {
	slice := []string{"apple", "banana", "orange"}

	// Test case 1: Value exists in slice
	index, found := inSlice(slice, "banana")
	if !found || index != 1 {
		t.Errorf("Test case 1 failed. Expected index: 1, found: true, Got: index: %d, found: %v", index, found)
	}

	// Test case 2: Value does not exist in slice
	index, found = inSlice(slice, "grape")
	if found || index != -1 {
		t.Errorf("Test case 2 failed. Expected index: -1, found: false, Got: index: %d, found: %v", index, found)
	}

	// Test case 3: First element
	index, found = inSlice(slice, "apple")
	if !found || index != 0 {
		t.Errorf("Test case 3 failed. Expected index: 0, found: true, Got: index: %d, found: %v", index, found)
	}

	// Test case 4: Last element
	index, found = inSlice(slice, "orange")
	if !found || index != 2 {
		t.Errorf("Test case 4 failed. Expected index: 2, found: true, Got: index: %d, found: %v", index, found)
	}

	// Test case 5: Empty slice
	index, found = inSlice([]string{}, "test")
	if found || index != -1 {
		t.Errorf("Test case 5 failed. Expected index: -1, found: false, Got: index: %d, found: %v", index, found)
	}
}
