package logger

import (
	"context"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"testing"
)

// withDebugMode sets debug mode for one test and restores it afterwards.
func withDebugMode(t *testing.T, enabled bool) {
	t.Helper()
	before := IsDebugMode()
	SetDebugMode(enabled)
	t.Cleanup(func() { SetDebugMode(before) })
}

// withFileLogger makes a file-backed logger the default for one test.
func withFileLogger(t *testing.T) *Logger {
	t.Helper()
	l, err := NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	before := defaultLogger
	SetDefaultLogger(l)
	t.Cleanup(func() {
		SetDefaultLogger(before)
		l.Close()
	})
	return l
}

func readLog(t *testing.T, l *Logger) string {
	t.Helper()
	data, err := os.ReadFile(l.CurrentLogFile)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	return string(data)
}

// TestSetDebugMode checks that the switch is reported back.
func TestSetDebugMode(t *testing.T) {
	for _, enabled := range []bool{true, false, true} {
		withDebugMode(t, enabled)
		if IsDebugMode() != enabled {
			t.Errorf("IsDebugMode() = %v after SetDebugMode(%v)", IsDebugMode(), enabled)
		}
	}
}

// TestDebugWrittenOnlyInDebugMode checks that Debug and Debugf write a
// [DEBUG] line with the goroutine id when debug mode is on, and nothing when
// it is off. The line must be in the file as soon as the call returns.
func TestDebugWrittenOnlyInDebugMode(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		log     func()
		want    string
	}{
		{"debug off", false, func() { Debug("Storage", "mounting disk") }, ""},
		{"debugf off", false, func() { Debugf("Storage", "mounting %s", "disk") }, ""},
		{"debug on", true, func() { Debug("Storage", "mounting disk") }, "mounting disk"},
		{"debugf on", true, func() { Debugf("Storage", "mounting %s on %d", "disk", 3) }, "mounting disk on 3"},
	}
	line := regexp.MustCompile(`\|Storage +\[DEBUG\]\[g\d+\] (.*)\n`)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugMode(t, tt.enabled)
			l := withFileLogger(t)
			tt.log()
			content := readLog(t, l)
			if tt.want == "" {
				if content != "" {
					t.Errorf("expected an empty log, got %q", content)
				}
				return
			}
			m := line.FindStringSubmatch(content)
			if m == nil {
				t.Fatalf("no debug line in %q", content)
			}
			if m[1] != tt.want {
				t.Errorf("message = %q, want %q", m[1], tt.want)
			}
		})
	}
}

// countingStringer counts how often it was formatted.
type countingStringer struct{ calls *int }

func (c countingStringer) String() string {
	*c.calls++
	return "formatted"
}

// TestDebugfSkipsFormattingWhenOff checks that the arguments of Debugf are
// not formatted while debug mode is off, so debug calls are cheap.
func TestDebugfSkipsFormattingWhenOff(t *testing.T) {
	tests := []struct {
		enabled bool
		want    int
	}{
		{false, 0},
		{true, 1},
	}
	for _, tt := range tests {
		withDebugMode(t, tt.enabled)
		withFileLogger(t)
		calls := 0
		Debugf("Storage", "value %v", countingStringer{&calls})
		if calls != tt.want {
			t.Errorf("debug=%v: formatted %d times, want %d", tt.enabled, calls, tt.want)
		}
	}
}

// TestDebugKeepsOtherLevels checks that turning debug mode on does not change
// how INFO and ERROR lines are written.
func TestDebugKeepsOtherLevels(t *testing.T) {
	withDebugMode(t, true)
	l := withFileLogger(t)
	l.Log("Storage", "info line", nil)
	l.Log("Storage", "error line", os.ErrNotExist)
	content := readLog(t, l)
	for _, want := range []string{"[INFO]info line\n", "[ERROR]error line " + os.ErrNotExist.Error() + "\n"} {
		if !strings.Contains(content, want) {
			t.Errorf("expected %q in %q", want, content)
		}
	}
}

// TestDebugNilLogger checks that Debug on a logger that is not set up yet
// does not panic.
func TestDebugNilLogger(t *testing.T) {
	withDebugMode(t, true)
	var l *Logger
	l.Debug("Storage", "early record")
}

