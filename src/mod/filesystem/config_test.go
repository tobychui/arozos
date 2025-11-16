package filesystem

import (
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

func TestLoadConfigFromJSON(t *testing.T) {
	// Test case 1: Valid JSON with single filesystem
	validJSON := `[{
		"name": "Test Storage",
		"uuid": "test1",
		"path": "/tmp/test",
		"access": "readwrite",
		"hierarchy": "public",
		"automount": false,
		"filesystem": "ext4"
	}]`

	configs, err := loadConfigFromJSON([]byte(validJSON))
	if err != nil {
		t.Errorf("Test case 1 failed. Valid JSON should not return error: %v", err)
	}
	if len(configs) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 config, got %d", len(configs))
	}
	if configs[0].Name != "Test Storage" {
		t.Errorf("Test case 1 failed. Expected name 'Test Storage', got '%s'", configs[0].Name)
	}

	// Test case 2: Valid JSON with multiple filesystems
	multiJSON := `[
		{"name": "Storage1", "uuid": "s1", "path": "/tmp", "access": "readwrite", "hierarchy": "public", "automount": false, "filesystem": "ext4"},
		{"name": "Storage2", "uuid": "s2", "path": "/var", "access": "readonly", "hierarchy": "user", "automount": true, "filesystem": "ntfs"}
	]`

	configs, err = loadConfigFromJSON([]byte(multiJSON))
	if err != nil {
		t.Errorf("Test case 2 failed. Valid JSON should not return error: %v", err)
	}
	if len(configs) != 2 {
		t.Errorf("Test case 2 failed. Expected 2 configs, got %d", len(configs))
	}

	// Test case 3: Empty JSON array
	emptyJSON := `[]`
	configs, err = loadConfigFromJSON([]byte(emptyJSON))
	if err != nil {
		t.Errorf("Test case 3 failed. Empty array should not return error: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("Test case 3 failed. Expected 0 configs, got %d", len(configs))
	}

	// Test case 4: Invalid JSON
	invalidJSON := `[{"name": "Test", "uuid": "test1"`
	_, err = loadConfigFromJSON([]byte(invalidJSON))
	if err == nil {
		t.Error("Test case 4 failed. Invalid JSON should return error")
	}

	// Test case 5: JSON with optional fields
	optionalJSON := `[{
		"name": "Storage",
		"uuid": "s1",
		"path": "/tmp",
		"access": "readwrite",
		"hierarchy": "public",
		"automount": false,
		"filesystem": "ext4",
		"mountdev": "/dev/sda1",
		"mountpt": "/media/storage",
		"username": "testuser",
		"password": "testpass"
	}]`

	configs, err = loadConfigFromJSON([]byte(optionalJSON))
	if err != nil {
		t.Errorf("Test case 5 failed. JSON with optional fields should not return error: %v", err)
	}
	if configs[0].Username != "testuser" {
		t.Errorf("Test case 5 failed. Expected username 'testuser', got '%s'", configs[0].Username)
	}
	if configs[0].Mountdev != "/dev/sda1" {
		t.Errorf("Test case 5 failed. Expected mountdev '/dev/sda1', got '%s'", configs[0].Mountdev)
	}

	// Test case 6: Empty string JSON
	_, err = loadConfigFromJSON([]byte(""))
	if err == nil {
		t.Error("Test case 6 failed. Empty string should return error")
	}

	// Test case 7: Null JSON
	nullJSON := `null`
	_, err = loadConfigFromJSON([]byte(nullJSON))
	if err == nil {
		t.Error("Test case 7 failed. Null JSON should return error")
	}
}

func TestValidateOption(t *testing.T) {
	// Create temporary directory for testing
	tempDir, err := os.MkdirTemp("", "validate_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Test case 1: Valid options
	validOption := &FileSystemOption{
		Name:       "Test Storage",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(validOption)
	if err != nil {
		t.Errorf("Test case 1 failed. Valid option should not return error: %v", err)
	}

	// Test case 2: Empty name
	invalidName := &FileSystemOption{
		Name:       "",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(invalidName)
	if err == nil {
		t.Error("Test case 2 failed. Empty name should return error")
	}

	// Test case 3: Empty UUID
	invalidUUID := &FileSystemOption{
		Name:       "Test",
		Uuid:       "",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(invalidUUID)
	if err == nil {
		t.Error("Test case 3 failed. Empty UUID should return error")
	}

	// Test case 4: Reserved UUID "user"
	reservedUUID1 := &FileSystemOption{
		Name:       "Test",
		Uuid:       "user",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(reservedUUID1)
	if err == nil {
		t.Error("Test case 4 failed. Reserved UUID 'user' should return error")
	}

	// Test case 5: Reserved UUID "tmp"
	reservedUUID2 := &FileSystemOption{
		Name:       "Test",
		Uuid:       "tmp",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(reservedUUID2)
	if err == nil {
		t.Error("Test case 5 failed. Reserved UUID 'tmp' should return error")
	}

	// Test case 6: Reserved UUID "network"
	reservedUUID3 := &FileSystemOption{
		Name:       "Test",
		Uuid:       "network",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(reservedUUID3)
	if err == nil {
		t.Error("Test case 6 failed. Reserved UUID 'network' should return error")
	}

	// Test case 7: Non-existent path (for non-network drives)
	nonExistentPath := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       "/nonexistent/path/12345",
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(nonExistentPath)
	if err == nil {
		t.Error("Test case 7 failed. Non-existent path should return error")
	}

	// Test case 8: Invalid access mode
	invalidAccess := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     "invalidmode",
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(invalidAccess)
	if err == nil {
		t.Error("Test case 8 failed. Invalid access mode should return error")
	}

	// Test case 9: Invalid hierarchy
	invalidHierarchy := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "invalidhierarchy",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(invalidHierarchy)
	if err == nil {
		t.Error("Test case 9 failed. Invalid hierarchy should return error")
	}

	// Test case 10: Invalid filesystem type
	invalidFS := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "invalidfs",
	}
	err = ValidateOption(invalidFS)
	if err == nil {
		t.Error("Test case 10 failed. Invalid filesystem type should return error")
	}

	// Test case 11: Readonly access mode
	readonlyOption := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadOnly,
		Hierarchy:  "public",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(readonlyOption)
	if err != nil {
		t.Errorf("Test case 11 failed. Readonly access should be valid: %v", err)
	}

	// Test case 12: User hierarchy
	userHierarchy := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "user",
		Automount:  false,
		Filesystem: "ext4",
	}
	err = ValidateOption(userHierarchy)
	if err != nil {
		t.Errorf("Test case 12 failed. User hierarchy should be valid: %v", err)
	}

	// Test case 13: Automount with empty mountpt (non-network drive)
	automountNoMountpt := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  true,
		Filesystem: "ext4",
		Mountpt:    "",
	}
	err = ValidateOption(automountNoMountpt)
	if err == nil {
		t.Error("Test case 13 failed. Automount with empty mountpt should return error")
	}

	// Test case 14: Automount with valid mountpt
	automountWithMountpt := &FileSystemOption{
		Name:       "Test",
		Uuid:       "test1",
		Path:       tempDir,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  "public",
		Automount:  true,
		Filesystem: "ext4",
		Mountpt:    "/media/storage",
	}
	err = ValidateOption(automountWithMountpt)
	if err != nil {
		t.Errorf("Test case 14 failed. Automount with valid mountpt should be valid: %v", err)
	}

	// Test case 15: Different supported filesystem types
	for _, fsType := range []string{"ext4", "ext3", "ext2", "ntfs"} {
		option := &FileSystemOption{
			Name:       "Test",
			Uuid:       "test1",
			Path:       tempDir,
			Access:     arozfs.FsReadWrite,
			Hierarchy:  "public",
			Automount:  false,
			Filesystem: fsType,
		}
		err = ValidateOption(option)
		if err != nil {
			t.Errorf("Test case 15 failed. Filesystem type '%s' should be valid: %v", fsType, err)
		}
	}
}
