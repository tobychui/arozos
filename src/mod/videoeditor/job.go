package videoeditor

/*
	job.go

	Background render jobs. A timeline render or a proxy can run far longer
	than any request, so a Runner starts it, returns at once and reports on
	it through a JSON progress file:

	  queued -> running -> uploading -> done
	                 \___________\______> failed

	"completed" only turns true once the result is in its final place, so a
	poller can trust the output the moment it sees it. At most a fixed
	number of encodes run at once; the rest wait as "queued". Any job,
	queued or running, can be stopped with Cancel.

	The Runner only knows local paths. Where the inputs come from and where
	the output goes (virtual file systems, permissions) is the caller's
	business, handled in Job.Prepare and Job.Deliver.
*/

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Job stages, reported in Progress.Stage.
const (
	StageQueued    = "queued"
	StageRunning   = "running"
	StageUploading = "uploading"
	StageDone      = "done"
	StageFailed    = "failed"
)

// ErrCancelled is the error of a job stopped through Runner.Cancel.
var ErrCancelled = errors.New("cancelled")

// Progress is the content of a job's progress file.
type Progress struct {
	OutputSize     int64   `json:"output_size"`
	ConversionTime float64 `json:"conversion_time"` // seconds since the encode started
	Percentage     float64 `json:"percentage"`
	Completed      bool    `json:"completed"`
	Stage          string  `json:"stage"`
	Error          string  `json:"error,omitempty"`
}

// Command is one ffmpeg run: Args without the output file, the local
// Output path ffmpeg writes to, and the expected output length for the
// percentage (0 when unknown).
type Command struct {
	Args       []string
	Output     string
	DurationMs int64
}

// Job is one unit of background work.
type Job struct {
	// ProgressFile is a local path; it also identifies the job for Cancel.
	ProgressFile string

	// Prepare runs once the job has an encoder slot and returns the ffmpeg
	// run, for instance after copying remote inputs to local disk.
	Prepare func() (*Command, error)

	// Deliver moves the finished Command.Output into its final place. The
	// Runner removes Command.Output afterwards.
	Deliver func(localOutput string) error

	// Finish, when set, runs after the job has ended whatever the outcome;
	// err is ErrCancelled for a cancelled job.
	Finish func(err error)
}

// Runner runs jobs in the background.
type Runner struct {
	slots   chan struct{}
	mu      sync.Mutex
	running map[string]context.CancelFunc
}

// NewRunner returns a Runner encoding at most maxConcurrent jobs at once.
func NewRunner(maxConcurrent int) *Runner {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Runner{
		slots:   make(chan struct{}, maxConcurrent),
		running: map[string]context.CancelFunc{},
	}
}

// Start queues a job and returns at once. It fails when a job with the same
// progress file is still queued or running.
func (r *Runner) Start(job *Job) error {
	if job == nil || job.ProgressFile == "" {
		return errors.New("progress file not provided")
	}
	if job.Prepare == nil || job.Deliver == nil {
		return errors.New("job has nothing to run")
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	if _, busy := r.running[job.ProgressFile]; busy {
		r.mu.Unlock()
		cancel()
		return errors.New("a job with this progress file is already running")
	}
	r.running[job.ProgressFile] = cancel
	r.mu.Unlock()

	WriteProgress(job.ProgressFile, Progress{Stage: StageQueued})
	go r.run(ctx, cancel, job)
	return nil
}

// Running reports whether a job with this progress file is queued or running.
func (r *Runner) Running(progressFile string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.running[progressFile]
	return ok
}

// Cancel stops the job with this progress file. It returns false when no
// such job is queued or running.
func (r *Runner) Cancel(progressFile string) bool {
	r.mu.Lock()
	cancel, ok := r.running[progressFile]
	r.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (r *Runner) run(ctx context.Context, cancel context.CancelFunc, job *Job) {
	err := r.execute(ctx, job)
	if err != nil && ctx.Err() != nil {
		err = ErrCancelled
	}
	cancel()

	r.mu.Lock()
	delete(r.running, job.ProgressFile)
	r.mu.Unlock()

	if err != nil {
		p := ReadProgress(job.ProgressFile)
		p.Completed = false
		p.Stage = StageFailed
		p.Error = err.Error()
		WriteProgress(job.ProgressFile, p)
	}
	if job.Finish != nil {
		job.Finish(err)
	}
}

func (r *Runner) execute(ctx context.Context, job *Job) error {
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return ErrCancelled
	}

	cmd, err := job.Prepare()
	if err != nil {
		return err
	}
	if cmd == nil || cmd.Output == "" {
		return errors.New("job produced no command")
	}
	defer os.Remove(cmd.Output)

	if err := runFFmpeg(ctx, cmd, job.ProgressFile); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ErrCancelled
	}
	info, err := os.Stat(cmd.Output)
	if err != nil {
		return errors.New("ffmpeg produced no output")
	}

	p := ReadProgress(job.ProgressFile)
	p.Stage = StageUploading
	WriteProgress(job.ProgressFile, p)
	if err := job.Deliver(cmd.Output); err != nil {
		return err
	}

	p.OutputSize = info.Size()
	p.Percentage = 100
	p.Completed = true
	p.Stage = StageDone
	p.Error = ""
	WriteProgress(job.ProgressFile, p)
	return nil
}

