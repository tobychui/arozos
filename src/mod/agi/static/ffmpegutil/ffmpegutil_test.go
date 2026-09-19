package ffmpegutil

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/*
	Tests for the conversion job registry that backs CancelConversion.

	These tests never invoke ffmpeg itself; they spawn the test binary as a
	helper child process so the registry can be exercised on every platform
	the project builds for.
*/

// TestMain lets the test binary double as the long-running helper process.
func TestMain(m *testing.M) {
	if os.Getenv("FFMPEGUTIL_HELPER_SLEEP") == "1" {
		time.Sleep(30 * time.Second)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// startHelperProcess launches a child process that stays alive until killed.
func startHelperProcess(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=TestNothingToRun")
	cmd.Env = append(os.Environ(), "FFMPEGUTIL_HELPER_SLEEP=1")
	if err := cmd.Start(); err != nil {
		t.Fatalf("unable to start helper process: %v", err)
	}
	return cmd
}

func TestConversionJobKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"empty stays empty", "", ""},
		{"already clean", "/tmp/aroz/task.progress.json", "/tmp/aroz/task.progress.json"},
		{"redundant separators", "/tmp//aroz/./task.progress.json", "/tmp/aroz/task.progress.json"},
		{"parent traversal resolved", "/tmp/aroz/sub/../task.progress.json", "/tmp/aroz/task.progress.json"},
		{"relative path", "aroz/task.progress.json", "aroz/task.progress.json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := conversionJobKey(tt.input); got != tt.want {
				t.Errorf("conversionJobKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestConversionJobKeyMatchesNativeSeparator(t *testing.T) {
	// A path built with the platform separator must produce the same key as the
	// slash-separated form, so a job started on Windows can still be cancelled.
	native := filepath.Join("tmp", "ffmpeg_factory", "abc.progress.json")
	want := "tmp/ffmpeg_factory/abc.progress.json"
	if got := conversionJobKey(native); got != want {
		t.Errorf("conversionJobKey(%q) = %q, want %q", native, got, want)
	}
}

func TestCancelConversionUnknownJob(t *testing.T) {
	tests := []struct {
		name        string
		progressFil string
	}{
		{"empty key", ""},
		{"never registered", "/tmp/ffmpeg_factory/not-a-real-task.progress.json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if CancelConversion(tt.progressFil) {
				t.Errorf("CancelConversion(%q) = true, want false", tt.progressFil)
			}
			if ConversionIsRunning(tt.progressFil) {
				t.Errorf("ConversionIsRunning(%q) = true, want false", tt.progressFil)
			}
		})
	}
}

func TestRegisterAndUnregisterConversion(t *testing.T) {
	key := filepath.Join(t.TempDir(), "task.progress.json")
	cmd := startHelperProcess(t)
	defer func() {
		cmd.Process.Kill() //nolint:errcheck
		cmd.Wait()         //nolint:errcheck
	}()

	if ConversionIsRunning(key) {
		t.Fatalf("job reported as running before it was registered")
	}

	registerConversion(key, cmd)
	if !ConversionIsRunning(key) {
		t.Errorf("ConversionIsRunning(%q) = false after registering, want true", key)
	}

	// The same path in a non-normalised form must resolve to the same job
	messy := filepath.Join(filepath.Dir(key), "sub", "..", "task.progress.json")
	if !ConversionIsRunning(messy) {
		t.Errorf("ConversionIsRunning(%q) = false, want true (key normalisation failed)", messy)
	}

	unregisterConversion(key)
	if ConversionIsRunning(key) {
		t.Errorf("ConversionIsRunning(%q) = true after unregistering, want false", key)
	}
}

func TestRegisterConversionIgnoresIncompleteJobs(t *testing.T) {
	tests := []struct {
		name string
		key  string
		cmd  *exec.Cmd
	}{
		{"empty key", "", &exec.Cmd{}},
		{"nil command", filepath.Join(t.TempDir(), "nil.progress.json"), nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			registerConversion(tt.key, tt.cmd)
			if ConversionIsRunning(tt.key) {
				t.Errorf("ConversionIsRunning(%q) = true, want false", tt.key)
			}
		})
	}
}

