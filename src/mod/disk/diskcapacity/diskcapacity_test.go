package diskcapacity

import (
	"testing"
)

// TestNewCapacityResolverNilHandler verifies the constructor works with a nil
// UserHandler (a full UserHandler requires a live database and auth stack
// unavailable in unit tests).
func TestNewCapacityResolverNilHandler(t *testing.T) {
	r := NewCapacityResolver(nil)
	if r == nil {
		t.Fatal("NewCapacityResolver returned nil")
	}
	if r.UserHandler != nil {
		t.Errorf("expected UserHandler to be nil, got %v", r.UserHandler)
	}
}

// TestResolverStoresUserHandler verifies that the Resolver struct field is
// publicly accessible and matches what was passed to the constructor.
func TestResolverStoresUserHandler(t *testing.T) {
	// Pass nil — the important thing is that the field is stored correctly.
	r := NewCapacityResolver(nil)
	if r.UserHandler != nil {
		t.Errorf("expected nil UserHandler, got %v", r.UserHandler)
	}
}

// TestCapacityInfoZeroValue verifies the CapacityInfo struct can be created
// without panicking and that its zero values are sane.
func TestCapacityInfoZeroValue(t *testing.T) {
	ci := CapacityInfo{}
	if ci.Used != 0 {
		t.Errorf("expected Used=0, got %d", ci.Used)
	}
	if ci.Available != 0 {
		t.Errorf("expected Available=0, got %d", ci.Available)
	}
	if ci.Total != 0 {
		t.Errorf("expected Total=0, got %d", ci.Total)
	}
	if ci.PhysicalDevice != "" {
		t.Errorf("expected empty PhysicalDevice, got %q", ci.PhysicalDevice)
	}
}

// TestCapacityInfoFieldAssignment verifies that CapacityInfo fields can be
// set and read back correctly.
func TestCapacityInfoFieldAssignment(t *testing.T) {
	ci := CapacityInfo{
		PhysicalDevice:    "/dev/sda",
		FileSystemType:    "ext4",
		MountingHierarchy: "primary",
		Used:              1024,
		Available:         2048,
		Total:             3072,
	}

	if ci.PhysicalDevice != "/dev/sda" {
		t.Errorf("PhysicalDevice: want /dev/sda, got %q", ci.PhysicalDevice)
	}
	if ci.FileSystemType != "ext4" {
		t.Errorf("FileSystemType: want ext4, got %q", ci.FileSystemType)
	}
	if ci.MountingHierarchy != "primary" {
		t.Errorf("MountingHierarchy: want primary, got %q", ci.MountingHierarchy)
	}
	if ci.Used != 1024 {
		t.Errorf("Used: want 1024, got %d", ci.Used)
	}
	if ci.Available != 2048 {
		t.Errorf("Available: want 2048, got %d", ci.Available)
	}
	if ci.Total != 3072 {
		t.Errorf("Total: want 3072, got %d", ci.Total)
	}
}

// TestResolveCapacityInfoRequiresRealUser documents that ResolveCapacityInfo
// requires a live UserHandler. We cannot call it with nil without a panic
// because the method dereferences the pointer immediately; this test simply
// validates the struct is wired correctly and skips the live call.
func TestResolveCapacityInfoRequiresRealUser(t *testing.T) {
	r := NewCapacityResolver(nil)
	// A nil UserHandler means any attempt to resolve will panic / fail.
	// We only check that the Resolver itself was created correctly.
	if r == nil {
		t.Fatal("expected non-nil Resolver")
	}
	if r.UserHandler != nil {
		t.Errorf("expected nil UserHandler stored in Resolver, got %v", r.UserHandler)
	}
	t.Log("ResolveCapacityInfo with a real UserHandler requires a live database; skipping live call in unit test")
}
