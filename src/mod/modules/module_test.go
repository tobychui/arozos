package modules

import (
	"os"
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
)

func setupTestModuleHandler(t *testing.T) (*ModuleHandler, func()) {
	// Create temporary database
	tempDir, err := os.MkdirTemp("", "module_test")
	if err != nil {
		t.Fatal(err)
	}

	database, err := db.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}

	// Create a minimal user handler for testing
	userHandler := &user.UserHandler{
		UniversalModules: []string{},
	}
	userHandler.SetDatabase(database)

	handler := NewModuleHandler(userHandler, tempDir)

	cleanup := func() {
		database.Close()
		os.RemoveAll(tempDir)
	}

	return handler, cleanup
}

func TestNewModuleHandler(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Test case 1: Handler is created successfully
	if handler == nil {
		t.Error("Test case 1 failed. Expected non-nil ModuleHandler")
	}

	// Test case 2: LoadedModule is initialized as empty slice
	if handler.LoadedModule == nil {
		t.Error("Test case 2 failed. LoadedModule should not be nil")
	}

	if len(handler.LoadedModule) != 0 {
		t.Errorf("Test case 2 failed. Expected empty LoadedModule, got %d modules", len(handler.LoadedModule))
	}

	// Test case 3: userHandler is set
	if handler.userHandler == nil {
		t.Error("Test case 3 failed. userHandler should not be nil")
	}

	// Test case 4: tmpDirectory is set
	if handler.tmpDirectory == "" {
		t.Error("Test case 4 failed. tmpDirectory should not be empty")
	}
}

func TestRegisterModule(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Test case 1: Register a simple module
	module := ModuleInfo{
		Name:    "TestModule",
		Desc:    "Test Description",
		Group:   "Media",
		Version: "1.0.0",
	}
	handler.RegisterModule(module)

	if len(handler.LoadedModule) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 module, got %d", len(handler.LoadedModule))
	}

	if handler.LoadedModule[0].Name != "TestModule" {
		t.Errorf("Test case 1 failed. Expected module name 'TestModule', got '%s'", handler.LoadedModule[0].Name)
	}

	// Test case 2: Register a Utilities module (should be added to UniversalModules)
	utilModule := ModuleInfo{
		Name:  "UtilModule",
		Group: "Utilities",
	}
	handler.RegisterModule(utilModule)

	if len(handler.userHandler.UniversalModules) == 0 {
		t.Error("Test case 2 failed. Utilities module should be in UniversalModules")
	}

	found := false
	for _, name := range handler.userHandler.UniversalModules {
		if name == "UtilModule" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Test case 2 failed. UtilModule not found in UniversalModules")
	}

	// Test case 3: Register a System Tools module
	sysModule := ModuleInfo{
		Name:  "SysModule",
		Group: "System Tools",
	}
	handler.RegisterModule(sysModule)

	found = false
	for _, name := range handler.userHandler.UniversalModules {
		if name == "SysModule" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Test case 3 failed. SysModule not found in UniversalModules")
	}

	// Test case 4: Register module with mixed case group name
	mixedModule := ModuleInfo{
		Name:  "MixedModule",
		Group: "UTILITIES",
	}
	handler.RegisterModule(mixedModule)

	found = false
	for _, name := range handler.userHandler.UniversalModules {
		if name == "MixedModule" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Test case 4 failed. Mixed case utilities should be recognized")
	}

	// Test case 5: Verify total modules count
	if len(handler.LoadedModule) != 4 {
		t.Errorf("Test case 5 failed. Expected 4 modules, got %d", len(handler.LoadedModule))
	}
}

