package permission

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
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

// ----- group.go: Remove -----

func TestPermissionGroupRemove(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	pg := ph.NewPermissionGroup("to-remove", false, 0, []string{"mod1"}, "Desktop")

	if !ph.GroupExists("to-remove") {
		t.Fatal("group should exist before Remove")
	}

	pg.Remove()

	// Verify database keys are gone
	if database.KeyExists("permission", "group/to-remove") {
		t.Error("group/to-remove key should be deleted after Remove")
	}
	if database.KeyExists("permission", "isadmin/to-remove") {
		t.Error("isadmin/to-remove key should be deleted after Remove")
	}
}

// ----- permission.go: GetUsersPermissionGroup -----

func TestGetUsersPermissionGroup(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)
	ph.NewPermissionGroup("readers", false, 100, []string{"gallery"}, "Desktop")
	ph.NewPermissionGroup("writers", false, 200, []string{"editor"}, "Desktop")

	// Write user -> group mapping into "auth" table (the format used by the system).
	// database.Write JSON-encodes the value, so pass the slice directly.
	err := database.NewTable("auth")
	if err != nil {
		t.Fatalf("NewTable auth: %v", err)
	}
	groups := []string{"readers", "writers"}
	database.Write("auth", "group/alice", groups)

	result, err := ph.GetUsersPermissionGroup("alice")
	if err != nil {
		t.Fatalf("GetUsersPermissionGroup error: %v", err)
	}
	if len(result) != 2 {
		t.Errorf("expected 2 groups for alice, got %d", len(result))
	}
}

func TestGetUsersPermissionGroup_UserNotFound(t *testing.T) {
	database := openTempDB(t)
	ph, _ := NewPermissionHandler(database)

	// Ensure the "auth" table exists so the database read doesn't panic on a
	// missing bucket. When the user key is absent the read returns an empty
	// slice with no error; GetUsersPermissionGroup should therefore return an
	// empty result with no error.
	database.NewTable("auth")
	result, err := ph.GetUsersPermissionGroup("ghost")
	if err != nil {
		t.Errorf("unexpected error for unknown user: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty group list for unknown user, got %d groups", len(result))
	}
}

// ----- request.go: HandleListGroup -----

func newPermHandler(t *testing.T) *PermissionHandler {
	t.Helper()
	database := openTempDB(t)
	ph, err := NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	ph.NewPermissionGroup("editors", false, 500, []string{"filemanager"}, "Desktop")
	ph.NewPermissionGroup("admins", true, -1, []string{"*"}, "Desktop")
	return ph
}

func TestHandleListGroup_NamesOnly(t *testing.T) {
	ph := newPermHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/listgroup", nil)
	rr := httptest.NewRecorder()

	ph.HandleListGroup(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "editors") {
		t.Errorf("response should contain 'editors', got: %s", body)
	}
	if !strings.Contains(body, "admins") {
		t.Errorf("response should contain 'admins', got: %s", body)
	}
}

func TestHandleListGroup_WithPermissions(t *testing.T) {
	ph := newPermHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/listgroup?showper=true", nil)
	rr := httptest.NewRecorder()

	ph.HandleListGroup(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "editors") {
		t.Errorf("response should contain group info with 'editors', got: %s", body)
	}
}

// ----- request.go: HandleGroupEdit -----

func postRequest(path string, params map[string]string) *http.Request {
	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req
}

func TestHandleGroupEdit_ListMode(t *testing.T) {
	ph := newPermHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/groupedit?list=true", nil)
	q := req.URL.Query()
	q.Set("list", "true")
	req.URL.RawQuery = q.Encode()
	// PostPara for groupname - use form body
	form := url.Values{}
	form.Set("groupname", "editors")
	req2, _ := http.NewRequest(http.MethodPost, "/api/groupedit?list=true", strings.NewReader(form.Encode()))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rr := httptest.NewRecorder()
	ph.HandleGroupEdit(rr, req2)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "editors") {
		t.Errorf("expected group info for 'editors', got: %s", body)
	}
}

