package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"log/slog"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// useDebugLogger makes a file backed logger the default one and sets the
// debug flag for one test, putting both back afterwards
func useDebugLogger(t *testing.T, enabled bool) *Logger {
	t.Helper()
	l, err := NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	previousLogger := defaultLogger
	previousFlag := DebugEnabled()
	defaultLogger = l
	SetDebug(enabled)
	//Console lines are not part of these tests
	log.SetOutput(io.Discard)
	t.Cleanup(func() {
		defaultLogger = previousLogger
		SetDebug(previousFlag)
		log.SetOutput(os.Stderr)
		l.Close()
	})
	return l
}

// readLog returns what the logger wrote to its file
func readLog(t *testing.T, l *Logger) string {
	t.Helper()
	data, err := os.ReadFile(l.CurrentLogFile)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	return string(data)
}

// TestSetDebug checks that the flag can be turned on and off.
func TestSetDebug(t *testing.T) {
	useDebugLogger(t, false)
	if DebugEnabled() {
		t.Fatal("debug should start disabled")
	}
	SetDebug(true)
	if !DebugEnabled() {
		t.Error("debug should be enabled")
	}
	SetDebug(false)
	if DebugEnabled() {
		t.Error("debug should be disabled again")
	}
}

// TestDebugDisabledWritesNothing checks that no debug line is written
// without the flag.
func TestDebugDisabledWritesNothing(t *testing.T) {
	l := useDebugLogger(t, false)
	Debug("Storage", "loading pool")
	Debugf("Storage", "loading pool %s", "users")
	l.Debug("Storage", "loading pool")
	if got := readLog(t, l); got != "" {
		t.Errorf("log should be empty, got: %q", got)
	}
}

// countingStringer counts how often it is formatted
type countingStringer struct{ calls *int }

func (c countingStringer) String() string {
	*c.calls++
	return "formatted"
}

// TestDebugfFormatsOnlyWhenEnabled checks that a disabled Debugf does not
// format its arguments.
func TestDebugfFormatsOnlyWhenEnabled(t *testing.T) {
	useDebugLogger(t, false)
	calls := 0
	Debugf("Storage", "value %s", countingStringer{&calls})
	if calls != 0 {
		t.Errorf("argument formatted %d times while disabled", calls)
	}
	SetDebug(true)
	Debugf("Storage", "value %s", countingStringer{&calls})
	if calls != 1 {
		t.Errorf("argument formatted %d times while enabled, want 1", calls)
	}
}

// TestDebugEnabledWritesLine checks the file line of each debug function.
func TestDebugEnabledWritesLine(t *testing.T) {
	tests := []struct {
		name    string
		log     func(l *Logger)
		message string
	}{
		{"Debug", func(l *Logger) { Debug("Storage", "loading pool users") }, "loading pool users"},
		{"Debugf", func(l *Logger) { Debugf("Storage", "loading pool %s (%d drives)", "users", 2) }, "loading pool users (2 drives)"},
		{"method", func(l *Logger) { l.Debug("Storage", "closing drive user") }, "closing drive user"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := useDebugLogger(t, true)
			tt.log(l)
			got := readLog(t, l)
			if !strings.Contains(got, "|Storage") || !strings.Contains(got, " [DEBUG]"+tt.message) {
				t.Errorf("missing title, level or message: %q", got)
			}
			if !strings.Contains(got, "(goroutine "+strconv.FormatUint(goroutineID(), 10)+", logger/debug_test.go:") {
				t.Errorf("missing goroutine or caller: %q", got)
			}
			if strings.Count(got, "\n") != 1 {
				t.Errorf("want one line, got: %q", got)
			}
		})
	}
}

// TestDebugConsoleLine checks the text printed to the console.
func TestDebugConsoleLine(t *testing.T) {
	useDebugLogger(t, true)
	var out bytes.Buffer
	log.SetOutput(&out)
	Debug("Storage", "mounting drive")
	got := out.String()
	if !strings.Contains(got, "[Storage] [DEBUG] mounting drive (goroutine ") {
		t.Errorf("unexpected console line: %q", got)
	}
}

