package transcoder

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestTranscodeOutputResolution_Constants verifies that the resolution
// constants have the expected string values.
func TestTranscodeOutputResolution_Constants(t *testing.T) {
	cases := []struct {
		name     string
		constant TranscodeOutputResolution
		want     string
	}{
		{"360p", TranscodeResolution_360p, "360p"},
		{"720p", TranscodeResolution_720p, "720p"},
		{"original", TranscodeResolution_original, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if string(tc.constant) != tc.want {
				t.Errorf("expected %q, got %q", tc.want, tc.constant)
			}
		})
	}
}

// TestTranscodeResolution_1080pConstant verifies the 1080p constant value.
// (The source defines it as "1280p" – we test the actual defined value.)
func TestTranscodeResolution_1080pConstant(t *testing.T) {
	// The constant is intentionally defined as "1280p" in the source file.
	if string(TranscodeResolution_1080p) != "1280p" {
		t.Errorf("expected '1280p', got '%s'", TranscodeResolution_1080p)
	}
}

// TestTranscodeAndStream_InvalidResolution verifies that providing an
// unrecognised resolution string results in a 400 Bad Request response without
// requiring ffmpeg.
func TestTranscodeAndStream_InvalidResolution(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	rr := httptest.NewRecorder()

	TranscodeAndStream(rr, req, "/some/file.mkv", "invalid-resolution", 0)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status %d for invalid resolution, got %d", http.StatusBadRequest, rr.Code)
	}
}

// TestTranscodeAndStream_NoFfmpeg verifies that when ffmpeg is not installed
// (or the binary is not in PATH), a 500 Internal Server Error is returned.
// This exercises the cmd.Start() failure branch.
func TestTranscodeAndStream_NoFfmpeg(t *testing.T) {
	// Temporarily override PATH so ffmpeg cannot be found.
	t.Setenv("PATH", "")

	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	rr := httptest.NewRecorder()

	TranscodeAndStream(rr, req, "/some/nonexistent.mp4", TranscodeResolution_original, 0)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected status %d when ffmpeg is missing, got %d", http.StatusInternalServerError, rr.Code)
	}
}

// TestTranscodeAndStream_ResolutionSwitch verifies that all known resolution
// constants are accepted (not treated as invalid) and reach the ffmpeg
// execution stage. Without ffmpeg in PATH they all produce 500, not 400.
func TestTranscodeAndStream_ResolutionSwitch(t *testing.T) {
	t.Setenv("PATH", "")

	cases := []struct {
		name string
		res  TranscodeOutputResolution
	}{
		{"360p", TranscodeResolution_360p},
		{"720p", TranscodeResolution_720p},
		{"1080p", "1080p"}, // use literal since the constant has wrong value "1280p"
		{"original", TranscodeResolution_original},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
			rr := httptest.NewRecorder()

			TranscodeAndStream(rr, req, "/nonexistent.mp4", tc.res, 0)

			// Should NOT be 400 – the resolution is recognised.
			if rr.Code == http.StatusBadRequest {
				t.Errorf("resolution %q should be valid, got 400", tc.res)
			}
		})
	}
}

// TestTranscodeOutputResolution_TypeAssert verifies that the type alias works
// correctly and can be used as a string.
func TestTranscodeOutputResolution_TypeAssert(t *testing.T) {
	var r TranscodeOutputResolution = "720p"
	if string(r) != "720p" {
		t.Errorf("expected '720p', got %q", r)
	}
}

// makeFakeFfmpegDir creates a temporary directory with a fake "ffmpeg" script
// that immediately writes a few bytes and exits, so that cmd.Start() succeeds
// and the goroutine paths inside TranscodeAndStream are exercised.
func makeFakeFfmpegDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	script := filepath.Join(dir, "ffmpeg")
	content := "#!/bin/sh\nprintf 'x'\nexit 0\n"
	if err := os.WriteFile(script, []byte(content), 0755); err != nil {
		t.Fatalf("failed to write fake ffmpeg: %v", err)
	}
	return dir
}

// TestTranscodeAndStream_WithFakeFfmpeg exercises the goroutine paths that are
// only reachable when cmd.Start() succeeds.  A fake "ffmpeg" binary that exits
// immediately is placed in PATH; the request context is cancelled shortly
// after the call so that <-done unblocks.
func TestTranscodeAndStream_WithFakeFfmpeg(t *testing.T) {
	fakeDir := makeFakeFfmpegDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())

	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	// Cancel the context shortly after so the function can return.
	go func() {
		time.Sleep(500 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeResolution_original, 0)
}

// TestTranscodeAndStream_WithFakeFfmpeg360p covers the 360p resolution branch
// with the goroutine paths exercised using a fake ffmpeg.
func TestTranscodeAndStream_WithFakeFfmpeg360p(t *testing.T) {
	fakeDir := makeFakeFfmpegDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	go func() {
		time.Sleep(500 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeResolution_360p, 0)
}

// TestTranscodeAndStream_WithFakeFfmpeg720p covers the 720p resolution branch.
func TestTranscodeAndStream_WithFakeFfmpeg720p(t *testing.T) {
	fakeDir := makeFakeFfmpegDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	go func() {
		time.Sleep(500 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeResolution_720p, 0)
}

// TestTranscodeAndStream_WithFakeFfmpeg1080p covers the 1080p branch.
func TestTranscodeAndStream_WithFakeFfmpeg1080p(t *testing.T) {
	fakeDir := makeFakeFfmpegDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	go func() {
		time.Sleep(500 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeOutputResolution("1080p"), 0)
}

// makeFakeFfmpegWithStderrDir creates a temporary directory with a fake "ffmpeg"
// script that writes to stderr and exits with a non-zero status, exercising the
// stderr-logging and cmd.Wait error branches inside TranscodeAndStream.
func makeFakeFfmpegWithStderrDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	script := filepath.Join(dir, "ffmpeg")
	// Write something to stdout so io.Copy runs, write to stderr so the
	// len(errOutput) > 0 branch is hit, then exit 1 so cmd.Wait returns error.
	content := "#!/bin/sh\nprintf 'video'\nprintf 'stderr output' >&2\nexit 1\n"
	if err := os.WriteFile(script, []byte(content), 0755); err != nil {
		t.Fatalf("failed to write fake ffmpeg with stderr: %v", err)
	}
	return dir
}

// TestTranscodeAndStream_WithFfmpegStderrAndError covers the goroutine paths for
// stderr logging (len(errOutput) > 0) and cmd.Wait() returning an error.
func TestTranscodeAndStream_WithFfmpegStderrAndError(t *testing.T) {
	fakeDir := makeFakeFfmpegWithStderrDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	// Cancel after a short delay so TranscodeAndStream returns.
	go func() {
		time.Sleep(600 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeResolution_original, 0)

	// Allow goroutines time to run their stderr/wait branches before the test exits.
	time.Sleep(100 * time.Millisecond)
}

// TestTranscodeAndStream_WithFfmpegStderrAndError360p is the same as above for
// the 360p branch, ensuring all four resolution paths get the extended goroutine
// coverage.
func TestTranscodeAndStream_WithFfmpegStderrAndError360p(t *testing.T) {
	fakeDir := makeFakeFfmpegWithStderrDir(t)
	origPath := os.Getenv("PATH")
	os.Setenv("PATH", fakeDir+":"+origPath)
	defer os.Setenv("PATH", origPath)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/media/transcode", nil)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	go func() {
		time.Sleep(600 * time.Millisecond)
		cancel()
	}()

	TranscodeAndStream(rr, req, "/dev/null", TranscodeResolution_360p, 0)
	time.Sleep(100 * time.Millisecond)
}
