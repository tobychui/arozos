package iot

import (
	"testing"
)

func TestNewIoTManager(t *testing.T) {
	manager := NewIoTManager(nil, nil)
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