// TestDebugJSONLine checks the console line in JSON output mode.
func TestDebugJSONLine(t *testing.T) {
	l := useDebugLogger(t, true)
	l.PrintJSON = true
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("Pipe error: %v", err)
	}
	stdout := os.Stdout
	os.Stdout = writer
	Debug("Storage", "mounting drive")
	os.Stdout = stdout
	writer.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("ReadAll error: %v", err)
	}

	var entry jsonLogEntry
	if err := json.Unmarshal(bytes.TrimSpace(data), &entry); err != nil {
		t.Fatalf("not one JSON line: %q (%v)", data, err)
	}
	if entry.Level != "debug" || entry.Title != "Storage" || entry.Message != "mounting drive" {
		t.Errorf("unexpected entry: %+v", entry)
	}
	if entry.Goroutine != goroutineID() {
		t.Errorf("goroutine = %d, want %d", entry.Goroutine, goroutineID())
	}
	if !strings.HasPrefix(entry.Caller, "logger/debug_test.go:") {
		t.Errorf("caller = %q", entry.Caller)
	}
}

// TestDebugNilLogger checks that a nil logger prints instead of panicking.
func TestDebugNilLogger(t *testing.T) {
	useDebugLogger(t, true)
	var l *Logger
	l.Debug("Storage", "no logger yet")
}

// TestDebugConcurrentWrites checks that debug lines from many goroutines
// are all written whole.
func TestDebugConcurrentWrites(t *testing.T) {
	l := useDebugLogger(t, true)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				Debugf("Storage", "worker %d step %d", i, j)
				l.Log("Storage", "info line", nil)
			}
		}(i)
	}
	wg.Wait()
	got := readLog(t, l)
	if n := strings.Count(got, " [DEBUG]worker "); n != 200 {
		t.Errorf("got %d debug lines, want 200", n)
	}
	if n := strings.Count(got, " [INFO]info line"); n != 200 {
		t.Errorf("got %d info lines, want 200", n)
	}
}

// TestParseGoroutineID reads goroutine numbers from stack trace headers.
func TestParseGoroutineID(t *testing.T) {
	tests := []struct {
		stack string
		want  uint64
	}{
		{"goroutine 1 [running]:\nmain.main()", 1},
		{"goroutine 4521 [running]:\n", 4521},
		{"goroutine 7", 0},
		{"goroutine x [running]:", 0},
		{"", 0},
		{"panic: oops", 0},
	}
	for _, tt := range tests {
		if got := parseGoroutineID([]byte(tt.stack)); got != tt.want {
			t.Errorf("parseGoroutineID(%q) = %d, want %d", tt.stack, got, tt.want)
		}
	}
}

// TestGoroutineIDDiffers checks that two goroutines get different numbers.
func TestGoroutineIDDiffers(t *testing.T) {
	mine := goroutineID()
	if mine == 0 {
		t.Fatal("goroutine id not read")
	}
	other := make(chan uint64)
	go func() { other <- goroutineID() }()
	if theirs := <-other; theirs == mine || theirs == 0 {
		t.Errorf("ids %d and %d should differ and be non zero", mine, theirs)
	}
}

// TestShortCaller keeps the last folder and the file name.
func TestShortCaller(t *testing.T) {
	tests := []struct {
		file string
		line int
		want string
	}{
		{"/build/arozos/src/mod/storage/storage.go", 57, "storage/storage.go:57"},
		{"storage.go", 9, "storage.go:9"},
		{"src/storage.go", 1, "src/storage.go:1"},
	}
	for _, tt := range tests {
		if got := shortCaller(tt.file, tt.line); got != tt.want {
			t.Errorf("shortCaller(%q, %d) = %q, want %q", tt.file, tt.line, got, tt.want)
		}
	}
}

