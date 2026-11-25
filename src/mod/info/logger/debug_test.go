package logger

import (
	"context"
	"log/slog"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

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
	for _, want := range []string{"method call", "package call", "logger/debug_test.go:", " (g"} {
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
	want := "logger/debug_test.go:" + strconv.Itoa(line-1) + ")"
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