func TestModuleSortList(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Add modules in unsorted order
	handler.RegisterModule(ModuleInfo{Name: "Zebra"})
	handler.RegisterModule(ModuleInfo{Name: "Alpha"})
	handler.RegisterModule(ModuleInfo{Name: "Beta"})
	handler.RegisterModule(ModuleInfo{Name: "Gamma"})

	// Test case 1: Before sorting
	if handler.LoadedModule[0].Name != "Zebra" {
		t.Errorf("Test case 1 failed. Expected first module 'Zebra', got '%s'", handler.LoadedModule[0].Name)
	}

	// Test case 2: After sorting
	handler.ModuleSortList()

	expected := []string{"Alpha", "Beta", "Gamma", "Zebra"}
	for i, module := range handler.LoadedModule {
		if module.Name != expected[i] {
			t.Errorf("Test case 2 failed. Expected module at index %d to be '%s', got '%s'", i, expected[i], module.Name)
		}
	}

	// Test case 3: Empty list sort (should not panic)
	emptyHandler, cleanup2 := setupTestModuleHandler(t)
	defer cleanup2()
	emptyHandler.ModuleSortList()

	if len(emptyHandler.LoadedModule) != 0 {
		t.Error("Test case 3 failed. Empty handler should remain empty after sort")
	}

	// Test case 4: Single module sort (should not panic)
	singleHandler, cleanup3 := setupTestModuleHandler(t)
	defer cleanup3()
	singleHandler.RegisterModule(ModuleInfo{Name: "Single"})
	singleHandler.ModuleSortList()

	if singleHandler.LoadedModule[0].Name != "Single" {
		t.Error("Test case 4 failed. Single module sort failed")
	}
}

func TestRegisterModuleFromJSON(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Test case 1: Valid JSON
	validJSON := `{
		"Name": "JSONModule",
		"Desc": "Module from JSON",
		"Group": "Media",
		"Version": "1.0.0",
		"StartDir": "index.html"
	}`
	err := handler.RegisterModuleFromJSON(validJSON, true)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	if len(handler.LoadedModule) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 module, got %d", len(handler.LoadedModule))
	}

	if handler.LoadedModule[0].Name != "JSONModule" {
		t.Errorf("Test case 1 failed. Expected module name 'JSONModule', got '%s'", handler.LoadedModule[0].Name)
	}

	if !handler.LoadedModule[0].allowReload {
		t.Error("Test case 1 failed. allowReload should be true")
	}

	// Test case 2: Invalid JSON
	invalidJSON := `{invalid json}`
	err = handler.RegisterModuleFromJSON(invalidJSON, false)
	if err == nil {
		t.Error("Test case 2 failed. Expected error for invalid JSON")
	}

	// Test case 3: allowReload false
	validJSON2 := `{"Name": "NoReloadModule"}`
	err = handler.RegisterModuleFromJSON(validJSON2, false)
	if err != nil {
		t.Errorf("Test case 3 failed. Error: %v", err)
	}

	if handler.LoadedModule[1].allowReload {
		t.Error("Test case 3 failed. allowReload should be false")
	}

	// Test case 4: Empty JSON object
	emptyJSON := `{}`
	err = handler.RegisterModuleFromJSON(emptyJSON, true)
	if err != nil {
		t.Errorf("Test case 4 failed. Error: %v", err)
	}

	// Test case 5: JSON with all fields
	fullJSON := `{
		"Name": "FullModule",
		"Desc": "Complete description",
		"Group": "System",
		"IconPath": "icons/full.png",
		"Version": "2.1.3",
		"StartDir": "start.html",
		"SupportFW": true,
		"LaunchFWDir": "float.html",
		"SupportEmb": true,
		"LaunchEmb": "embed.html",
		"InitFWSize": [800, 600],
		"InitEmbSize": [400, 300],
		"SupportedExt": [".txt", ".md"]
	}`
	err = handler.RegisterModuleFromJSON(fullJSON, true)
	if err != nil {
		t.Errorf("Test case 5 failed. Error: %v", err)
	}

	fullModule := handler.LoadedModule[len(handler.LoadedModule)-1]
	if fullModule.SupportFW != true {
		t.Error("Test case 5 failed. SupportFW should be true")
	}
	if len(fullModule.SupportedExt) != 2 {
		t.Errorf("Test case 5 failed. Expected 2 supported extensions, got %d", len(fullModule.SupportedExt))
	}
}

func TestRegisterModuleFromAGI(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Test case 1: Valid AGI module
	validJSON := `{"Name": "AGIModule", "Group": "AGI"}`
	err := handler.RegisterModuleFromAGI(validJSON)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	if len(handler.LoadedModule) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 module, got %d", len(handler.LoadedModule))
	}

	// Test case 2: AGI module should always have allowReload=true
	if !handler.LoadedModule[0].allowReload {
		t.Error("Test case 2 failed. AGI modules must have allowReload=true")
	}

	// Test case 3: Invalid JSON
	invalidJSON := `{bad json`
	err = handler.RegisterModuleFromAGI(invalidJSON)
	if err == nil {
		t.Error("Test case 3 failed. Expected error for invalid JSON")
	}

	// Test case 4: Multiple AGI modules
	err = handler.RegisterModuleFromAGI(`{"Name": "AGI1"}`)
	if err != nil {
		t.Errorf("Test case 4 failed. Error: %v", err)
	}
	err = handler.RegisterModuleFromAGI(`{"Name": "AGI2"}`)
	if err != nil {
		t.Errorf("Test case 4 failed. Error: %v", err)
	}

	if len(handler.LoadedModule) != 3 {
		t.Errorf("Test case 4 failed. Expected 3 modules, got %d", len(handler.LoadedModule))
	}
}

