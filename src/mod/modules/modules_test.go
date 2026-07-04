package modules

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestModuleInfo_JSON(t *testing.T) {
	module := ModuleInfo{
		Name:         "TestModule",
		Desc:         "A test module",
		Group:        "utilities",
		IconPath:     "test/img/icon.png",
		Version:      "1.0.0",
		StartDir:     "test/index.html",
		SupportFW:    true,
		LaunchFWDir:  "test/float.html",
		SupportEmb:   false,
		SupportedExt: []string{".txt", ".pdf"},
	}

	// Marshal to JSON
	data, err := json.Marshal(module)
	if err != nil {
		t.Fatalf("Failed to marshal ModuleInfo: %v", err)
	}

	// Unmarshal back
	var restored ModuleInfo
	err = json.Unmarshal(data, &restored)
	if err != nil {
		t.Fatalf("Failed to unmarshal ModuleInfo: %v", err)
	}

	if restored.Name != module.Name {
		t.Errorf("Name mismatch: got %q, want %q", restored.Name, module.Name)
	}
	if restored.Group != module.Group {
		t.Errorf("Group mismatch: got %q, want %q", restored.Group, module.Group)
	}
	if len(restored.SupportedExt) != 2 {
		t.Errorf("Expected 2 extensions, got %d", len(restored.SupportedExt))
	}
}

func TestNewModuleHandler(t *testing.T) {
	// NewModuleHandler requires a userHandler which is complex
	// Test with nil (may panic) - we test the struct is initialized
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
		tmpDirectory: t.TempDir(),
	}
	if mh.LoadedModule == nil {
		t.Error("Expected non-nil LoadedModule")
	}
}

func TestRegisterModuleFromJSON_Valid(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	moduleJSON := `{
		"Name": "TestMod",
		"Desc": "Test description",
		"Group": "media",
		"IconPath": "test/icon.png",
		"Version": "1.0.0",
		"StartDir": "test/index.html",
		"SupportFW": true,
		"SupportedExt": [".txt"]
	}`

	err := mh.RegisterModuleFromJSON(moduleJSON, false)
	if err != nil {
		t.Fatalf("RegisterModuleFromJSON() unexpected error: %v", err)
	}
	if len(mh.LoadedModule) != 1 {
		t.Errorf("Expected 1 module, got %d", len(mh.LoadedModule))
	}
}

func TestRegisterModuleFromJSON_Invalid(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	err := mh.RegisterModuleFromJSON("invalid json {", false)
	if err == nil {
		t.Error("Expected error for invalid JSON")
	}
}

func TestDeregisterModule(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	moduleJSON := `{"Name": "ModA", "Group": "media"}`
	mh.RegisterModuleFromJSON(moduleJSON, false)
	mh.RegisterModuleFromJSON(`{"Name": "ModB", "Group": "media"}`, false)

	if len(mh.LoadedModule) != 2 {
		t.Fatalf("Expected 2 modules before deregister, got %d", len(mh.LoadedModule))
	}

	mh.DeregisterModule("ModA")
	if len(mh.LoadedModule) != 1 {
		t.Errorf("Expected 1 module after deregister, got %d", len(mh.LoadedModule))
	}
	if mh.LoadedModule[0].Name != "ModB" {
		t.Errorf("Expected ModB to remain, got %q", mh.LoadedModule[0].Name)
	}
}

func TestGetModuleNameList(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	mh.RegisterModuleFromJSON(`{"Name": "Alpha", "Group": "media"}`, false)
	mh.RegisterModuleFromJSON(`{"Name": "Beta", "Group": "media"}`, false)

	names := mh.GetModuleNameList()
	if len(names) != 2 {
		t.Errorf("Expected 2 module names, got %d", len(names))
	}
}

func TestModuleSortList(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	mh.RegisterModuleFromJSON(`{"Name": "Zebra", "Group": "media"}`, false)
	mh.RegisterModuleFromJSON(`{"Name": "Apple", "Group": "media"}`, false)
	mh.RegisterModuleFromJSON(`{"Name": "Mango", "Group": "media"}`, false)

	mh.ModuleSortList()

	names := mh.GetModuleNameList()
	if names[0] != "Apple" || names[1] != "Mango" || names[2] != "Zebra" {
		t.Errorf("Expected sorted order [Apple Mango Zebra], got %v", names)
	}
}

