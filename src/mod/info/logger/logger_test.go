package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
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

/*
	DEBUG level
*/

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
			if !strings.Contains(got, "(goroutine "+strconv.FormatUint(goroutineID(), 10)+", logger/logger_test.go:") {
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
	if !strings.HasPrefix(entry.Caller, "logger/logger_test.go:") {
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
	if want := "logger/logger_test.go:" + strconv.Itoa(line+1); got != want {
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
	if !strings.Contains(got, "logger/logger_test.go:") {
		t.Errorf("record source missing: %q", got)
	}
}

// TestDebugDepth checks that a logging helper built on DebugDepth names the
// line that called the helper, not the helper itself.
func TestDebugDepth(t *testing.T) {
	l := useDebugLogger(t, true)
	helper := func(message string) {
		DebugDepth(1, "Storage", message)
	}
	_, _, line, _ := runtime.Caller(0)
	helper("through a helper") //Called one line below runtime.Caller
	got := readLog(t, l)
	want := "logger/logger_test.go:" + strconv.Itoa(line+1) + ")"
	if !strings.Contains(got, " [DEBUG]through a helper") || !strings.Contains(got, want) {
		t.Errorf("want the message and %q, got %q", want, got)
	}
}

// TestTracePanicHandler checks that the wrapper is only added in debug mode,
// that a request panic is logged and passed on, and that an aborted response
// is not logged.
func TestTracePanicHandler(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		value   any
		logged  bool
	}{
		{"debug off", false, "nil map", false},
		{"debug on", true, "nil map", true},
		{"aborted response", true, http.ErrAbortHandler, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := useDebugLogger(t, tt.enabled)
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic(tt.value) })
			h := TracePanicHandler("HTTP", inner)
			var got any
			func() {
				defer func() { got = recover() }()
				h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/system/file_system/fileOpr", nil))
			}()
			if got != tt.value {
				t.Errorf("panic value = %v, want %v passed on", got, tt.value)
			}
			content := readLog(t, l)
			logged := strings.Contains(content, "PANIC while serving POST /system/file_system/fileOpr: ")
			if logged != tt.logged {
				t.Errorf("logged = %v, want %v; log: %q", logged, tt.logged, content)
			}
		})
	}
}

// TestTracePanicHandlerPassThrough checks that a request that does not panic
// is served normally.
func TestTracePanicHandlerPassThrough(t *testing.T) {
	useDebugLogger(t, true)
	h := TracePanicHandler("HTTP", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
}

// TestEnableCrashLog checks that the crash log is created in the log folder
// with a start marker, and that a logger without a folder is refused.
func TestEnableCrashLog(t *testing.T) {
	t.Cleanup(func() { debug.SetCrashOutput(nil, debug.CrashOptions{}) })
	tests := []struct {
		name    string
		logger  *Logger
		wantErr bool
	}{
		{"no logger", nil, true},
		{"no folder", &Logger{}, true},
		{"file logger", &Logger{Prefix: "system", LogFolder: t.TempDir()}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path, err := tt.logger.EnableCrashLog()
			if (err != nil) != tt.wantErr {
				t.Fatalf("EnableCrashLog() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if filepath.Base(path) != "system_crash.log" {
				t.Errorf("crash log path = %s", path)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("ReadFile error: %v", err)
			}
			if !strings.Contains(string(data), "ArozOS started") {
				t.Errorf("start marker missing: %q", data)
			}
		})
	}
}

// tracedOpen stands for a file operation that traces its panics lazily
func tracedOpen(path string, user *string, fail bool) {
	defer TracePanicFunc("SMB", func() string { return "opening " + path + " for " + *user })
	if fail {
		panic("disk gone")
	}
}

// TestTracePanicFunc checks that the description is only built for a panic
// that is logged, that a description that panics itself is reported in its
// place, and that the panic goes on unchanged.
func TestTracePanicFunc(t *testing.T) {
	user := "alice"
	tests := []struct {
		name    string
		enabled bool
		user    *string
		want    string
	}{
		{"debug off", false, &user, ""},
		{"debug on", true, &user, "PANIC while opening a.txt for alice: disk gone"},
		{"description panics", true, nil, "PANIC while <description failed: runtime error: invalid memory address or nil pointer dereference>: disk gone"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := useDebugLogger(t, tt.enabled)
			var got any
			func() {
				defer func() { got = recover() }()
				tracedOpen("a.txt", tt.user, true)
			}()
			if got != "disk gone" {
				t.Errorf("panic value = %v, want it passed on unchanged", got)
			}
			content := readLog(t, l)
			if tt.want == "" && content != "" {
				t.Errorf("expected nothing logged, got %q", content)
			}
			if tt.want != "" && !strings.Contains(content, tt.want) {
				t.Errorf("%q missing from %q", tt.want, content)
			}
		})
	}
}

// TestTracePanicFuncNoPanic checks that a call that returns normally never
// builds its description, even with debug on, and a nil one is fine.
func TestTracePanicFuncNoPanic(t *testing.T) {
	l := useDebugLogger(t, true)
	built := false
	func() {
		defer TracePanicFunc("SMB", func() string { built = true; return "x" })
	}()
	func() {
		defer TracePanicFunc("SMB", nil)
	}()
	if built {
		t.Error("description built for a call that did not panic")
	}
	if content := readLog(t, l); content != "" {
		t.Errorf("expected nothing logged, got %q", content)
	}
}

