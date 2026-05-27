package permission

import (
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
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

func TestNewPermissionHandler(t *testing.T) {
	database := openTempDB(t)
	ph, err := NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler error: %v", err)
	}
	if ph == nil {
		t.Fatal("NewPermissionHandler returned nil handler")
	}
}

func TestNewPermissionGroup(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)

	pg := ph.NewPermissionGroup("editors", false, 500, []string{"filemanager"}, "Desktop")
	if pg == nil {
		t.Fatal("NewPermissionGroup returned nil")
	}
	if pg.Name != "editors" {
		t.Errorf("expected name 'editors', got %q", pg.Name)
	}
	if pg.IsAdmin {
		t.Error("expected IsAdmin=false")
	}
	if pg.DefaultStorageQuota != 500 {
		t.Errorf("expected DefaultStorageQuota=500, got %d", pg.DefaultStorageQuota)
	}
}

func TestGroupExists(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("writers", false, 0, []string{}, "Desktop")

	if !ph.GroupExists("writers") {
		t.Error("expected GroupExists('writers')=true")
	}
	if ph.GroupExists("nonexistent") {
		t.Error("expected GroupExists('nonexistent')=false")
	}
}

func TestGroupExists_CaseInsensitive(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("Admins", true, -1, []string{"*"}, "Desktop")

	if !ph.GroupExists("admins") {
		t.Error("GroupExists should be case-insensitive")
	}
}

func TestGetPermissionGroupByName(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("viewers", false, 100, []string{"gallery"}, "Desktop")

	pg := ph.GetPermissionGroupByName("viewers")
	if pg == nil {
		t.Fatal("GetPermissionGroupByName returned nil for existing group")
	}
	if pg.Name != "viewers" {
		t.Errorf("expected 'viewers', got %q", pg.Name)
	}

	if ph.GetPermissionGroupByName("ghost") != nil {
		t.Error("expected nil for non-existing group")
	}
}

func TestGetPermissionGroupByNameList(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("alpha", false, 0, []string{}, "Desktop")
	ph.NewPermissionGroup("beta", false, 0, []string{}, "Desktop")
	ph.NewPermissionGroup("gamma", false, 0, []string{}, "Desktop")

	results := ph.GetPermissionGroupByNameList([]string{"alpha", "gamma"})
	if len(results) != 2 {
		t.Errorf("expected 2 groups, got %d", len(results))
	}
}

func TestUpdatePermissionGroup(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("test-group", false, 200, []string{"mod1"}, "Desktop")

	err := ph.UpdatePermissionGroup("test-group", true, 999, []string{"mod1", "mod2"}, "Mobile")
	if err != nil {
		t.Fatalf("UpdatePermissionGroup error: %v", err)
	}

	pg := ph.GetPermissionGroupByName("test-group")
	if pg == nil {
		t.Fatal("group not found after update")
	}
	if !pg.IsAdmin {
		t.Error("expected IsAdmin=true after update")
	}
	if pg.DefaultStorageQuota != 999 {
		t.Errorf("expected DefaultStorageQuota=999, got %d", pg.DefaultStorageQuota)
	}
}

func TestUpdatePermissionGroup_NonExistent(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)

	err := ph.UpdatePermissionGroup("ghost-group", false, 0, []string{}, "Desktop")
	if err == nil {
		t.Error("expected error when updating non-existent group")
	}
}

func TestAddAndRemoveModule(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	pg := ph.NewPermissionGroup("modtest", false, 0, []string{}, "Desktop")

	pg.AddModule("filemanager")
	if len(pg.AccessibleModules) != 1 || pg.AccessibleModules[0] != "filemanager" {
		t.Errorf("expected [filemanager], got %v", pg.AccessibleModules)
	}

	// Adding same module twice should be idempotent
	pg.AddModule("filemanager")
	if len(pg.AccessibleModules) != 1 {
		t.Errorf("duplicate AddModule should be no-op, got %v", pg.AccessibleModules)
	}

	pg.RemoveModule("filemanager")
	if len(pg.AccessibleModules) != 0 {
		t.Errorf("expected empty modules after remove, got %v", pg.AccessibleModules)
	}
}

func TestGetLargestStorageQuotaFromGroups(t *testing.T) {
	groups := []*PermissionGroup{
		{DefaultStorageQuota: 100},
		{DefaultStorageQuota: 500},
		{DefaultStorageQuota: 200},
	}
	quota := GetLargestStorageQuotaFromGroups(groups)
	if quota != 500 {
		t.Errorf("expected largest quota=500, got %d", quota)
	}
}

func TestGetLargestStorageQuotaFromGroups_Unlimited(t *testing.T) {
	groups := []*PermissionGroup{
		{DefaultStorageQuota: 100},
		{DefaultStorageQuota: -1}, // unlimited
	}
	quota := GetLargestStorageQuotaFromGroups(groups)
	if quota != -1 {
		t.Errorf("expected -1 (unlimited), got %d", quota)
	}
}
