package nightly

import (
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/info/logger"
)

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebugMode(enabled)
	t.Cleanup(func() {
		logger.SetDebugMode(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return func() string {
		data, err := os.ReadFile(l.CurrentLogFile)
		if err != nil {
			t.Fatalf("ReadFile error: %v", err)
		}
		return string(data)
	}
}

// sampleNightlyTask is a named function to register in the tests below.
func sampleNightlyTask() {}

// TestTaskName checks how a nightly task is named in debug records.
func TestTaskName(t *testing.T) {
	tests := []struct {
		name   string
		option TaskOption
		task   func()
		want   string
	}{
		{"named option", TaskOption{Name: "trash cleanup"}, sampleNightlyTask, "trash cleanup"},
		{"function name", TaskOption{}, sampleNightlyTask, "nightly.sampleNightlyTask"},
		{"nil task", TaskOption{}, nil, "<nil task>"},
	}
	for _, tt := range tests {
		if got := taskName(tt.option, tt.task); !strings.HasSuffix(got, tt.want) {
			t.Errorf("%s: taskName() = %q, want it to end with %q", tt.name, got, tt.want)
		}
	}
}

// TestNightlyRunDebugTrace checks that a nightly run records each task as it
// starts and finishes, and a skipped one.
func TestNightlyRunDebugTrace(t *testing.T) {
	read := captureDebug(t, true)
	tm := &TaskManager{}
	tm.RegisterNightlyTaskWithOption(TaskOption{Name: "version cleanup"}, func() {})
	tm.RegisterNightlyTaskWithOption(TaskOption{Name: "cluster sweep", MasterNodeOnly: true}, func() {})
	tm.SetMasterNodeResolver(func() bool { return false })
	tm.NightlyTaskRun()
	log := read()
	for _, want := range []string{
		"running 2 nightly task(s)",
		"starting version cleanup",
		"finished version cleanup",
		"skipping cluster sweep, it belongs to the cluster master node",
		"nightly tasks done",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("%q missing from %q", want, log)
		}
	}
}
