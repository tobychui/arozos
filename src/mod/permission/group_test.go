package permission

import (
	"reflect"
	"testing"
)

func TestAddModule(t *testing.T) {
	// Test case 1: Add module to empty list
	pg := &PermissionGroup{
		AccessibleModules: []string{},
	}
	pg.AddModule("module1")
	if len(pg.AccessibleModules) != 1 {
		t.Error("Test case 1 failed. Module should be added")
	}
	if pg.AccessibleModules[0] != "module1" {
		t.Errorf("Test case 1 failed. Expected 'module1', got '%s'", pg.AccessibleModules[0])
	}

	// Test case 2: Add another module
	pg.AddModule("module2")
	if len(pg.AccessibleModules) != 2 {
		t.Error("Test case 2 failed. Should have 2 modules")
	}

	// Test case 3: Add duplicate module (should not add)
	pg.AddModule("module1")
	if len(pg.AccessibleModules) != 2 {
		t.Error("Test case 3 failed. Duplicate module should not be added")
	}

	// Test case 4: Verify order is preserved
	expectedModules := []string{"module1", "module2"}
	if !reflect.DeepEqual(pg.AccessibleModules, expectedModules) {
		t.Errorf("Test case 4 failed. Expected %v, got %v", expectedModules, pg.AccessibleModules)
	}

	// Test case 5: Add third module
	pg.AddModule("module3")
	if len(pg.AccessibleModules) != 3 {
		t.Error("Test case 5 failed. Should have 3 modules")
	}

	// Test case 6: Add empty string module
	pg.AddModule("")
	if len(pg.AccessibleModules) != 4 {
		t.Error("Test case 6 failed. Empty string should be added as a module")
	}

	// Test case 7: Add duplicate empty string (should not add)
	pg.AddModule("")
	if len(pg.AccessibleModules) != 4 {
		t.Error("Test case 7 failed. Duplicate empty string should not be added")
	}

	// Test case 8: Module with special characters
	pg2 := &PermissionGroup{
		AccessibleModules: []string{},
	}
	pg2.AddModule("module-with-dash")
	pg2.AddModule("module_with_underscore")
	pg2.AddModule("module.with.dots")
	if len(pg2.AccessibleModules) != 3 {
		t.Error("Test case 8 failed. Should handle special characters")
	}
}

func TestRemoveModule(t *testing.T) {
	// Test case 1: Remove module from list
	pg := &PermissionGroup{
		AccessibleModules: []string{"module1", "module2", "module3"},
	}
	pg.RemoveModule("module2")
	if len(pg.AccessibleModules) != 2 {
		t.Error("Test case 1 failed. Module should be removed")
	}
	expectedModules := []string{"module1", "module3"}
	if !reflect.DeepEqual(pg.AccessibleModules, expectedModules) {
		t.Errorf("Test case 1 failed. Expected %v, got %v", expectedModules, pg.AccessibleModules)
	}

	// Test case 2: Remove non-existent module (should do nothing)
	pg.RemoveModule("nonexistent")
	if len(pg.AccessibleModules) != 2 {
		t.Error("Test case 2 failed. Removing non-existent module should not change list")
	}

	// Test case 3: Remove first module
	pg.RemoveModule("module1")
	if len(pg.AccessibleModules) != 1 {
		t.Error("Test case 3 failed. First module should be removed")
	}
	if pg.AccessibleModules[0] != "module3" {
		t.Errorf("Test case 3 failed. Expected 'module3', got '%s'", pg.AccessibleModules[0])
	}

	// Test case 4: Remove last module
	pg.RemoveModule("module3")
	if len(pg.AccessibleModules) != 0 {
		t.Error("Test case 4 failed. Last module should be removed")
	}

	// Test case 5: Remove from empty list (should do nothing)
	pg.RemoveModule("module1")
	if len(pg.AccessibleModules) != 0 {
		t.Error("Test case 5 failed. Removing from empty list should keep it empty")
	}

	// Test case 6: Remove empty string module
	pg2 := &PermissionGroup{
		AccessibleModules: []string{"module1", "", "module2"},
	}
	pg2.RemoveModule("")
	if len(pg2.AccessibleModules) != 2 {
		t.Error("Test case 6 failed. Empty string module should be removed")
	}
	expectedModules2 := []string{"module1", "module2"}
	if !reflect.DeepEqual(pg2.AccessibleModules, expectedModules2) {
		t.Errorf("Test case 6 failed. Expected %v, got %v", expectedModules2, pg2.AccessibleModules)
	}

	// Test case 7: Remove module with duplicates (should remove first occurrence)
	pg3 := &PermissionGroup{
		AccessibleModules: []string{"module1", "module2", "module1"},
	}
	pg3.RemoveModule("module1")
	if len(pg3.AccessibleModules) != 1 {
		t.Error("Test case 7 failed. Duplicates should all be removed")
	}
	if pg3.AccessibleModules[0] != "module2" {
		t.Errorf("Test case 7 failed. Expected only 'module2' to remain, got %v", pg3.AccessibleModules)
	}

	// Test case 8: Case sensitivity check
	pg4 := &PermissionGroup{
		AccessibleModules: []string{"Module1", "module1", "MODULE1"},
	}
	pg4.RemoveModule("module1")
	if len(pg4.AccessibleModules) != 2 {
		t.Error("Test case 8 failed. Removal should be case sensitive")
	}

	// Test case 9: Remove from single element list
	pg5 := &PermissionGroup{
		AccessibleModules: []string{"onlymodule"},
	}
	pg5.RemoveModule("onlymodule")
	if len(pg5.AccessibleModules) != 0 {
		t.Error("Test case 9 failed. Single element should be removed")
	}
}

func TestAddAndRemoveModuleCombined(t *testing.T) {
	// Test case 1: Add and remove operations combined
	pg := &PermissionGroup{
		AccessibleModules: []string{},
	}

	pg.AddModule("module1")
	pg.AddModule("module2")
	pg.AddModule("module3")
	if len(pg.AccessibleModules) != 3 {
		t.Error("Test case 1 failed. Should have 3 modules after adding")
	}

	pg.RemoveModule("module2")
	if len(pg.AccessibleModules) != 2 {
		t.Error("Test case 1 failed. Should have 2 modules after removal")
	}

	pg.AddModule("module4")
	if len(pg.AccessibleModules) != 3 {
		t.Error("Test case 1 failed. Should have 3 modules after adding again")
	}

	expectedModules := []string{"module1", "module3", "module4"}
	if !reflect.DeepEqual(pg.AccessibleModules, expectedModules) {
		t.Errorf("Test case 1 failed. Expected %v, got %v", expectedModules, pg.AccessibleModules)
	}

	// Test case 2: Add back a removed module
	pg.RemoveModule("module1")
	pg.AddModule("module1")
	if len(pg.AccessibleModules) != 3 {
		t.Error("Test case 2 failed. Should have 3 modules")
	}
	// module1 should be at the end now
	if pg.AccessibleModules[2] != "module1" {
		t.Error("Test case 2 failed. Re-added module should be at the end")
	}
}