func TestDeregisterModule(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Setup: Register multiple modules
	handler.RegisterModule(ModuleInfo{Name: "Module1"})
	handler.RegisterModule(ModuleInfo{Name: "Module2"})
	handler.RegisterModule(ModuleInfo{Name: "Module3"})

	// Test case 1: Deregister existing module
	handler.DeregisterModule("Module2")

	if len(handler.LoadedModule) != 2 {
		t.Errorf("Test case 1 failed. Expected 2 modules, got %d", len(handler.LoadedModule))
	}

	// Verify Module2 is removed
	for _, module := range handler.LoadedModule {
		if module.Name == "Module2" {
			t.Error("Test case 1 failed. Module2 should be removed")
		}
	}

	// Test case 2: Deregister non-existent module (should not panic)
	handler.DeregisterModule("NonExistent")

	if len(handler.LoadedModule) != 2 {
		t.Errorf("Test case 2 failed. Expected 2 modules, got %d", len(handler.LoadedModule))
	}

	// Test case 3: Deregister all modules
	handler.DeregisterModule("Module1")
	handler.DeregisterModule("Module3")

	if len(handler.LoadedModule) != 0 {
		t.Errorf("Test case 3 failed. Expected 0 modules, got %d", len(handler.LoadedModule))
	}

	// Test case 4: Deregister from empty list (should not panic)
	handler.DeregisterModule("Any")

	if len(handler.LoadedModule) != 0 {
		t.Error("Test case 4 failed. Should remain empty")
	}

	// Test case 5: Register and deregister with duplicate names
	handler.RegisterModule(ModuleInfo{Name: "Duplicate"})
	handler.RegisterModule(ModuleInfo{Name: "Duplicate"})
	handler.DeregisterModule("Duplicate")

	// Should remove all modules with that name
	if len(handler.LoadedModule) != 0 {
		t.Errorf("Test case 5 failed. Expected all duplicates removed, got %d modules", len(handler.LoadedModule))
	}
}

func TestGetModuleNameList(t *testing.T) {
	handler, cleanup := setupTestModuleHandler(t)
	defer cleanup()

	// Test case 1: Empty list
	names := handler.GetModuleNameList()
	if len(names) != 0 {
		t.Errorf("Test case 1 failed. Expected empty list, got %d names", len(names))
	}

	// Test case 2: Single module
	handler.RegisterModule(ModuleInfo{Name: "Single"})
	names = handler.GetModuleNameList()

	if len(names) != 1 {
		t.Errorf("Test case 2 failed. Expected 1 name, got %d", len(names))
	}

	if names[0] != "Single" {
		t.Errorf("Test case 2 failed. Expected 'Single', got '%s'", names[0])
	}

	// Test case 3: Multiple modules
	handler.RegisterModule(ModuleInfo{Name: "Alpha"})
	handler.RegisterModule(ModuleInfo{Name: "Beta"})
	handler.RegisterModule(ModuleInfo{Name: "Gamma"})

	names = handler.GetModuleNameList()

	if len(names) != 4 {
		t.Errorf("Test case 3 failed. Expected 4 names, got %d", len(names))
	}

	// Verify all names are present
	expectedNames := map[string]bool{"Single": true, "Alpha": true, "Beta": true, "Gamma": true}
	for _, name := range names {
		if !expectedNames[name] {
			t.Errorf("Test case 3 failed. Unexpected name '%s'", name)
		}
		delete(expectedNames, name)
	}

	if len(expectedNames) != 0 {
		t.Errorf("Test case 3 failed. Missing names: %v", expectedNames)
	}

	// Test case 4: After deregistering
	handler.DeregisterModule("Beta")
	names = handler.GetModuleNameList()

	if len(names) != 3 {
		t.Errorf("Test case 4 failed. Expected 3 names after deregister, got %d", len(names))
	}

	for _, name := range names {
		if name == "Beta" {
			t.Error("Test case 4 failed. 'Beta' should not be in list")
		}
	}
}