// TestCallerOf names the line that called the function.
func TestCallerOf(t *testing.T) {
	_, _, line, _ := runtime.Caller(0)
	got := callerOf(1)
	if want := "logger/debug_test.go:" + strconv.Itoa(line+1); got != want {
		t.Errorf("callerOf(1) = %q, want %q", got, want)
	}
}

// panicWithTrace panics with value under a deferred TracePanic and returns
// what the caller recovers
func panicWithTrace(value any) (recovered any) {
	defer func() { recovered = recover() }()
	func() {
		defer TracePanic("Storage", "copying photo.jpg")
		panic(value)
	}()
	return nil
}

// TestTracePanic checks that the panic is logged when debug is on and
// passed on unchanged either way.
func TestTracePanic(t *testing.T) {
	sentinel := errors.New("nil fsh")
	for _, enabled := range []bool{true, false} {
		t.Run("debug="+strconv.FormatBool(enabled), func(t *testing.T) {
			l := useDebugLogger(t, enabled)
			if got := panicWithTrace(sentinel); got != sentinel {
				t.Fatalf("recovered %v, want the original value", got)
			}
			got := readLog(t, l)
			if !enabled {
				if got != "" {
					t.Errorf("nothing should be logged, got: %q", got)
				}
				return
			}
			if !strings.Contains(got, " [DEBUG]PANIC while copying photo.jpg: nil fsh") {
				t.Errorf("panic line missing: %q", got)
			}
			if !strings.Contains(got, "panicWithTrace") {
				t.Errorf("stack missing: %q", got)
			}
		})
	}
}

// TestTracePanicNoPanic checks that a normal return logs nothing.
func TestTracePanicNoPanic(t *testing.T) {
	l := useDebugLogger(t, true)
	func() {
		defer TracePanic("Storage", "listing a folder")
	}()
	if got := readLog(t, l); got != "" {
		t.Errorf("nothing should be logged, got: %q", got)
	}
}

// TestSlogDebugRecords checks that slog debug records follow the debug flag.
func TestSlogDebugRecords(t *testing.T) {
	useDebugLogger(t, false)
	type debugLine struct {
		title, message string
		pc             uintptr
	}
	var lines []debugLine
	h := &slogHandler{title: "SMB", emit: func(string, string, error) {
		t.Error("debug record sent as INFO")
	}, debug: func(title, message string, pc uintptr) {
		lines = append(lines, debugLine{title, message, pc})
	}}
	l := slog.New(h)

	l.Debug("dropped")
	if len(lines) != 0 || h.Enabled(context.Background(), slog.LevelDebug) {
		t.Fatal("debug records should be dropped while debug is off")
	}

	SetDebug(true)
	if !h.Enabled(context.Background(), slog.LevelDebug) {
		t.Fatal("debug records should be enabled")
	}
	l.Debug("Lease break", "file", "a.txt", "err", errors.New("timeout"))
	if len(lines) != 1 {
		t.Fatalf("got %d debug lines, want 1", len(lines))
	}
	if lines[0].title != "SMB" || lines[0].message != "Lease break file=a.txt err=timeout" {
		t.Errorf("unexpected line: %+v", lines[0])
	}
	if lines[0].pc == 0 {
		t.Error("record source missing")
	}
}

// TestSlogDebugToFile checks that NewSlog writes debug records as DEBUG
// lines naming the source line of the record.
func TestSlogDebugToFile(t *testing.T) {
	l := useDebugLogger(t, true)
	NewSlog("SMB").Debug("Opened", "share", "photos")
	got := readLog(t, l)
	if !strings.Contains(got, " [DEBUG]Opened share=photos (goroutine ") {
		t.Errorf("debug line missing: %q", got)
	}
	if !strings.Contains(got, "logger/debug_test.go:") {
		t.Errorf("record source missing: %q", got)
	}
}