func TestCancelConversionKillsRunningJob(t *testing.T) {
	key := filepath.Join(t.TempDir(), "running.progress.json")
	cmd := startHelperProcess(t)

	waitErr := make(chan error, 1)
	registerConversion(key, cmd)
	go func() { waitErr <- cmd.Wait() }()

	if !CancelConversion(key) {
		t.Fatalf("CancelConversion(%q) = false, want true", key)
	}

	select {
	case err := <-waitErr:
		if err == nil {
			t.Errorf("cancelled process exited without error, want a kill error")
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("cancelled process did not exit within 5s")
	}

	unregisterConversion(key)

	// A second cancel of the same job must report that nothing was running
	if CancelConversion(key) {
		t.Errorf("CancelConversion(%q) = true on an already cancelled job, want false", key)
	}
}

func TestRequiresEvenDimensions(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   bool
	}{
		{"mp4 output", "out.mp4", true},
		{"mkv output uppercase", "OUT.MKV", true},
		{"mov output", "clip.mov", true},
		{"gif output", "anim.gif", false},
		{"mp3 output", "song.mp3", false},
		{"no extension", "output", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := requiresEvenDimensions(tt.output); got != tt.want {
				t.Errorf("requiresEvenDimensions(%q) = %v, want %v", tt.output, got, tt.want)
			}
		})
	}
}

// TestVideoScaleFilterWithResolution checks the named-resolution branch, which
// never needs to probe the source file.
func TestVideoScaleFilterWithResolution(t *testing.T) {
	tests := []struct {
		name       string
		resolution string
		want       string
		wantErr    bool
	}{
		{"720p", "720p", "scale=-2:720", false},
		{"case insensitive 4K", "4K", "scale=-2:2160", false},
		{"8k", "8k", "scale=-2:4320", false},
		{"unsupported resolution", "999p", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := videoScaleFilter("input.webm", "output.mp4", tt.resolution)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("videoScaleFilter(%q) expected an error, got filter %q", tt.resolution, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("videoScaleFilter(%q) returned unexpected error: %v", tt.resolution, err)
			}
			if got != tt.want {
				t.Errorf("videoScaleFilter(%q) = %q, want %q", tt.resolution, got, tt.want)
			}
		})
	}
}

// TestVideoScaleFilterUnprobeableSource checks the fallback used when ffprobe
// cannot measure the source: even-only containers still get the rounding filter
// (a no-op for even sized frames) while other containers get none.
func TestVideoScaleFilterUnprobeableSource(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist.webm")

	tests := []struct {
		name   string
		output string
		want   string
	}{
		{"even only container", "output.mp4", evenDimensionFilter},
		{"gif output needs no rounding", "output.gif", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := videoScaleFilter(missing, tt.output, "")
			if err != nil {
				t.Fatalf("videoScaleFilter returned unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("videoScaleFilter(%q) = %q, want %q", tt.output, got, tt.want)
			}
		})
	}
}

// TestGetVideoDimensionsInvalidFile ensures a missing or non-video file is
// reported as an error instead of returning bogus dimensions.
func TestGetVideoDimensionsInvalidFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "not-a-video.webm")
	if w, h, err := getVideoDimensions(missing); err == nil {
		t.Errorf("getVideoDimensions(%q) = (%d, %d), want an error", missing, w, h)
	}
}

/* ---------- asynchronous job helpers ---------- */

func TestRunWithProgressRequiresProgressFile(t *testing.T) {
	if err := RunWithProgress([]string{"-i", "x"}, "y", 0, ""); err == nil {
		t.Fatal("RunWithProgress must refuse to run without a progress file")
	}
}