// TestTracePanicFuncAllocations checks that with debug off a traced call
// allocates nothing for its description, unlike a built TracePanic string.
func TestTracePanicFuncAllocations(t *testing.T) {
	useDebugLogger(t, false)
	user := strings.Repeat("u", 8)
	path := strings.Repeat("p", 8)
	lazy := testing.AllocsPerRun(200, func() { tracedOpen(path, &user, false) })
	if lazy != 0 {
		t.Errorf("TracePanicFunc call allocates %v times with debug off, want 0", lazy)
	}
	eager := testing.AllocsPerRun(200, func() {
		func() {
			defer TracePanic("SMB", "opening "+path+" for "+user)
		}()
	})
	if eager == 0 {
		t.Log("the compiler no longer allocates a built TracePanic string either")
	}
}

// TestDescribeSafely checks the guard around descriptions.
func TestDescribeSafely(t *testing.T) {
	tests := []struct {
		name     string
		describe func() string
		want     string
	}{
		{"plain", func() string { return "copying a" }, "copying a"},
		{"nil", nil, "<no description>"},
		{"panics", func() string { panic("bad field") }, "<description failed: bad field>"},
	}
	for _, tt := range tests {
		if got := describeSafely(tt.describe); got != tt.want {
			t.Errorf("%s: describeSafely() = %q, want %q", tt.name, got, tt.want)
		}
	}
}

// TestEnableCrashLogRotates checks that a crash log over the limit is moved
// to .1 at startup, replacing an older one, and a small one is kept.
func TestEnableCrashLogRotates(t *testing.T) {
	t.Cleanup(func() { debug.SetCrashOutput(nil, debug.CrashOptions{}) })
	tests := []struct {
		name        string
		size        int
		wantRotated bool
	}{
		{"small log kept", 100, false},
		{"large log rotated", crashLogMaxBytes + 1, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "system_crash.log")
			os.WriteFile(path, bytes.Repeat([]byte("x"), tt.size), 0644)
			os.WriteFile(path+".1", []byte("older"), 0644)
			if _, err := (&Logger{Prefix: "system", LogFolder: dir}).EnableCrashLog(); err != nil {
				t.Fatalf("EnableCrashLog() error: %v", err)
			}
			current, _ := os.ReadFile(path)
			older, _ := os.ReadFile(path + ".1")
			if tt.wantRotated {
				if len(older) != tt.size || bytes.Contains(current, []byte("xxxx")) {
					t.Errorf("not rotated: current %d bytes, .1 %d bytes", len(current), len(older))
				}
			} else if string(older) != "older" || len(current) < tt.size {
				t.Errorf("rotated a small log: current %d bytes, .1 %q", len(current), older)
			}
			if !bytes.Contains(current, []byte("ArozOS started")) {
				t.Errorf("start marker missing from the current log")
			}
		})
	}
}

// crashBystander is a goroutine that is not the one crashing; the crash log
// must show its stack too
func crashBystander(started chan bool) {
	started <- true
	select {}
}

// TestCrashLogHasEveryGoroutine crashes a child copy of this test binary and
// checks that its crash log holds the panic and the stack of a goroutine
// other than the crashing one.
func TestCrashLogHasEveryGoroutine(t *testing.T) {
	if dir := os.Getenv("AROZOS_CRASH_LOG_CHILD"); dir != "" {
		if _, err := (&Logger{Prefix: "system", LogFolder: dir}).EnableCrashLog(); err != nil {
			os.Exit(3)
		}
		started := make(chan bool)
		go crashBystander(started)
		<-started
		go func() { panic("crash log test") }()
		select {}
	}
	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestCrashLogHasEveryGoroutine$")
	env := []string{"AROZOS_CRASH_LOG_CHILD=" + dir}
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "GOTRACEBACK=") {
			env = append(env, kv)
		}
	}
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("the child did not crash: %s", out)
	}
	data, err := os.ReadFile(filepath.Join(dir, "system_crash.log"))
	if err != nil {
		t.Fatalf("no crash log: %v", err)
	}
	for _, want := range []string{"ArozOS started", "panic: crash log test", "crashBystander"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("%q missing from the crash log:\n%s", want, data)
		}
	}
}

// TestDebugCallerLine checks that every Debug function names the exact line
// that called it.
func TestDebugCallerLine(t *testing.T) {
	tests := []struct {
		name string
		log  func(l *Logger) int
	}{
		{"Debug", func(l *Logger) int { _, _, line, _ := runtime.Caller(0); Debug("T", "m"); return line }},
		{"Debugf", func(l *Logger) int { _, _, line, _ := runtime.Caller(0); Debugf("T", "%s", "m"); return line }},
		{"DebugDepth", func(l *Logger) int { _, _, line, _ := runtime.Caller(0); DebugDepth(0, "T", "m"); return line }},
		{"method", func(l *Logger) int { _, _, line, _ := runtime.Caller(0); l.Debug("T", "m"); return line }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := useDebugLogger(t, true)
			line := tt.log(l)
			want := "logger/logger_test.go:" + strconv.Itoa(line) + ")"
			if got := readLog(t, l); !strings.Contains(got, want) {
				t.Errorf("want caller %q in %q", want, got)
			}
		})
	}
}

// TestDebugOffGuardAllocations checks why a hot path puts its debug line
// behind DebugEnabled(): with debug off the guarded line allocates nothing,
// while the bare call still boxes its arguments.
func TestDebugOffGuardAllocations(t *testing.T) {
	useDebugLogger(t, false)
	p, user := strings.Repeat("p", 8), strings.Repeat("u", 8)
	guarded := testing.AllocsPerRun(200, func() {
		if DebugEnabled() {
			Debugf("SMB", "Open(%q) for %q", p, user)
		}
	})
	if guarded != 0 {
		t.Errorf("guarded debug line allocates %v times with debug off, want 0", guarded)
	}
	bare := testing.AllocsPerRun(200, func() { Debugf("SMB", "Open(%q) for %q", p, user) })
	if bare == 0 {
		t.Log("the compiler no longer boxes the arguments of a bare Debugf call")
	}
}
