package transcoder

/*
	Transcoder.go

	This module handle real-time transcoding of media files
	that is not supported by playing on web.
*/

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

type TranscodeOutputResolution string

const (
	TranscodeResolution_360p     TranscodeOutputResolution = "360p"
	TranscodeResolution_720p     TranscodeOutputResolution = "720p"
	TranscodeResolution_1080p    TranscodeOutputResolution = "1280p"
	TranscodeResolution_original TranscodeOutputResolution = ""
)

// Transcode and stream the given file. Make sure ffmpeg is installed before calling to transcoder.
// startTime is a seek offset in seconds; pass 0 to start from the beginning.
func TranscodeAndStream(w http.ResponseWriter, r *http.Request, inputFile string, resolution TranscodeOutputResolution, startTime float64) {
	// Build the FFmpeg command based on the resolution parameter
	var cmd *exec.Cmd

	transcodeFormatArgs := []string{"-f", "mp4", "-vcodec", "libx264", "-preset", "superfast", "-g", "60", "-movflags", "frag_keyframe+empty_moov+faststart", "pipe:1"}
	var preInputArgs []string
	if startTime > 0.001 {
		preInputArgs = []string{"-ss", fmt.Sprintf("%.3f", startTime)}
	}
	var middleArgs []string
	switch resolution {
	case "360p":
		middleArgs = []string{"-i", inputFile, "-vf", "scale=-1:360"}
	case "720p":
		middleArgs = []string{"-i", inputFile, "-vf", "scale=-1:720"}
	case "1080p":
		middleArgs = []string{"-i", inputFile, "-vf", "scale=-1:1080"}
	case "":
		middleArgs = []string{"-i", inputFile}
	default:
		http.Error(w, "Invalid resolution parameter", http.StatusBadRequest)
		return
	}
	var args []string
	args = append(args, preInputArgs...)
	args = append(args, middleArgs...)
	args = append(args, transcodeFormatArgs...)
	cmd = exec.Command("ffmpeg", args...)

	// Set response headers for streaming MP4 video
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("Cache-Control", "public, max-age=3600, s-maxage=3600, must-revalidate")
	w.Header().Set("Accept-Ranges", "bytes")

	// Get the command output pipe
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "Failed to create output pipe", http.StatusInternalServerError)
		return
	}

	// Get the command error pipe to capture standard error
	stderr, err := cmd.StderrPipe()
	if err != nil {
		http.Error(w, "Failed to create error pipe", http.StatusInternalServerError)
		logger.PrintAndLog("Transcoder", fmt.Sprintf("Failed to create error pipe: %v", err), nil)
		return
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		http.Error(w, "Failed to start FFmpeg", http.StatusInternalServerError)
		return
	}

	// Buffered so both the natural-end goroutine and the client-disconnect goroutine
	// can send without blocking — only the first signal is consumed.
	done := make(chan struct{}, 2)

	// Monitor client connection close
	go func() {
		<-r.Context().Done()
		time.Sleep(300 * time.Millisecond)
		cmd.Process.Kill()
		done <- struct{}{}
	}()

	// Copy the command output to the HTTP response in a separate goroutine
	go func() {
		if _, err := io.Copy(w, stdout); err != nil {
			cmd.Process.Kill()
		}
		// Signal natural end so the handler returns and the chunked-transfer
		// terminator is flushed to the client.
		done <- struct{}{}
	}()

	// Read and log the command standard error
	go func() {
		errOutput, _ := io.ReadAll(stderr)
		if len(errOutput) > 0 {
			logger.PrintAndLog("Transcoder", fmt.Sprintf("FFmpeg error output: %s", string(errOutput)), nil)
		}
	}()

	go func() {
		if err := cmd.Wait(); err != nil {
			logger.PrintAndLog("Transcoder", fmt.Sprintf("FFmpeg process exited: %v", err), nil)
			return
		}
	}()

	// Wait for the command to finish or client disconnect
	<-done
	logger.PrintAndLog("Transcoder", "[Media Server] Transcode client disconnected", nil)
}

type TranscodeAudioSampleRate int

const (
	TranscodeAudio_16kHz TranscodeAudioSampleRate = 16000
	TranscodeAudio_24kHz TranscodeAudioSampleRate = 24000
	TranscodeAudio_48kHz TranscodeAudioSampleRate = 48000
)

// TranscodeAndStreamAudio transcodes an audio file to MP3 and streams it.
// startTime is the seek offset in seconds; pass 0 to start from the beginning.
func TranscodeAndStreamAudio(w http.ResponseWriter, r *http.Request, inputFile string, sampleRate TranscodeAudioSampleRate, startTime float64) {
	var args []string
	if startTime > 0.001 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startTime))
	}
	args = append(args,
		"-i", inputFile,
		"-vn",
		"-acodec", "libmp3lame",
		"-ar", fmt.Sprintf("%d", int(sampleRate)),
		"-b:a", "128k",
		"-f", "mp3",
		"pipe:1",
	)
	cmd := exec.Command("ffmpeg", args...)

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "Failed to create output pipe", http.StatusInternalServerError)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		http.Error(w, "Failed to create error pipe", http.StatusInternalServerError)
		return
	}
	if err := cmd.Start(); err != nil {
		http.Error(w, "Failed to start FFmpeg", http.StatusInternalServerError)
		return
	}

	// Buffered so both the natural-end goroutine and the client-disconnect goroutine
	// can send without blocking — only the first signal is consumed.
	done := make(chan struct{}, 2)

	go func() {
		<-r.Context().Done()
		time.Sleep(300 * time.Millisecond)
		cmd.Process.Kill()
		done <- struct{}{}
	}()

	go func() {
		if _, err := io.Copy(w, stdout); err != nil {
			cmd.Process.Kill()
		}
		// Signal even on a clean finish so the handler returns and the HTTP
		// chunked-transfer terminator (final zero-length frame) is flushed to
		// the client.  Without this the browser never receives EOF and the
		// audio element's 'ended' event does not fire reliably.
		done <- struct{}{}
	}()

	go func() {
		errOutput, _ := io.ReadAll(stderr)
		if len(errOutput) > 0 {
			logger.PrintAndLog("Transcoder", fmt.Sprintf("FFmpeg audio error output: %s", string(errOutput)), nil)
		}
	}()

	go func() {
		if err := cmd.Wait(); err != nil {
			logger.PrintAndLog("Transcoder", fmt.Sprintf("FFmpeg audio process exited: %v", err), nil)
		}
	}()

	<-done
	logger.PrintAndLog("Transcoder", "[Media Server] Audio transcode client disconnected", nil)
}

// GetAudioDuration returns the duration of a local audio file in seconds using ffprobe.
func GetAudioDuration(inputFile string) (float64, error) {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		inputFile,
	)
	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return 0, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	duration, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid duration value: %w", err)
	}
	return duration, nil
}
