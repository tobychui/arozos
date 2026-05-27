package logger

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestNewLoggerNoFile creates a logger without file logging.
func TestNewLoggerNoFile(t *testing.T) {
	l, err := NewLogger("test", "", false)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	if l == nil {
		t.Fatal("NewLogger returned nil")
	}
	if l.LogToFile {
		t.Error("LogToFile should be false")
	}
}

// TestNewLoggerWithFile creates a logger that writes to a temp directory.
func TestNewLoggerWithFile(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("myapp", dir, true)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	if l == nil {
		t.Fatal("NewLogger returned nil")
	}
	defer l.Close()

	if !l.LogToFile {
		t.Error("LogToFile should be true")
	}
	if l.CurrentLogFile == "" {
		t.Error("CurrentLogFile should be set")
	}
	if !strings.HasPrefix(filepath.Base(l.CurrentLogFile), "myapp_") {
		t.Errorf("log filename prefix unexpected: %s", l.CurrentLogFile)
	}

	// Verify the file was created on disk.
	if _, err := os.Stat(l.CurrentLogFile); os.IsNotExist(err) {
		t.Errorf("log file not created at %s", l.CurrentLogFile)
	}
}

// TestNewLoggerCreatesDirectory verifies that a missing log directory is created.
func TestNewLoggerCreatesDirectory(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "subdir", "logs")
	l, err := NewLogger("prefix", dir, true)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	defer l.Close()

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Errorf("log directory was not created: %s", dir)
	}
}

// TestNewTmpLogger creates a non-persistent logger.
func TestNewTmpLogger(t *testing.T) {
	l, err := NewTmpLogger()
	if err != nil {
		t.Fatalf("NewTmpLogger returned error: %v", err)
	}
	if l == nil {
		t.Fatal("NewTmpLogger returned nil")
	}
	if l.LogToFile {
		t.Error("LogToFile should be false for tmp logger")
	}
}

// TestPrintAndLog calls PrintAndLog and confirms it does not panic.
func TestPrintAndLog(t *testing.T) {
	l, err := NewTmpLogger()
	if err != nil {
		t.Fatalf("NewTmpLogger error: %v", err)
	}
	// PrintAndLog must not panic even without a file.
	l.PrintAndLog("TestTitle", "test message", nil)
	// Give the goroutine a moment to finish.
	time.Sleep(20 * time.Millisecond)
}

// TestLogNoFile verifies that Log does nothing when LogToFile is false.
func TestLogNoFile(t *testing.T) {
	l, err := NewTmpLogger()
	if err != nil {
		t.Fatalf("NewTmpLogger error: %v", err)
	}
	// Should not panic.
	l.Log("title", "message", nil)
}

// TestLogInfoWritesToFile verifies that an info log entry is written to the file.
func TestLogInfoWritesToFile(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("test", dir, true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	defer l.Close()

	l.Log("MyTitle", "hello world", nil)

	data, err := os.ReadFile(l.CurrentLogFile)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "[INFO]") {
		t.Errorf("expected [INFO] in log, got: %s", content)
	}
	if !strings.Contains(content, "hello world") {
		t.Errorf("expected message in log, got: %s", content)
	}
}

// TestLogErrorWritesToFile verifies that an error log entry includes [ERROR] and the error text.
func TestLogErrorWritesToFile(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("test", dir, true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	defer l.Close()

	l.Log("ErrTitle", "something broke", os.ErrNotExist)

	data, err := os.ReadFile(l.CurrentLogFile)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "[ERROR]") {
		t.Errorf("expected [ERROR] in log, got: %s", content)
	}
	if !strings.Contains(content, os.ErrNotExist.Error()) {
		t.Errorf("expected error text in log, got: %s", content)
	}
}

// TestValidateAndUpdateLogFilepath_NoChange checks that no rotation occurs when
// the expected filepath matches the current one.
func TestValidateAndUpdateLogFilepath_NoChange(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("rotate", dir, true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	defer l.Close()

	original := l.CurrentLogFile
	l.ValidateAndUpdateLogFilepath()

	if l.CurrentLogFile != original {
		t.Errorf("file path changed unexpectedly: %s -> %s", original, l.CurrentLogFile)
	}
}

// TestValidateAndUpdateLogFilepath_MonthChange simulates a month change by
// manually setting CurrentLogFile to an old path and calling ValidateAndUpdate.
func TestValidateAndUpdateLogFilepath_MonthChange(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("rotate", dir, true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	defer l.Close()

	// Force a "month change" by pointing CurrentLogFile at a stale path.
	l.CurrentLogFile = filepath.Join(dir, "rotate_1999-1.log")

	l.ValidateAndUpdateLogFilepath()

	// After the call, CurrentLogFile should now be the expected current path.
	expected := l.getLogFilepath()
	if l.CurrentLogFile != expected {
		t.Errorf("expected CurrentLogFile %s, got %s", expected, l.CurrentLogFile)
	}
	// Verify the new file exists on disk.
	if _, err := os.Stat(l.CurrentLogFile); os.IsNotExist(err) {
		t.Errorf("rotated log file not created: %s", l.CurrentLogFile)
	}
}

// TestClose verifies that Close can be called on a file-backed logger without panicking.
func TestClose(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("close", dir, true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	l.Close() // must not panic
}

// TestGetLogFilepath checks that the generated log filename contains the year and month.
func TestGetLogFilepath(t *testing.T) {
	l := &Logger{
		Prefix:    "app",
		LogFolder: "/tmp",
	}
	year, month, _ := time.Now().Date()
	path := l.getLogFilepath()
	if !strings.Contains(path, "app_") {
		t.Errorf("expected prefix in path: %s", path)
	}
	if !strings.Contains(path, strconv.Itoa(year)) {
		t.Errorf("expected year in path: %s", path)
	}
	if !strings.Contains(path, strconv.Itoa(int(month))) {
		t.Errorf("expected month in path: %s", path)
	}
}
