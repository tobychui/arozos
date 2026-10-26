package ffmpegutil

import (
	"os"
	"os/exec"
	"path/filepath"
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
