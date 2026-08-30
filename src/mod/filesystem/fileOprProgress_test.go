package filesystem

import (
	"bytes"
	"io"
	"strings"
	"testing"
	"time"
)

func TestProgressReporterRateLimit(t *testing.T) {
	calls := 0
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		calls++
		return FsOpr_Continue
	}, 1000)

	//An unforced burst must collapse into a single report
	for i := 0; i < 500; i++ {
		if err := reporter.report(int64(i), false); err != nil {
			t.Fatalf("report() returned error: %v", err)
		}
	}
	if calls != 1 {
		t.Errorf("handler called %d times for a burst of unforced reports, want 1", calls)
	}

	//A forced report always goes through
	if err := reporter.report(1000, true); err != nil {
		t.Fatalf("report() returned error: %v", err)
	}
	if calls != 2 {
		t.Errorf("handler called %d times after a forced report, want 2", calls)
	}
}

func TestProgressReporterCancel(t *testing.T) {
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		return FsOpr_Cancel
	}, 1000)

	err := reporter.report(0, true)
	if err == nil {
		t.Fatal("report() should return an error once the operation is cancelled")
	}
	if !reporter.cancelled {
		t.Error("the reporter should remember that the operation was cancelled")
	}

	//Every later report keeps failing without asking the handler again
	if err := reporter.report(10, true); err == nil {
		t.Error("report() should keep failing after a cancellation")
	}
}

func TestProgressReporterPause(t *testing.T) {
	signals := []int{FsOpr_Pause, FsOpr_Pause, FsOpr_Continue}
	call := 0
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		thisSignal := signals[call]
		if call < len(signals)-1 {
			call++
		}
		return thisSignal
	}, 1000)

	start := time.Now()
	if err := reporter.report(0, true); err != nil {
		t.Fatalf("report() returned error: %v", err)
	}

	//The reporter must hold the transfer until the operation is resumed
	if time.Since(start) < fileOprPauseCheckInterval {
		t.Error("report() should wait while the operation is paused")
	}
	if call != len(signals)-1 {
		t.Errorf("handler asked %d times, want it polled until the pause lifted", call+1)
	}
}

func TestProgressReaderCountsBytes(t *testing.T) {
	payload := strings.Repeat("a", 4096)
	var lastReported int64
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		lastReported = bytesDone
		return FsOpr_Continue
	}, int64(len(payload)))

	reader := newProgressReader(strings.NewReader(payload), reporter, 0)
	copied, err := io.Copy(io.Discard, reader)
	if err != nil {
		t.Fatalf("io.Copy() returned error: %v", err)
	}
	if copied != int64(len(payload)) {
		t.Errorf("copied %d bytes, want %d", copied, len(payload))
	}
	if lastReported == 0 {
		t.Error("the reader should have reported at least one position")
	}
	if lastReported > int64(len(payload)) {
		t.Errorf("reported %d bytes, more than the %d that exist", lastReported, len(payload))
	}
}

func TestProgressReaderCountsFromBase(t *testing.T) {
	payload := strings.Repeat("b", 2048)
	base := int64(10000)
	var lastReported int64
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		lastReported = bytesDone
		return FsOpr_Continue
	}, base+int64(len(payload)))

	reader := newProgressReader(strings.NewReader(payload), reporter, base)
	io.Copy(io.Discard, reader)

	if lastReported <= base {
		t.Errorf("reported %d, want a position past the %d bytes already done", lastReported, base)
	}
}

func TestProgressReaderStopsOnCancel(t *testing.T) {
	payload := bytes.Repeat([]byte("c"), 1024*1024)
	reporter := newProgressReporter(func(currentFile string, bytesDone int64, bytesTotal int64) int {
		return FsOpr_Cancel
	}, int64(len(payload)))

	reader := newProgressReader(bytes.NewReader(payload), reporter, 0)
	copied, err := io.Copy(io.Discard, reader)
	if err == nil {
		t.Fatal("io.Copy() should stop with an error once the operation is cancelled")
	}
	if copied == int64(len(payload)) {
		t.Error("the whole payload was copied, the cancellation did not stop the transfer")
	}
}

func TestNewProgressReaderWithoutHandler(t *testing.T) {
	//Nothing to report to: the reader must be handed back untouched
	source := strings.NewReader("hello")
	if got := newProgressReader(source, nil, 0); got != io.Reader(source) {
		t.Error("newProgressReader() should return the original reader when there is no reporter")
	}
	if got := newProgressReader(source, newProgressReporter(nil, 0), 0); got != io.Reader(source) {
		t.Error("newProgressReader() should return the original reader when there is no handler")
	}
}

func TestLegacyProgressAdapter(t *testing.T) {
	tests := []struct {
		name       string
		bytesDone  int64
		bytesTotal int64
		want       int
	}{
		{"nothing done", 0, 1000, 0},
		{"half way", 500, 1000, 50},
		{"all done", 1000, 1000, 100},
		{"unknown total", 500, 0, 0},
		{"more than the total", 1500, 1000, 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := -1
			adapter := legacyProgressAdapter(func(progress int, filename string) int {
				got = progress
				return FsOpr_Continue
			})
			adapter("testfile", tt.bytesDone, tt.bytesTotal)
			if got != tt.want {
				t.Errorf("percentage = %d, want %d", got, tt.want)
			}
		})
	}

	if legacyProgressAdapter(nil) != nil {
		t.Error("legacyProgressAdapter(nil) should stay nil so the reader is not wrapped")
	}
}
