package bridge

import (
	"testing"
)

func TestNewBridgeRecord(t *testing.T) {
	record := NewBridgeRecord("/tmp/test_bridge.json")
	if record == nil {
		t.Error("Record should not be nil")
	}
	if record.Filename != "/tmp/test_bridge.json" {
		t.Error("Filename mismatch")
	}
}
