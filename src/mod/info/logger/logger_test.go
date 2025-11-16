package logger

import (
	"testing"
)

func TestNewLogger(t *testing.T) {
	// Test case 1: Create logger with nil database
	logger := NewLogger(nil, "test.log", 1000)
	if logger == nil {
		t.Error("Test case 1 failed. Logger should not be nil")
	}
}