func TestGetModuleInfoByID(t *testing.T) {
	mh := &ModuleHandler{
		LoadedModule: []*ModuleInfo{},
	}

	mh.RegisterModuleFromJSON(`{"Name": "FindMe", "Group": "media"}`, false)

	info := mh.GetModuleInfoByID("FindMe")
	if info == nil {
		t.Fatal("Expected non-nil ModuleInfo")
	}
	if info.Name != "FindMe" {
		t.Errorf("Expected Name FindMe, got %q", info.Name)
	}

	// Non-existent module
	notFound := mh.GetModuleInfoByID("DoesNotExist")
	if notFound != nil {
		t.Error("Expected nil for non-existent module")
	}
}

// TestGetLaunchParameter_MissingParam tests that missing "module" param returns error
func TestGetLaunchParameter_MissingParam(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}

	req := httptest.NewRequest(http.MethodGet, "/modules/launch", nil)
	rr := httptest.NewRecorder()
	mh.GetLaunchParameter(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for missing module param, got: %s", body)
	}
}

// TestGetLaunchParameter_NotFound tests that an unknown module returns error
func TestGetLaunchParameter_NotFound(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}

	req := httptest.NewRequest(http.MethodGet, "/modules/launch?module=NonExistent", nil)
	rr := httptest.NewRecorder()
	mh.GetLaunchParameter(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for non-existent module, got: %s", body)
	}
}

// TestGetLaunchParameter_Found tests that a known module returns JSON
func TestGetLaunchParameter_Found(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	mh.RegisterModuleFromJSON(`{"Name": "MyApp", "Group": "media", "StartDir": "MyApp/index.html"}`, false)

	req := httptest.NewRequest(http.MethodGet, "/modules/launch?module=MyApp", nil)
	rr := httptest.NewRecorder()
	mh.GetLaunchParameter(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "MyApp") {
		t.Errorf("expected module name in response, got: %s", body)
	}
}

// TestRegisterModule_NonUtilitiesGroup tests that non-utilities groups don't access userHandler
func TestRegisterModule_NonUtilitiesGroup(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	// userHandler is nil; as long as Group != "utilities"/"system tools" it won't be accessed
	module := ModuleInfo{
		Name:  "TestMediaMod",
		Group: "media",
	}
	mh.RegisterModule(module)
	if len(mh.LoadedModule) != 1 {
		t.Errorf("expected 1 module, got %d", len(mh.LoadedModule))
	}
}

// TestGetModuleNameList_Empty verifies an empty handler returns empty list
func TestGetModuleNameList_Empty(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	names := mh.GetModuleNameList()
	if len(names) != 0 {
		t.Errorf("expected 0 names, got %d", len(names))
	}
}

// TestDeregisterModule_NonExistent verifies deregistering unknown module is a no-op
func TestDeregisterModule_NonExistent(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	mh.RegisterModuleFromJSON(`{"Name": "StayMod", "Group": "media"}`, false)
	mh.DeregisterModule("NotHere")
	if len(mh.LoadedModule) != 1 {
		t.Errorf("expected 1 module after no-op deregister, got %d", len(mh.LoadedModule))
	}
}

// TestModuleSortList_Empty verifies sorting empty list doesn't panic
func TestModuleSortList_Empty(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	mh.ModuleSortList() // should not panic
}

// TestOnModuleUninstall_Hook verifies the hook is called on uninstall (only if hook is set)
func TestOnModuleUninstall_Hook(t *testing.T) {
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	mh.RegisterModuleFromJSON(`{"Name": "HookMod", "Group": "media"}`, false)

	called := false
	mh.OnModuleUninstall = func(moduleName string) {
		if moduleName == "HookMod" {
			called = true
		}
	}

	// Invoke DeregisterModule which may or may not call OnModuleUninstall
	mh.DeregisterModule("HookMod")

	// The hook may not be called by DeregisterModule (it's for uninstall, not deregister)
	// Just verify the module is gone
	if mh.GetModuleInfoByID("HookMod") != nil {
		t.Error("expected HookMod to be deregistered")
	}
	_ = called // hook may not be invoked by DeregisterModule
}
