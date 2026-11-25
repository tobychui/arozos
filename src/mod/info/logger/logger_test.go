package logger

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
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

// withDebug turns debug logging on or off for one test and restores it after
func withDebug(t *testing.T, enabled bool) {
	t.Helper()
	was := IsDebug()
	SetDebug(enabled)
	t.Cleanup(func() { SetDebug(was) })
}

// withDefaultLogger points the package-level functions at a file logger in a
// temp folder for one test and returns it
func withDefaultLogger(t *testing.T) *Logger {
	t.Helper()
	l, err := NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	was := defaultLogger
	SetDefaultLogger(l)
	t.Cleanup(func() {
		SetDefaultLogger(was)
		l.Close()
	})
	return l
}

func readLog(t *testing.T, l *Logger) string {
	t.Helper()
	b, err := os.ReadFile(l.CurrentLogFile)
	if err != nil {
		t.Fatalf("unable to read log file: %v", err)
	}
	return string(b)
}

// TestSetDebug checks that the flag can be switched both ways
func TestSetDebug(t *testing.T) {
	withDebug(t, false)
	tests := []bool{true, false, true}
	for _, want := range tests {
		SetDebug(want)
		if got := IsDebug(); got != want {
			t.Errorf("IsDebug() = %v after SetDebug(%v)", got, want)
		}
	}
}

// TestDebugWrittenOnlyWhenEnabled checks that debug lines reach the log file
// only while debug logging is on, and are in the file once the call returns
func TestDebugWrittenOnlyWhenEnabled(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		log     func()
		text    string
	}{
		{"Debug on", true, func() { Debug("Storage", "mounted user:/") }, "mounted user:/"},
		{"Debugf on", true, func() { Debugf("Storage", "mounted %s:/ for %s", "S1", "admin") }, "mounted S1:/ for admin"},
		{"Debug off", false, func() { Debug("Storage", "hidden line") }, "hidden line"},
		{"Debugf off", false, func() { Debugf("Storage", "hidden %d", 7) }, "hidden 7"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebug(t, tt.enabled)
			l := withDefaultLogger(t)
			tt.log()
			content := readLog(t, l)
			if got := strings.Contains(content, tt.text); got != tt.enabled {
				t.Fatalf("line logged = %v, want %v; file: %q", got, tt.enabled, content)
			}
			if tt.enabled && !strings.Contains(content, "[DEBUG] ") {
				t.Errorf("line not marked as DEBUG: %q", content)
			}
		})
	}
}

// TestDebugNamesCallerAndGoroutine checks the trace details of a debug line
func TestDebugNamesCallerAndGoroutine(t *testing.T) {
	withDebug(t, true)
	l := withDefaultLogger(t)
	l.PrintDebug("Storage", "method call")
	Debug("Storage", "package call")
	content := readLog(t, l)
	for _, want := range []string{"method call", "package call", "logger/logger_test.go:", " (g"} {
		if !strings.Contains(content, want) {
			t.Errorf("log file lacks %q: %q", want, content)
		}
	}
}

// TestDebugfDepth checks that a wrapper can name its own caller
func TestDebugfDepth(t *testing.T) {
	withDebug(t, true)
	l := withDefaultLogger(t)
	wrapper := func() { DebugfDepth(1, "Storage", "from %s", "wrapper") }
	wrapper() //This line is the one to report
	_, _, line, _ := runtime.Caller(0)
	content := readLog(t, l)
	want := "logger/logger_test.go:" + strconv.Itoa(line-1) + ")"
	if !strings.Contains(content, "from wrapper") || !strings.Contains(content, want) {
		t.Errorf("log file lacks %q: %q", want, content)
	}
}

// TestPrintDebugOff checks that a logger's own debug method honours the flag
func TestPrintDebugOff(t *testing.T) {
	withDebug(t, false)
	l := withDefaultLogger(t)
	l.PrintDebug("Storage", "should not appear")
	if content := readLog(t, l); content != "" {
		t.Errorf("debug line written while debug is off: %q", content)
	}
}

// TestDebugNilLogger checks that debug lines before the logger exists do not panic
func TestDebugNilLogger(t *testing.T) {
	withDebug(t, true)
	var l *Logger
	l.PrintDebug("Storage", "early line")
}

// TestTracePanic checks that a traced panic is logged with its stack and
// still panics with the same value
func TestTracePanic(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
	}{
		{"debug on", true},
		{"debug off", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebug(t, tt.enabled)
			l := withDefaultLogger(t)
			var got interface{}
			func() {
				defer func() { got = recover() }()
				func() {
					defer TracePanic("Storage", "test context")
					panic("boom")
				}()
			}()
			if got != "boom" {
				t.Fatalf("recovered %v, want the original panic value", got)
			}
			content := readLog(t, l)
			logged := strings.Contains(content, "PANIC in test context: boom") && strings.Contains(content, "TestTracePanic")
			if logged != tt.enabled {
				t.Errorf("panic logged with stack = %v, want %v; file: %q", logged, tt.enabled, content)
			}
		})
	}
}

// TestTracePanicNoPanic checks that TracePanic does nothing on a normal return
func TestTracePanicNoPanic(t *testing.T) {
	withDebug(t, true)
	l := withDefaultLogger(t)
	func() {
		defer TracePanic("Storage", "quiet")
	}()
	if content := readLog(t, l); content != "" {
		t.Errorf("log written without a panic: %q", content)
	}
}

// TestSlogDebugFollowsFlag checks that debug records of a slog logger are
// logged at the DEBUG level only while debug logging is on
func TestSlogDebugFollowsFlag(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
	}{
		{"debug on", true},
		{"debug off", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebug(t, tt.enabled)
			debugLines := []string{}
			infoLines := 0
			h := &slogHandler{
				title:     "SMB",
				emit:      func(string, string, error) { infoLines++ },
				emitDebug: func(_ string, message string) { debugLines = append(debugLines, message) },
			}
			l := slog.New(h)
			if got := l.Handler().Enabled(context.Background(), slog.LevelDebug); got != tt.enabled {
				t.Errorf("Enabled(debug) = %v, want %v", got, tt.enabled)
			}
			l.Debug("lease break", "share", "photos")
			if tt.enabled && (len(debugLines) != 1 || debugLines[0] != "lease break share=photos") {
				t.Errorf("debug lines = %q", debugLines)
			}
			if !tt.enabled && len(debugLines) != 0 {
				t.Errorf("debug record logged while debug is off: %q", debugLines)
			}
			if infoLines != 0 {
				t.Errorf("debug record sent to the info level")
			}
		})
	}
}
