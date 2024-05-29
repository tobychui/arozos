package transcoder

/*
	Transcoder.go

	This module handle real-time transcoding of media files
	that is not supported by playing on web.
*/

import (
	"io"
	"log"
	"net/http"
	"os/exec"
	"time"
)

type TranscodeOutputResolution string

const (
	TranscodeResolution_360p     TranscodeOutputResolution = "360p"
	TranscodeResolution_720p     TranscodeOutputResolution = "720p"
	TranscodeResolution_1080p    TranscodeOutputResolution = "1280p"
	TranscodeResolution_original TranscodeOutputResolution = ""
)

// Transcode and stream the given file. Make sure ffmpeg is installed before calling to transcoder.
func TranscodeAndStream(w http.ResponseWriter, r *http.Request, inputFile string, resolution TranscodeOutputResolution) {
	// Build the FFmpeg command based on the resolution parameter
	var cmd *exec.Cmd

	transcodeFormatArgs := []string{"-f", "mp4", "-vcodec", "libx264", "-preset", "superfast", "-g", "60", "-movflags", "frag_keyframe+empty_moov+faststart", "pipe:1"}
	var args []string
	switch resolution {
	case "360p":
		args = append([]string{"-i", inputFile, "-vf", "scale=-1:360"}, transcodeFormatArgs...)
	case "720p":
		args = append([]string{"-i", inputFile, "-vf", "scale=-1:720"}, transcodeFormatArgs...)
	case "1080p":
		args = append([]string{"-i", inputFile, "-vf", "scale=-1:1080"}, transcodeFormatArgs...)
	case "":
		// Original resolution
		args = append([]string{"-i", inputFile}, transcodeFormatArgs...)
	default:
		http.Error(w, "Invalid resolution parameter", http.StatusBadRequest)
		return
	}
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
		log.Printf("Failed to create error pipe: %v", err)
		return
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		http.Error(w, "Failed to start FFmpeg", http.StatusInternalServerError)
		return
	}

	// Create a channel to signal when the client disconnects
	done := make(chan struct{})

	// Monitor client connection close
	go func() {
		<-r.Context().Done()
		time.Sleep(300 * time.Millisecond)
		cmd.Process.Kill() // Kill the FFmpeg process when client disconnects
		done <- struct{}{}
		//close(done)
	}()

	// Copy the command output to the HTTP response in a separate goroutine
	go func() {
		if _, err := io.Copy(w, stdout); err != nil {
			// End of video or client disconnected
			cmd.Process.Kill()
			return
		}
	}()

	// Read and log the command standard error
	go func() {
		errOutput, _ := io.ReadAll(stderr)
		if len(errOutput) > 0 {
			log.Printf("FFmpeg error output: %s", string(errOutput))
		}
	}()

	go func() {
		if err := cmd.Wait(); err != nil {
			log.Printf("FFmpeg process exited: %v", err)
			return
		}
	}()

	// Wait for the command to finish or client disconnect
	<-done
	log.Println("[Media Server] Transcode client disconnected")
}
