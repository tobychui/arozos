package videoeditor

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/*
	Tests for the background job runner. The tests that encode need ffmpeg
	on the PATH and are skipped otherwise.
*/

func needFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath(ffmpegBinary); err != nil {
		t.Skip("ffmpeg not installed")
	}
}

// waitJob waits for a job's Finish hook and returns its error.
func waitJob(t *testing.T, done chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(60 * time.Second):
		t.Fatal("job did not finish")
		return nil
	}
}

// testsrcJob encodes seconds of a synthetic clip into dir and copies the
// result to final.
func testsrcJob(dir string, seconds string, final string, done chan error) *Job {
	return &Job{
		ProgressFile: filepath.Join(dir, "job.progress.json"),
		Prepare: func() (*Command, error) {
			return &Command{
				Args: []string{"-hide_banner", "-loglevel", "error", "-f", "lavfi",
					"-i", "testsrc=size=64x64:rate=10:duration=" + seconds, "-c:v", "libx264", "-pix_fmt", "yuv420p"},
				Output:     filepath.Join(dir, "scratch.mp4"),
				DurationMs: 1000,
			}, nil
		},
		Deliver: func(local string) error {
			data, err := os.ReadFile(local)
			if err != nil {
				return err
			}
			return os.WriteFile(final, data, 0644)
		},
		Finish: func(err error) { done <- err },
	}
}

func TestRunnerStartValidation(t *testing.T) {
	r := NewRunner(1)
	noop := func() (*Command, error) { return nil, nil }
	deliver := func(string) error { return nil }
	tests := []struct {
		name string
		job  *Job
	}{
		{"nil job", nil},
		{"no progress file", &Job{Prepare: noop, Deliver: deliver}},
		{"no prepare", &Job{ProgressFile: "p.json", Deliver: deliver}},
		{"no deliver", &Job{ProgressFile: "p.json", Prepare: noop}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.Start(tt.job); err == nil {
				t.Errorf("job must be rejected")
			}
		})
	}
}

func TestRunnerCompletesJob(t *testing.T) {
	needFFmpeg(t)
	dir := t.TempDir()
	final := filepath.Join(dir, "final.mp4")
	done := make(chan error, 1)
	r := NewRunner(1)
	job := testsrcJob(dir, "1", final, done)
	if err := r.Start(job); err != nil {
		t.Fatal(err)
	}
	if err := waitJob(t, done); err != nil {
		t.Fatalf("job failed: %v", err)
	}
	p := ReadProgress(job.ProgressFile)
	if !p.Completed || p.Stage != StageDone || p.Percentage != 100 || p.OutputSize == 0 {
		t.Errorf("progress = %+v, want a completed job", p)
	}
	if info, err := os.Stat(final); err != nil || info.Size() == 0 {
		t.Errorf("delivered output missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "scratch.mp4")); !os.IsNotExist(err) {
		t.Errorf("scratch output must be removed after delivery")
	}
	if r.Running(job.ProgressFile) {
		t.Errorf("finished job still reported as running")
	}
}

func TestRunnerReportsFFmpegError(t *testing.T) {
	needFFmpeg(t)
	dir := t.TempDir()
	done := make(chan error, 1)
	r := NewRunner(1)
	job := &Job{
		ProgressFile: filepath.Join(dir, "p.json"),
		Prepare: func() (*Command, error) {
			return &Command{Args: []string{"-hide_banner", "-i", filepath.Join(dir, "missing.mp4")}, Output: filepath.Join(dir, "o.mp4")}, nil
		},
		Deliver: func(string) error { t.Error("a failed encode must not be delivered"); return nil },
		Finish:  func(err error) { done <- err },
	}
	if err := r.Start(job); err != nil {
		t.Fatal(err)
	}
	err := waitJob(t, done)
	if err == nil || !strings.Contains(err.Error(), "missing.mp4") {
		t.Fatalf("error %v should carry ffmpeg's message", err)
	}
	p := ReadProgress(job.ProgressFile)
	if p.Stage != StageFailed || p.Completed || p.Error == "" {
		t.Errorf("progress = %+v, want a failed job with its error", p)
	}
}

func TestRunnerPrepareAndDeliverErrors(t *testing.T) {
	needFFmpeg(t)
	tests := []struct {
		name    string
		prepare bool
	}{
		{name: "prepare fails", prepare: true},
		{name: "deliver fails"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			done := make(chan error, 1)
			job := testsrcJob(dir, "0.5", filepath.Join(dir, "final.mp4"), done)
			boom := errors.New("boom")
			if tt.prepare {
				job.Prepare = func() (*Command, error) { return nil, boom }
			} else {
				job.Deliver = func(string) error { return boom }
			}
			if err := NewRunner(1).Start(job); err != nil {
				t.Fatal(err)
			}
			if err := waitJob(t, done); !errors.Is(err, boom) {
				t.Fatalf("error = %v, want %v", err, boom)
			}
			if p := ReadProgress(job.ProgressFile); p.Stage != StageFailed || p.Error != "boom" {
				t.Errorf("progress = %+v", p)
			}
		})
	}
}

