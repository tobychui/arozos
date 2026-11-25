package logger

import (
	"bytes"
	"log"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// captureStd redirects the standard logger while fn runs and returns what
// was printed.
func captureStd(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	}()
	fn()
	return buf.String()
}

func withDebug(t *testing.T, on bool) {
	t.Helper()
	prev := IsDebug()
	SetDebug(on)
	t.Cleanup(func() { SetDebug(prev) })
}

func TestDebugDroppedWhenOff(t *testing.T) {
	withDebug(t, false)
	out := captureStd(t, func() {
		Debug("Test", "hidden")
		Debugf("Test", "hidden %d", 1)
	})
	if out != "" {
		t.Fatalf("debug output printed while off: %q", out)
	}
}

func TestDebugPrintedWhenOn(t *testing.T) {
	withDebug(t, true)
	tests := []struct {
		name string
		fn   func()
		want string
	}{
		{"Debug", func() { Debug("Test", "plain") }, "[Test] [DEBUG] plain"},
		{"Debugf", func() { Debugf("Test", "n=%d s=%q", 3, "x") }, `[Test] [DEBUG] n=3 s="x"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := captureStd(t, tt.fn)
			if !strings.Contains(out, tt.want) {
				t.Errorf("got %q, want it to contain %q", out, tt.want)
			}
		})
	}
}

func TestSetDebugToggles(t *testing.T) {
	withDebug(t, false)
	if IsDebug() {
		t.Fatalf("IsDebug true after SetDebug(false)")
	}
	SetDebug(true)
	if !IsDebug() {
		t.Fatalf("IsDebug false after SetDebug(true)")
	}
}

func TestPrintAndLogDebugWritesFile(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogger("dbg", dir, true)
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer l.Close()
	captureStd(t, func() { l.PrintAndLogDebug("Test", "to file") })
	b, err := os.ReadFile(filepath.Join(dir, filepath.Base(l.CurrentLogFile)))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if !strings.Contains(string(b), "[DEBUG]to file") {
		t.Errorf("log file %q lacks the debug line", string(b))
	}
}

func TestPrintAndLogDebugNilLogger(t *testing.T) {
	var l *Logger
	out := captureStd(t, func() { l.PrintAndLogDebug("Test", "nil") })
	if !strings.Contains(out, "[DEBUG] nil") {
		t.Errorf("got %q", out)
	}
}

func TestRequestSummary(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"path only", "/system/x", "GET /system/x"},
		{"query dropped", "/system/x?token=abc", "GET /system/x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", tt.url, nil)
			if got := RequestSummary(r); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
	if got := RequestSummary(nil); got != "<nil request>" {
		t.Errorf("nil request: got %q", got)
	}
}

func TestSlogDebugFollowsSwitch(t *testing.T) {
	var got []string
	h := &slogHandler{title: "T", emit: func(string, string, error) {}, debug: func(title, message string) {
		got = append(got, message)
	}}
	l := slog.New(h)

	withDebug(t, false)
	l.Debug("off")
	SetDebug(true)
	l.Debug("on", "k", "v")
	if len(got) != 1 || got[0] != "on k=v" {
		t.Fatalf("got %q, want only the record logged while on", got)
	}
}

func TestDebugTraceSwitch(t *testing.T) {
	prevDebug, prevTrace := IsDebug(), debugTraceEnabled.Load()
	t.Cleanup(func() {
		SetDebug(prevDebug)
		debugTraceEnabled.Store(prevTrace)
	})
	tests := []struct {
		name         string
		debug, trace bool
		want         bool
	}{
		{"both off", false, false, false},
		{"debug only", true, false, false},
		{"trace implies debug", false, true, true},
		{"both on", true, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			debugTraceEnabled.Store(false)
			SetDebug(tt.debug)
			if tt.trace {
				SetDebugTrace(true)
			}
			out := captureStd(t, func() {
				DebugTrace("Test", "trace line")
				DebugTracef("Test", "trace %d", 2)
			})
			if got := strings.Contains(out, "[DEBUG] trace line") && strings.Contains(out, "[DEBUG] trace 2"); got != tt.want {
				t.Errorf("trace printed = %t, want %t (output %q)", got, tt.want, out)
			}
			if IsDebugTrace() != tt.want {
				t.Errorf("IsDebugTrace = %t, want %t", IsDebugTrace(), tt.want)
			}
		})
	}
}
