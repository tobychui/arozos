package logger

import (
	"os"
	"testing"
)

func TestNewLogger(t *testing.T) {
	// Test case 1: Create logger without file logging
	logger, err := NewLogger("test", "/tmp/test-logs", false)
	if err != nil {
		t.Errorf("Test case 1 failed. Error creating logger: %v", err)
	}
	if logger == nil {
		t.Error("Test case 1 failed. Logger should not be nil")
	}

	// Test case 2: Create logger with file logging
	tmpDir := "/tmp/test-logger-" + t.Name()
	defer os.RemoveAll(tmpDir)

	logger2, err := NewLogger("test", tmpDir, true)
	if err != nil {
		t.Errorf("Test case 2 failed. Error creating file logger: %v", err)
	}
	if logger2 == nil {
		t.Error("Test case 2 failed. Logger should not be nil")
	}
	if logger2.file == nil {
		t.Error("Test case 2 failed. Logger file should not be nil when LogToFile is true")
	}
	logger2.Close()
}

func TestNewTmpLogger(t *testing.T) {
	// Test case 1: Create temporary logger
	logger, err := NewTmpLogger()
	if err != nil {
		t.Errorf("Test case 1 failed. Error creating tmp logger: %v", err)
	}
	if logger == nil {
		t.Error("Test case 1 failed. Logger should not be nil")
	}
	if logger.LogToFile {
		t.Error("Test case 1 failed. Tmp logger should not log to file")
	}
}