func TestRunnerCancel(t *testing.T) {
	needFFmpeg(t)
	dir := t.TempDir()
	r := NewRunner(1)

	// A long job holds the only slot, so the second one stays queued
	runningDone := make(chan error, 1)
	running := testsrcJob(filepath.Join(dir), "600", filepath.Join(dir, "a.mp4"), runningDone)
	queuedDir := filepath.Join(dir, "q")
	os.MkdirAll(queuedDir, 0755)
	queuedDone := make(chan error, 1)
	queued := testsrcJob(queuedDir, "1", filepath.Join(dir, "b.mp4"), queuedDone)

	if err := r.Start(running); err != nil {
		t.Fatal(err)
	}
	if err := r.Start(running); err == nil {
		t.Error("a second job with the same progress file must be refused")
	}
	if err := r.Start(queued); err != nil {
		t.Fatal(err)
	}
	if p := ReadProgress(queued.ProgressFile); p.Stage != StageQueued {
		t.Errorf("waiting job stage = %q, want %q", p.Stage, StageQueued)
	}

	if !r.Cancel(queued.ProgressFile) {
		t.Fatal("cancel of a queued job returned false")
	}
	if err := waitJob(t, queuedDone); !errors.Is(err, ErrCancelled) {
		t.Errorf("queued job error = %v, want ErrCancelled", err)
	}

	// Let ffmpeg get going before stopping it
	deadline := time.Now().Add(20 * time.Second)
	for ReadProgress(running.ProgressFile).Stage != StageRunning && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !r.Cancel(running.ProgressFile) {
		t.Fatal("cancel of a running job returned false")
	}
	if err := waitJob(t, runningDone); !errors.Is(err, ErrCancelled) {
		t.Errorf("running job error = %v, want ErrCancelled", err)
	}
	if p := ReadProgress(running.ProgressFile); p.Stage != StageFailed || p.Error != ErrCancelled.Error() {
		t.Errorf("cancelled progress = %+v", p)
	}
	if r.Cancel(running.ProgressFile) {
		t.Error("cancel of an ended job must return false")
	}
}

func TestReadProgressStream(t *testing.T) {
	stream := "frame=1\nout_time_us=500000\nprogress=continue\nout_time_ms=1500000\nout_time_us=N/A\nprogress=end\n"
	var got []int64
	readProgressStream(strings.NewReader(stream), func(us int64) { got = append(got, us) })
	if len(got) != 2 || got[0] != 500000 || got[1] != 1500000 {
		t.Errorf("updates = %v, want [500000 1500000]", got)
	}
}

func TestPercentage(t *testing.T) {
	tests := []struct {
		name  string
		outUs int64
		durMs int64
		want  float64
	}{
		{"unknown duration", 1000000, 0, 0},
		{"not started", 0, 1000, 0},
		{"half way", 500000, 1000, 50},
		{"rounded down", 333333, 1000, 33.3},
		{"held below 100", 2000000, 1000, 99},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := percentage(tt.outUs, tt.durMs); got != tt.want {
				t.Errorf("percentage(%d, %d) = %v, want %v", tt.outUs, tt.durMs, got, tt.want)
			}
		})
	}
}

func TestProgressFileRoundTrip(t *testing.T) {
	file := filepath.Join(t.TempDir(), "p.json")
	if p := ReadProgress(file); p != (Progress{}) {
		t.Errorf("missing file must read as empty, got %+v", p)
	}
	want := Progress{OutputSize: 10, Percentage: 42.5, Stage: StageRunning}
	WriteProgress(file, want)
	if got := ReadProgress(file); got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestStderrTail(t *testing.T) {
	tail := &stderrTail{}
	tail.Write([]byte(strings.Repeat("x", stderrTailSize)))
	tail.Write([]byte("  the real reason\n"))
	got := tail.String()
	if !strings.HasSuffix(got, "the real reason") || len(got) > stderrTailSize {
		t.Errorf("tail = %q", got)
	}
}
