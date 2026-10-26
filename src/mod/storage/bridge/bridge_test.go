package bridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewBridgeRecord(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)
	if r == nil {
		t.Fatal("Expected non-nil Record")
	}
	if r.Filename != tmpFile {
		t.Errorf("Expected Filename %q, got %q", tmpFile, r.Filename)
	}
}

func TestReadConfig_NewFile(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	configs, err := r.ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig() unexpected error: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("Expected empty config, got %d entries", len(configs))
	}

	// File should now exist
	if _, err := os.Stat(tmpFile); os.IsNotExist(err) {
		t.Error("Expected config file to be created")
	}
}

func TestReadConfig_InvalidFile(t *testing.T) {
	// Write invalid JSON to file
	tmpFile := filepath.Join(t.TempDir(), "bad_bridge.json")
	os.WriteFile(tmpFile, []byte("not valid json"), 0775)

	r := NewBridgeRecord(tmpFile)
	_, err := r.ReadConfig()
	if err == nil {
		t.Error("Expected error for invalid JSON file")
	}
}

func TestAppendToConfig(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	config1 := &BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-1"}
	err := r.AppendToConfig(config1)
	if err != nil {
		t.Fatalf("AppendToConfig() unexpected error: %v", err)
	}

	configs, err := r.ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig() unexpected error: %v", err)
	}
	if len(configs) != 1 {
		t.Errorf("Expected 1 config, got %d", len(configs))
	}
}

func TestAppendToConfig_Duplicate(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	config1 := &BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-1"}
	r.AppendToConfig(config1)

	// Try to append the same config again
	err := r.AppendToConfig(config1)
	if err == nil {
		t.Error("Expected error for duplicate config")
	}
}

func TestRemoveFromConfig(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	config1 := &BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-1"}
	config2 := &BridgeConfig{FSHUUID: "uuid-2", SPOwner: "owner-2"}
	r.AppendToConfig(config1)
	r.AppendToConfig(config2)

	err := r.RemoveFromConfig("uuid-1", "owner-1")
	if err != nil {
		t.Fatalf("RemoveFromConfig() unexpected error: %v", err)
	}

	configs, _ := r.ReadConfig()
	if len(configs) != 1 {
		t.Errorf("Expected 1 config after removal, got %d", len(configs))
	}
	if configs[0].FSHUUID != "uuid-2" {
		t.Errorf("Wrong config remaining: %s", configs[0].FSHUUID)
	}
}

func TestIsBridgedFSH(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	config1 := &BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-1"}
	r.AppendToConfig(config1)

	// Test that it's bridged
	isBridged, err := r.IsBridgedFSH("uuid-1", "owner-1")
	if err != nil {
		t.Fatalf("IsBridgedFSH() unexpected error: %v", err)
	}
	if !isBridged {
		t.Error("Expected uuid-1/owner-1 to be bridged")
	}

	// Test that non-existent is not bridged
	isBridged2, err := r.IsBridgedFSH("uuid-999", "owner-999")
	if err != nil {
		t.Fatalf("IsBridgedFSH() unexpected error: %v", err)
	}
	if isBridged2 {
		t.Error("Expected non-existent FSH to not be bridged")
	}
}

func TestGetBridgedGroups(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	r.AppendToConfig(&BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-A"})
	r.AppendToConfig(&BridgeConfig{FSHUUID: "uuid-1", SPOwner: "owner-B"})
	r.AppendToConfig(&BridgeConfig{FSHUUID: "uuid-2", SPOwner: "owner-C"})

	groups := r.GetBridgedGroups("uuid-1")
	if len(groups) != 2 {
		t.Errorf("Expected 2 groups for uuid-1, got %d", len(groups))
	}

	groups2 := r.GetBridgedGroups("uuid-nonexistent")
	if len(groups2) != 0 {
		t.Errorf("Expected 0 groups for non-existent uuid, got %d", len(groups2))
	}
}

func TestGetBridgedGroups_EmptyFile(t *testing.T) {
	// Write invalid JSON to force error in ReadConfig
	tmpFile := filepath.Join(t.TempDir(), "bad_bridge.json")
	os.WriteFile(tmpFile, []byte("invalid json"), 0775)
	r := NewBridgeRecord(tmpFile)

	groups := r.GetBridgedGroups("uuid-1")
	if len(groups) != 0 {
		t.Errorf("Expected empty groups on error, got %d", len(groups))
	}
}

func TestWriteAndReadConfig(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "test_bridge.json")
	r := NewBridgeRecord(tmpFile)

	configs := []*BridgeConfig{
		{FSHUUID: "uuid-1", SPOwner: "owner-1"},
		{FSHUUID: "uuid-2", SPOwner: "owner-2"},
	}
	err := r.WriteConfig(configs)
	if err != nil {
		t.Fatalf("WriteConfig() unexpected error: %v", err)
	}

	readConfigs, err := r.ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig() unexpected error: %v", err)
	}
	if len(readConfigs) != 2 {
		t.Errorf("Expected 2 configs, got %d", len(readConfigs))
	}
}
