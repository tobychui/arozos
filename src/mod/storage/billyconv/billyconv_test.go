package billyconv

import (
	"testing"
)

func TestNewArozFsToBillyFsAdapter(t *testing.T) {
	// Test creating a Billy filesystem adapter
	adapter := NewArozFsToBillyFsAdapter(nil)
	if adapter == nil {
		t.Error("Adapter should not be nil")
	}
}