func TestHandleGroupEdit_ListMode_NonExistentGroup(t *testing.T) {
	ph := newPermHandler(t)
	form := url.Values{}
	form.Set("groupname", "nonexistent")
	req, _ := http.NewRequest(http.MethodPost, "/api/groupedit?list=true", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	ph.HandleGroupEdit(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for non-existent group, got: %s", body)
	}
}

func TestHandleGroupEdit_UpdateMode(t *testing.T) {
	ph := newPermHandler(t)
	modList, _ := json.Marshal([]string{"filemanager", "settings"})
	req := postRequest("/api/groupedit", map[string]string{
		"groupname":       "editors",
		"permission":      string(modList),
		"isAdmin":         "false",
		"defaultQuota":    "2048",
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupEdit(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error: %s", body)
	}

	// Verify update took effect
	pg := ph.GetPermissionGroupByName("editors")
	if pg == nil {
		t.Fatal("group 'editors' not found after edit")
	}
	if pg.DefaultStorageQuota != 2048 {
		t.Errorf("expected quota 2048, got %d", pg.DefaultStorageQuota)
	}
}

func TestHandleGroupEdit_MissingGroupname(t *testing.T) {
	ph := newPermHandler(t)
	req := postRequest("/api/groupedit", map[string]string{})
	rr := httptest.NewRecorder()
	ph.HandleGroupEdit(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error when groupname missing, got: %s", body)
	}
}

func TestHandleGroupEdit_CannotUnsetAdminFromAdministrator(t *testing.T) {
	ph := newPermHandler(t)
	// Create the administrator group
	ph.NewPermissionGroup("administrator", true, -1, []string{"*"}, "Desktop")

	modList, _ := json.Marshal([]string{"*"})
	req := postRequest("/api/groupedit", map[string]string{
		"groupname":       "administrator",
		"permission":      string(modList),
		"isAdmin":         "false", // trying to remove admin
		"defaultQuota":    "-1",
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupEdit(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error when unsetting admin from administrator, got: %s", body)
	}
}

func TestHandleGroupEdit_InvalidPermissionJSON(t *testing.T) {
	ph := newPermHandler(t)
	req := postRequest("/api/groupedit", map[string]string{
		"groupname":  "editors",
		"permission": "not-valid-json",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupEdit(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for invalid JSON permission, got: %s", body)
	}
}

// ----- request.go: HandleGroupCreate -----

func TestHandleGroupCreate_Success(t *testing.T) {
	ph := newPermHandler(t)
	modList, _ := json.Marshal([]string{"gallery"})
	req := postRequest("/api/groupcreate", map[string]string{
		"groupname":       "newgroup",
		"permission":      string(modList),
		"isAdmin":         "false",
		"defaultQuota":    "1024",
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupCreate(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error creating group: %s", body)
	}
	if !ph.GroupExists("newgroup") {
		t.Error("group 'newgroup' should exist after create")
	}
}

func TestHandleGroupCreate_DuplicateGroup(t *testing.T) {
	ph := newPermHandler(t)
	modList, _ := json.Marshal([]string{})
	req := postRequest("/api/groupcreate", map[string]string{
		"groupname":       "editors", // already exists
		"permission":      string(modList),
		"isAdmin":         "false",
		"defaultQuota":    "0",
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupCreate(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for duplicate group, got: %s", body)
	}
}

func TestHandleGroupCreate_MissingGroupname(t *testing.T) {
	ph := newPermHandler(t)
	req := postRequest("/api/groupcreate", map[string]string{})
	rr := httptest.NewRecorder()
	ph.HandleGroupCreate(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for missing groupname, got: %s", body)
	}
}

func TestHandleGroupCreate_InvalidQuota(t *testing.T) {
	ph := newPermHandler(t)
	modList, _ := json.Marshal([]string{})
	req := postRequest("/api/groupcreate", map[string]string{
		"groupname":       "quotagroup",
		"permission":      string(modList),
		"isAdmin":         "false",
		"defaultQuota":    "notanumber",
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupCreate(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for invalid quota, got: %s", body)
	}
}

func TestHandleGroupCreate_NegativeQuota(t *testing.T) {
	ph := newPermHandler(t)
	modList, _ := json.Marshal([]string{})
	req := postRequest("/api/groupcreate", map[string]string{
		"groupname":       "badquota",
		"permission":      string(modList),
		"isAdmin":         "false",
		"defaultQuota":    "-2", // -1 is unlimited, -2 is invalid
		"interfaceModule": "Desktop",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupCreate(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for quota < -1, got: %s", body)
	}
}

// ----- request.go: HandleGroupRemove -----

func TestHandleGroupRemove_Success(t *testing.T) {
	ph := newPermHandler(t)
	// Add a removable group
	ph.NewPermissionGroup("temp-group", false, 0, []string{}, "Desktop")

	req := postRequest("/api/groupremove", map[string]string{
		"groupname": "temp-group",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupRemove(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error removing group: %s", body)
	}
	if ph.GroupExists("temp-group") {
		t.Error("group 'temp-group' should be gone after remove")
	}
}

func TestHandleGroupRemove_NonExistentGroup(t *testing.T) {
	ph := newPermHandler(t)
	req := postRequest("/api/groupremove", map[string]string{
		"groupname": "doesnotexist",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupRemove(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for non-existent group, got: %s", body)
	}
}

func TestHandleGroupRemove_CannotRemoveAdministrator(t *testing.T) {
	ph := newPermHandler(t)
	ph.NewPermissionGroup("administrator", true, -1, []string{"*"}, "Desktop")

	req := postRequest("/api/groupremove", map[string]string{
		"groupname": "administrator",
	})
	rr := httptest.NewRecorder()
	ph.HandleGroupRemove(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error when trying to remove administrator group, got: %s", body)
	}
}

func TestHandleGroupRemove_MissingGroupname(t *testing.T) {
	ph := newPermHandler(t)
	req := postRequest("/api/groupremove", map[string]string{})
	rr := httptest.NewRecorder()
	ph.HandleGroupRemove(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for missing groupname, got: %s", body)
	}
}