// runFFmpeg runs one encode, turning ffmpeg's -progress output into
// progress file updates.
func runFFmpeg(ctx context.Context, c *Command, progressFile string) error {
	args := append([]string{}, c.Args...)
	args = append(args, "-y", "-nostats", "-progress", "pipe:1", c.Output)
	cmd := exec.CommandContext(ctx, ffmpegBinary, args...)
	tail := &stderrTail{}
	cmd.Stderr = tail
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}

	start := time.Now()
	WriteProgress(progressFile, Progress{Stage: StageRunning})
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("unable to start ffmpeg: %v", err)
	}
	readProgressStream(stdout, func(outUs int64) {
		WriteProgress(progressFile, Progress{
			OutputSize:     fileSize(c.Output),
			ConversionTime: time.Since(start).Seconds(),
			Percentage:     percentage(outUs, c.DurationMs),
			Stage:          StageRunning,
		})
	})
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ErrCancelled
		}
		if msg := tail.String(); msg != "" {
			return fmt.Errorf("ffmpeg failed: %v: %s", err, msg)
		}
		return fmt.Errorf("ffmpeg failed: %v", err)
	}
	return nil
}

// readProgressStream parses ffmpeg's -progress key=value blocks and calls
// update with the output position (microseconds) at the end of each block.
func readProgressStream(r io.Reader, update func(outUs int64)) {
	var outUs int64
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		key, value, ok := strings.Cut(strings.TrimSpace(scanner.Text()), "=")
		if !ok {
			continue
		}
		switch key {
		case "out_time_us", "out_time_ms": // both are microseconds
			if v, err := strconv.ParseInt(value, 10, 64); err == nil && v >= 0 {
				outUs = v
			}
		case "progress":
			update(outUs)
		}
	}
}

// percentage of the output written so far, held below 100 until the job
// is really done.
func percentage(outUs int64, durationMs int64) float64 {
	if durationMs <= 0 || outUs <= 0 {
		return 0
	}
	pct := float64(outUs) / 10 / float64(durationMs)
	if pct > 99 {
		pct = 99
	}
	return float64(int(pct*10)) / 10
}

// ReadProgress returns the last snapshot of a job, or an empty one when the
// file does not exist yet.
func ReadProgress(progressFile string) Progress {
	var p Progress
	if data, err := os.ReadFile(progressFile); err == nil {
		json.Unmarshal(data, &p) //nolint:errcheck
	}
	return p
}

// WriteProgress replaces a job's progress file.
func WriteProgress(progressFile string, p Progress) {
	data, err := json.Marshal(p)
	if err != nil {
		return
	}
	os.WriteFile(progressFile, data, 0644) //nolint:errcheck
}

func fileSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
}

// stderrTail keeps the end of ffmpeg's stderr so a failed job can say why.
type stderrTail struct {
	mu  sync.Mutex
	buf []byte
}

const stderrTailSize = 400

func (t *stderrTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > stderrTailSize {
		t.buf = t.buf[len(t.buf)-stderrTailSize:]
	}
	return len(p), nil
}

func (t *stderrTail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}