// TestTracePanic checks that a panic is logged with its stack in debug mode,
// passed on with the same value, and left alone when debug mode is off.
func TestTracePanic(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		logged  bool
	}{
		{"debug off", false, false},
		{"debug on", true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugMode(t, tt.enabled)
			l := withFileLogger(t)
			var got interface{}
			func() {
				defer func() { got = recover() }()
				func() {
					defer TracePanic("Storage", "listing disk S1")
					panic("index out of range")
				}()
			}()
			if got != "index out of range" {
				t.Errorf("panic value = %v, want it passed on unchanged", got)
			}
			content := readLog(t, l)
			logged := strings.Contains(content, "PANIC while listing disk S1: index out of range")
			if logged != tt.logged {
				t.Errorf("panic logged = %v, want %v; log: %q", logged, tt.logged, content)
			}
			if tt.logged && !strings.Contains(content, "TestTracePanic") {
				t.Errorf("expected the stack in the log, got %q", content)
			}
		})
	}
}

// TestTracePanicNoPanic checks that TracePanic is harmless when nothing panics.
func TestTracePanicNoPanic(t *testing.T) {
	withDebugMode(t, true)
	l := withFileLogger(t)
	func() {
		defer TracePanic("Storage", "nothing")
	}()
	if content := readLog(t, l); content != "" {
		t.Errorf("expected an empty log, got %q", content)
	}
}

// TestGoroutineID checks that the id is a number and differs per goroutine.
func TestGoroutineID(t *testing.T) {
	digits := regexp.MustCompile(`^\d+$`)
	mine := goroutineID()
	if !digits.MatchString(mine) {
		t.Fatalf("goroutineID() = %q, want digits", mine)
	}
	other := make(chan string)
	go func() { other <- goroutineID() }()
	if theirs := <-other; theirs == mine {
		t.Errorf("two goroutines share id %s", mine)
	}
}

// TestSlogDebugRouting checks that slog debug records reach the DEBUG level
// only while debug mode is on.
func TestSlogDebugRouting(t *testing.T) {
	tests := []struct {
		enabled bool
		want    []string
	}{
		{false, nil},
		{true, []string{`lease break share=photos err="i/o timeout"`}},
	}
	for _, tt := range tests {
		withDebugMode(t, tt.enabled)
		var got []string
		h := &slogHandler{
			title: "SMB",
			emit:  func(string, string, error) { t.Error("debug record sent to PrintAndLog") },
			debug: func(title, message string) { got = append(got, message) },
		}
		l := slog.New(h)
		if h.Enabled(context.Background(), slog.LevelDebug) != tt.enabled {
			t.Errorf("debug=%v: Enabled(debug) = %v", tt.enabled, !tt.enabled)
		}
		l.Debug("lease break", "share", "photos", "err", os.ErrDeadlineExceeded)
		if len(got) != len(tt.want) {
			t.Fatalf("debug=%v: got %v, want %v", tt.enabled, got, tt.want)
		}
		for i := range got {
			if got[i] != tt.want[i] {
				t.Errorf("debug=%v: message = %q, want %q", tt.enabled, got[i], tt.want[i])
			}
		}
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

// TestDebugConsoleLine checks the console form of a debug record, in text and
// in JSON.
func TestDebugConsoleLine(t *testing.T) {
	tests := []struct {
		name string
		json bool
		want *regexp.Regexp
	}{
		{"text", false, regexp.MustCompile(`^\S+ \S+ \[Storage\] \[DEBUG\] \[g\d+\] mounting disk\n$`)},
		{"json", true, regexp.MustCompile(`^\{"time":"[^"]+","level":"debug","title":"Storage","message":"\[g\d+\] mounting disk"\}\n$`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugMode(t, true)
			out := captureStdout(t, func() {
				(&Logger{PrintJSON: tt.json}).Debug("Storage", "mounting disk")
			})
			if !tt.want.MatchString(out) {
				t.Errorf("console line = %q", out)
			}
		})
	}
}

// captureStdout returns what fn printed to STDOUT and through the log package.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Pipe error: %v", err)
	}
	stdout := os.Stdout
	os.Stdout = w
	log.SetOutput(w)
	defer func() {
		os.Stdout = stdout
		log.SetOutput(os.Stderr)
	}()
	fn()
	w.Close()
	data, _ := io.ReadAll(r)
	return string(data)
}

// TestTracePanicHandler checks that the wrapper is only added in debug mode,
// that a request panic is logged and passed on, and that an aborted response
// is not logged.
func TestTracePanicHandler(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		value   interface{}
		logged  bool
	}{
		{"debug off", false, "nil map", false},
		{"debug on", true, "nil map", true},
		{"aborted response", true, http.ErrAbortHandler, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugMode(t, tt.enabled)
			l := withFileLogger(t)
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic(tt.value) })
			h := TracePanicHandler("HTTP", inner)
			var got interface{}
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
	withDebugMode(t, true)
	h := TracePanicHandler("HTTP", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
}
