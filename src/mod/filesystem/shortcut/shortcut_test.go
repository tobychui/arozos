package shortcut

import (
	"testing"
)

func TestCreateShortcut(t *testing.T) {
	// Test creating shortcut structure
	sc := Shortcut{
		Name: "test",
		Path: "/test/path",
	}
	if sc.Name != "test" {
		t.Error("Name mismatch")
	}
}
