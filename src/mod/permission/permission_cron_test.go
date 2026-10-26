package permission

import (
	"os"
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
)

// newTestHandler creates a PermissionHandler backed by a temp BoltDB file.
func newTestHandler(t *testing.T) *PermissionHandler {
	t.Helper()
	dir := t.TempDir()
	database, err := db.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(func() {
		database.Close()
		os.RemoveAll(dir)
	})
	h, err := NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	return h
}

// ─── GetCronJobPermission ────────────────────────────────────────────────────

func TestGetCronJobPermission_AdminAlwaysTrue(t *testing.T) {
	h := newTestHandler(t)
	admins := h.NewPermissionGroup("admins", true, -1, []string{"*"}, "Desktop")

	if !admins.GetCronJobPermission() {
		t.Error("admin group should always have cron job permission")
	}
}

func TestGetCronJobPermission_DefaultFalseForNonAdmin(t *testing.T) {
	h := newTestHandler(t)
	users := h.NewPermissionGroup("users", false, 0, []string{}, "Desktop")

	if users.GetCronJobPermission() {
		t.Error("non-admin group should NOT have cron job permission by default")
	}
}

func TestGetCronJobPermission_TrueAfterSet(t *testing.T) {
	h := newTestHandler(t)
	users := h.NewPermissionGroup("users", false, 0, []string{}, "Desktop")
	users.SetCronJobPermission(true)

	if !users.GetCronJobPermission() {
		t.Error("expected cron job permission to be true after SetCronJobPermission(true)")
	}
}

// ─── SetCronJobPermission ────────────────────────────────────────────────────

func TestSetCronJobPermission_NonAdminSetAndClear(t *testing.T) {
	h := newTestHandler(t)
	group := h.NewPermissionGroup("testers", false, 0, []string{}, "Desktop")

	group.SetCronJobPermission(true)
	if !group.CanCreateCronJob {
		t.Error("CanCreateCronJob should be true after setting to true")
	}

	group.SetCronJobPermission(false)
	if group.CanCreateCronJob {
		t.Error("CanCreateCronJob should be false after setting to false")
	}
}

func TestSetCronJobPermission_AdminGroupNotDemoted(t *testing.T) {
	h := newTestHandler(t)
	admins := h.NewPermissionGroup("admins", true, -1, []string{"*"}, "Desktop")

	// Calling SetCronJobPermission(false) on admin should not actually revoke it
	admins.SetCronJobPermission(false)
	if !admins.GetCronJobPermission() {
		t.Error("admin group should retain cron job permission even after SetCronJobPermission(false)")
	}
}

func TestSetCronJobPermission_PersistedToDB(t *testing.T) {
	h := newTestHandler(t)
	group := h.NewPermissionGroup("devs", false, 0, []string{}, "Desktop")
	group.SetCronJobPermission(true)

	// Read the raw value back from the database to confirm persistence
	var raw string
	if err := h.database.Read("permission", "canCreateCronJob/devs", &raw); err != nil {
		t.Fatalf("reading DB key: %v", err)
	}
	if raw != "true" {
		t.Errorf("expected DB value 'true', got %q", raw)
	}
}

// ─── SetGroupCronJobPermission (handler-level) ───────────────────────────────

func TestSetGroupCronJobPermission_NotFound(t *testing.T) {
	h := newTestHandler(t)
	if err := h.SetGroupCronJobPermission("nonexistent", true); err == nil {
		t.Error("expected error for non-existent group, got nil")
	}
}

func TestSetGroupCronJobPermission_UpdatesGroup(t *testing.T) {
	h := newTestHandler(t)
	h.NewPermissionGroup("staff", false, 0, []string{}, "Desktop")

	if err := h.SetGroupCronJobPermission("staff", true); err != nil {
		t.Fatalf("SetGroupCronJobPermission: %v", err)
	}

	gp := h.GetPermissionGroupByName("staff")
	if gp == nil {
		t.Fatal("group not found after creation")
	}
	if !gp.CanCreateCronJob {
		t.Error("expected CanCreateCronJob to be true after handler-level set")
	}
}

// ─── GetGroupCronJobPermissionList ───────────────────────────────────────────

func TestGetGroupCronJobPermissionList_MixedGroups(t *testing.T) {
	h := newTestHandler(t)
	h.NewPermissionGroup("admins", true, -1, []string{"*"}, "Desktop")
	users := h.NewPermissionGroup("users", false, 0, []string{}, "Desktop")
	users.SetCronJobPermission(true)
	h.NewPermissionGroup("guests", false, 0, []string{}, "Desktop")

	list := h.GetGroupCronJobPermissionList()

	if !list["admins"] {
		t.Error("admins should be true in list")
	}
	if !list["users"] {
		t.Error("users (with permission granted) should be true in list")
	}
	if list["guests"] {
		t.Error("guests (no permission) should be false in list")
	}
}

// ─── LoadPermissionGroupsFromDatabase round-trip ─────────────────────────────

func TestCronPermission_RoundTripThroughDB(t *testing.T) {
	h := newTestHandler(t)
	group := h.NewPermissionGroup("devs", false, 0, []string{}, "Desktop")
	group.SetCronJobPermission(true)

	// Re-load groups from DB
	if err := h.LoadPermissionGroupsFromDatabase(); err != nil {
		t.Fatalf("LoadPermissionGroupsFromDatabase: %v", err)
	}

	reloaded := h.GetPermissionGroupByName("devs")
	if reloaded == nil {
		t.Fatal("group 'devs' not found after reload")
	}
	if !reloaded.CanCreateCronJob {
		t.Error("CanCreateCronJob should survive a DB round-trip")
	}
}