func TestProgressStageLifecycle(t *testing.T) {
	dir := t.TempDir()
	progress := filepath.Join(dir, "job.progress.json")
	output := filepath.Join(dir, "out.bin")

	// Nothing written yet: an empty snapshot, never an error
	if got := ReadProgress(progress); got.Stage != "" || got.Completed {
		t.Fatalf("empty progress file should read as zero value, got %+v", got)
	}

	WriteProgressStage(progress, StageQueued)
	if got := ReadProgress(progress); got.Stage != StageQueued {
		t.Fatalf("stage not recorded: %+v", got)
	}

	// A periodic monitor write keeps the stage
	writeProgressJSON(progress, 10, output, time.Now(), 42, false)
	got := ReadProgress(progress)
	if got.Stage != StageQueued || got.Percentage != 42 {
		t.Fatalf("monitor write must keep the stage and record the percentage: %+v", got)
	}

	if err := os.WriteFile(output, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	MarkProgressCompleted(progress, output)
	got = ReadProgress(progress)
	if !got.Completed || got.Percentage != 100 || got.Stage != StageDone || got.OutputSize != 10 {
		t.Fatalf("completion not recorded: %+v", got)
	}

	MarkProgressFailed(progress, os.ErrNotExist)
	got = ReadProgress(progress)
	if got.Completed || got.Stage != StageFailed || got.Error == "" {
		t.Fatalf("failure not recorded: %+v", got)
	}
	MarkProgressFailed(progress, nil)
	if got := ReadProgress(progress); got.Error != "unknown error" {
		t.Fatalf("nil error should still leave a message: %+v", got)
	}
}

func TestMediaDurationMsUnprobeable(t *testing.T) {
	if got := MediaDurationMs(filepath.Join(t.TempDir(), "missing.mp4")); got != 0 {
		t.Fatalf("MediaDurationMs on a missing file = %d, want 0", got)
	}
}

// TestStderrTail keeps only the end of a long ffmpeg message.
func TestStderrTail(t *testing.T) {
	tail := &stderrTail{}
	if tail.String() != "" {
		t.Fatalf("empty tail = %q", tail.String())
	}
	tail.Write([]byte("first line\n"))
	tail.Write([]byte(strings.Repeat("x", stderrTailSize)))
	tail.Write([]byte("\nStream specifier ':a' matches no streams\n"))
	got := tail.String()
	if len(got) > stderrTailSize {
		t.Errorf("tail is %d bytes, want at most %d", len(got), stderrTailSize)
	}
	if !strings.HasSuffix(got, "matches no streams") {
		t.Errorf("tail lost the end of the message: %q", got)
	}
	if strings.Contains(got, "first line") {
		t.Errorf("tail kept the start of the message: %q", got)
	}
}

// TestRunWithProgressReportsFFmpegMessage makes ffmpeg fail and checks that
// the returned error says why, not only that it exited non-zero.
func TestRunWithProgressReportsFFmpegMessage(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	missing := filepath.Join(dir, "no_such_input.mp4")
	args := []string{"-hide_banner", "-loglevel", "error", "-i", missing}
	err := RunWithProgress(args, filepath.Join(dir, "out.mp4"), 0, filepath.Join(dir, "job.progress.json"))
	if err == nil {
		t.Fatal("expected ffmpeg to fail on a missing input")
	}
	if !strings.Contains(err.Error(), "no_such_input.mp4") {
		t.Errorf("error should carry ffmpeg's own message, got: %v", err)
	}
}

// TestHasAudioStream checks the audio probe against real files: a clip with
// a sound track, a silent one, and a file ffprobe cannot read at all (which
// must fall back to "has audio" so existing behaviour is kept).
func TestHasAudioStream(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}
	dir := t.TempDir()
	withAudio := filepath.Join(dir, "with_audio.mp4")
	silent := filepath.Join(dir, "silent.mp4")
	gen := func(out string, extra ...string) {
		args := []string{"-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=1"}
		args = append(args, extra...)
		args = append(args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", out)
		if err := exec.Command("ffmpeg", args...).Run(); err != nil {
			t.Fatalf("could not generate %s: %v", out, err)
		}
	}
	gen(withAudio, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac")
	gen(silent)

	tests := []struct {
		name    string
		file    string
		want    bool
		wantErr bool
	}{
		{name: "video with sound", file: withAudio, want: true},
		{name: "silent video", file: silent, want: false},
		{name: "unreadable file keeps audio", file: filepath.Join(dir, "missing.mp4"), want: true, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := HasAudioStream(tc.file)
			if got != tc.want {
				t.Errorf("HasAudioStream(%s) = %v, want %v", tc.name, got, tc.want)
			}
			if (err != nil) != tc.wantErr {
				t.Errorf("HasAudioStream(%s) error = %v, wantErr %v", tc.name, err, tc.wantErr)
			}
		})
	}
}

// TestRunWithProgressWithFFmpeg encodes a synthetic clip through the generic
// runner and checks that the job is registered while it runs and that the
// caller stays in charge of the completion flag.
func TestRunWithProgressWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	progress := filepath.Join(dir, "job.progress.json")
	output := filepath.Join(dir, "out.mp4")
	args := []string{"-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=1",
		"-c:v", "libx264", "-pix_fmt", "yuv420p"}
	if err := RunWithProgress(args, output, 1000, progress); err != nil {
		t.Fatalf("RunWithProgress failed: %v", err)
	}
	if st, err := os.Stat(output); err != nil || st.Size() == 0 {
		t.Fatalf("output not written: %v", err)
	}
	if ConversionIsRunning(progress) {
		t.Fatal("job must be unregistered once ffmpeg exits")
	}
	if got := ReadProgress(progress); got.Completed {
		t.Fatalf("runner must not mark the job completed by itself: %+v", got)
	}
	if _, err := os.Stat(progress + ".ffprog"); !os.IsNotExist(err) {
		t.Fatal("ffmpeg pipe file should be removed")
	}
	if err := RunWithProgress([]string{"-i", filepath.Join(dir, "missing.mp4")}, output, 0, progress); err == nil {
		t.Fatal("a failing ffmpeg run must be reported")
	}
}
