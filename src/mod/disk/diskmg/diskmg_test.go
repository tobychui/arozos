package diskmg

import (
	"testing"
)

func TestNewDiskManager(t *testing.T) {
	manager := NewDiskManager(nil)
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
