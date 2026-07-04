package ffmpegutil

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/utils"
)

/*
	FFmepg Utilities function
	for agi.ffmpeg.go


*/

// ConversionProgress holds the state of an ongoing or completed conversion.
// It is serialised as JSON and written to the caller-supplied progress file.
type ConversionProgress struct {
	InputSize      int64   `json:"input_size"`
	OutputSize     int64   `json:"output_size"`
	ConversionTime float64 `json:"conversion_time"`
	Percentage     float64 `json:"percentage"`
	Completed      bool    `json:"completed"`
}

// resolutionHeightMap maps common resolution names to their vertical pixel count.
var resolutionHeightMap = map[string]int{
	"144p":  144,
	"240p":  240,
	"360p":  360,
	"480p":  480,
	"576p":  576,
	"720p":  720,
	"1080p": 1080,
	"1440p": 1440,
	"2160p": 2160,
	"4k":    2160,
	"8k":    4320,
}

/*
ffmpeg_conv support input of a limited video, audio and image formats
Compression value can be set if compression / resize is needed.
Different conversion type have different meaning for compression values
Video -> Video | compression means resolution in scale, e.g. 720 = 720p
Video / Audio -> Audio | compression means bitrate, e.g. 128 = 128kbps
Image -> Image | compression means final width of compression e.g. 1024 * 2048 with compression value
set to 512, then the output will be 512 * 1024

Set compression to 0 if resizing / compression is not required
*/
func FFmpeg_conv(input string, output string, compression int) error {
	var cmd *exec.Cmd

	switch {
	case isVideo(input) && isVideo(output):
		// Video to video with resolution compression
		if compression == 0 {
			cmd = exec.Command("ffmpeg", "-i", input, output)
		} else {
			cmd = exec.Command("ffmpeg", "-i", input, "-vf", fmt.Sprintf("scale=-1:%d", compression), output)
		}

	case (isAudio(input) || isVideo(input)) && isAudio(output):
		// Audio or video to audio with bitrate compression
		if compression == 0 {
			cmd = exec.Command("ffmpeg", "-i", input, output)
		} else {
			cmd = exec.Command("ffmpeg", "-i", input, "-b:a", fmt.Sprintf("%dk", compression), output)
		}

	case (isImage(input) && isImage(output)) || (isVideo(input) && filepath.Ext(output) == ".gif"):
		// Resize image with width compression
		if compression == 0 {
			cmd = exec.Command("ffmpeg", "-i", input, output)
		} else {
			cmd = exec.Command("ffmpeg", "-i", input, "-vf", fmt.Sprintf("scale=%d:-1", compression), output)
		}

	default:
		// Handle other cases or leave it for the user to implement
		return fmt.Errorf("unsupported conversion: %s to %s", input, output)
	}

	// Set the output of the command to os.Stdout so you can see it in your console
	cmd.Stdout = os.Stdout

	// Set the output of the command to os.Stderr so you can see any errors
	cmd.Stderr = os.Stderr

	// Run the command
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("error running ffmpeg command: %v", err)
	}

	return nil
}

// Helper functions to check file types
func isVideo(filename string) bool {
	videoFormats := []string{
		".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm",
	}
	return utils.StringInArray(videoFormats, filepath.Ext(filename))
}

func isAudio(filename string) bool {
	audioFormats := []string{
		".mp3", ".wav", ".aac", ".ogg", ".flac",
	}
	return utils.StringInArray(audioFormats, filepath.Ext(filename))
}

func isImage(filename string) bool {
	imageFormats := []string{
		".jpg", ".png", ".gif", ".bmp", ".tiff", ".webp",
	}
	return utils.StringInArray(imageFormats, filepath.Ext(filename))
}

// isLossyImage returns true for image formats that support lossy compression.
func isLossyImage(filename string) bool {
	lossyFormats := []string{".jpg", ".jpeg", ".webp"}
	return utils.StringInArray(lossyFormats, strings.ToLower(filepath.Ext(filename)))
}

// --- Progress helpers ---

// fileSize returns the byte size of path, or 0 if the file is not accessible.
func fileSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
}

// getMediaDurationMs returns the total duration of a media file in milliseconds
// by invoking ffprobe.
func getMediaDurationMs(input string) (int64, error) {
	cmd := exec.Command("ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", input)
	output, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return 0, err
	}
	duration, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil {
		return 0, err
	}
	return int64(duration * 1000), nil
}

// writeProgressJSON writes a ConversionProgress snapshot as JSON to progressFile.
// Errors are silently ignored so that a progress-write failure never aborts a conversion.
func writeProgressJSON(progressFile string, inputSize int64, outputFile string, startTime time.Time, percentage float64, completed bool) {
	progress := ConversionProgress{
		InputSize:      inputSize,
		OutputSize:     fileSize(outputFile),
		ConversionTime: time.Since(startTime).Seconds(),
		Percentage:     percentage,
		Completed:      completed,
	}
	data, err := json.Marshal(progress)
	if err != nil {
		return
	}
	os.WriteFile(progressFile, data, 0644) //nolint:errcheck
}

// monitorFFmpegProgress reads the ffmpeg -progress pipe file every 500 ms and writes
// updated JSON to userProgressFile.  It exits when done is closed.
func monitorFFmpegProgress(ffmpegPipeFile, userProgressFile, outputFile string, inputSize, totalDurationMs int64, startTime time.Time, done <-chan struct{}) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			data, err := os.ReadFile(ffmpegPipeFile)
			if err != nil {
				continue
			}
			// Parse ffmpeg key=value progress output
			parsed := make(map[string]string)
			for _, line := range strings.Split(string(data), "\n") {
				if parts := strings.SplitN(strings.TrimSpace(line), "=", 2); len(parts) == 2 {
					parsed[parts[0]] = parts[1]
				}
			}
			// Despite the name, out_time_ms is in microseconds
			outTimeMsStr, ok := parsed["out_time_ms"]
			if !ok {
				continue
			}
			outTimeUs, err := strconv.ParseInt(outTimeMsStr, 10, 64)
			if err != nil || outTimeUs < 0 {
				continue
			}
			percentage := 0.0
			if totalDurationMs > 0 {
				percentage = math.Min(99.0, float64(outTimeUs)/float64(totalDurationMs*1000)*100.0)
			}
			writeProgressJSON(userProgressFile, inputSize, outputFile, startTime, percentage, false)
		}
	}
}

// startProgressMonitor launches the background goroutine that updates userProgressFile.
// Returns the done channel (to be closed when conversion finishes) and a WaitGroup to
// wait for the goroutine to exit before removing the pipe file.
func startProgressMonitor(ffmpegPipeFile, userProgressFile, outputFile string, inputSize, totalDurationMs int64, startTime time.Time) (chan struct{}, *sync.WaitGroup) {
	doneCh := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		monitorFFmpegProgress(ffmpegPipeFile, userProgressFile, outputFile, inputSize, totalDurationMs, startTime, doneCh)
	}()
	return doneCh, &wg
}

// stopProgressMonitor signals the goroutine to stop, waits for it, and removes the
// internal ffmpeg pipe file.  If convErr is nil it also writes the final 100 % entry.
func stopProgressMonitor(doneCh chan struct{}, wg *sync.WaitGroup, ffmpegPipeFile, userProgressFile, outputFile string, inputSize int64, startTime time.Time, convErr error) {
	close(doneCh)
	wg.Wait()
	os.Remove(ffmpegPipeFile)
	if convErr == nil {
		writeProgressJSON(userProgressFile, inputSize, outputFile, startTime, 100.0, true)
	}
}

// --- New conversion functions ---

// FFmpeg_audio_conv converts an audio (or video-to-audio) file.
//
//   - sampleRate  – target sample rate in Hz (e.g. 44100); 0 keeps the original.
//   - progressFile – real filesystem path to write JSON progress updates; "" disables tracking.
//
// The internal ffmpeg progress pipe file is cleaned up before the function returns.
func FFmpeg_audio_conv(input, output string, sampleRate int, progressFile string) error {
	startTime := time.Now()
	inputSize := fileSize(input)

	args := []string{"-i", input, "-y"}
	if sampleRate > 0 {
		args = append(args, "-ar", strconv.Itoa(sampleRate))
	}

	var doneCh chan struct{}
	var wg *sync.WaitGroup
	ffmpegPipeFile := ""
	if progressFile != "" {
		ffmpegPipeFile = progressFile + ".ffprog"
		args = append(args, "-progress", ffmpegPipeFile)
		totalDurationMs, _ := getMediaDurationMs(input)
		doneCh, wg = startProgressMonitor(ffmpegPipeFile, progressFile, output, inputSize, totalDurationMs, startTime)
		writeProgressJSON(progressFile, inputSize, output, startTime, 0.0, false)
	}

	args = append(args, output)
	cmd := exec.Command("ffmpeg", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()

	if progressFile != "" {
		stopProgressMonitor(doneCh, wg, ffmpegPipeFile, progressFile, output, inputSize, startTime, err)
	}
	if err != nil {
		return fmt.Errorf("ffmpeg audio conversion failed: %v", err)
	}
	return nil
}

// FFmpeg_image_conv converts an image file with optional uniform scaling and lossy compression.
//
//   - scaleFactor    – float multiplier applied to both dimensions (e.g. 0.5 = half size);
//     0 or 1.0 leaves the size unchanged.
//   - compressionRate – 0-100 quality-loss percentage; only applied to lossy formats
//     (JPEG, WebP); silently ignored for lossless formats (PNG, BMP, GIF, TIFF).
func FFmpeg_image_conv(input, output string, scaleFactor float64, compressionRate int) error {
	args := []string{"-i", input, "-y"}

	if scaleFactor > 0 && scaleFactor != 1.0 {
		args = append(args, "-vf", fmt.Sprintf("scale=iw*%.6g:ih*%.6g", scaleFactor, scaleFactor))
	}

	if compressionRate > 0 && isLossyImage(output) {
		ext := strings.ToLower(filepath.Ext(output))
		switch ext {
		case ".jpg", ".jpeg":
			// ffmpeg q:v: 2 (best) – 31 (worst); compressionRate 0=best, 100=worst
			q := 2 + compressionRate*29/100
			args = append(args, "-q:v", strconv.Itoa(q))
		case ".webp":
			// ffmpeg q:v: 100 (best) – 0 (worst); invert compressionRate
			q := 100 - compressionRate
			if q < 0 {
				q = 0
			}
			args = append(args, "-q:v", strconv.Itoa(q))
		}
	}

	args = append(args, output)
	cmd := exec.Command("ffmpeg", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg image conversion failed: %v", err)
	}
	return nil
}

// FFmpeg_video_conv converts a video file with optional resolution scaling, CRF compression,
// and progress tracking.
//
//   - resolution     – target height string: "144p", "240p", "360p", "480p", "576p", "720p",
//     "1080p", "1440p", "2160p", "4k", "8k"; "" keeps the original resolution.
//   - compressionRate – 0-100; mapped to CRF 1-51 (0 = use encoder default, 100 = most compressed).
//   - progressFile   – real filesystem path to write JSON progress updates; "" disables tracking.
//
// The internal ffmpeg progress pipe file is cleaned up before the function returns.
func FFmpeg_video_conv(input, output, resolution string, compressionRate int, progressFile string) error {
	startTime := time.Now()
	inputSize := fileSize(input)

	args := []string{"-i", input, "-y"}

	if resolution != "" {
		resHeight, ok := resolutionHeightMap[strings.ToLower(resolution)]
		if !ok {
			return fmt.Errorf("unsupported resolution %q (supported: 144p 240p 360p 480p 576p 720p 1080p 1440p 2160p 4k 8k)", resolution)
		}
		// -2 ensures the width is adjusted to maintain aspect ratio with an even number
		args = append(args, "-vf", fmt.Sprintf("scale=-2:%d", resHeight))
	}

	if compressionRate > 0 {
		// Map 1-100 -> CRF 1-51
		crf := 1 + compressionRate*50/100
		args = append(args, "-crf", strconv.Itoa(crf))
	}

	var doneCh chan struct{}
	var wg *sync.WaitGroup
	ffmpegPipeFile := ""
	if progressFile != "" {
		ffmpegPipeFile = progressFile + ".ffprog"
		args = append(args, "-progress", ffmpegPipeFile)
		totalDurationMs, _ := getMediaDurationMs(input)
		doneCh, wg = startProgressMonitor(ffmpegPipeFile, progressFile, output, inputSize, totalDurationMs, startTime)
		writeProgressJSON(progressFile, inputSize, output, startTime, 0.0, false)
	}

	args = append(args, output)
	cmd := exec.Command("ffmpeg", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()

	if progressFile != "" {
		stopProgressMonitor(doneCh, wg, ffmpegPipeFile, progressFile, output, inputSize, startTime, err)
	}
	if err != nil {
		return fmt.Errorf("ffmpeg video conversion failed: %v", err)
	}
	return nil
}

// FFmpeg_conv_with_progress passes the input directly to ffmpeg without any format-detection
// logic.  Suitable for cross-media-type conversions (e.g. MP4 --> GIF) or any format pair
// that FFmpeg_conv does not recognise.
//
//   - progressFile – real filesystem path to write JSON progress updates; "" disables tracking.
//
// The internal ffmpeg progress pipe file is cleaned up before the function returns.
func FFmpeg_conv_with_progress(input, output, progressFile string) error {
	startTime := time.Now()
	inputSize := fileSize(input)

	args := []string{"-i", input, "-y"}

	var doneCh chan struct{}
	var wg *sync.WaitGroup
	ffmpegPipeFile := ""
	if progressFile != "" {
		ffmpegPipeFile = progressFile + ".ffprog"
		args = append(args, "-progress", ffmpegPipeFile)
		totalDurationMs, _ := getMediaDurationMs(input)
		doneCh, wg = startProgressMonitor(ffmpegPipeFile, progressFile, output, inputSize, totalDurationMs, startTime)
		writeProgressJSON(progressFile, inputSize, output, startTime, 0.0, false)
	}

	args = append(args, output)
	cmd := exec.Command("ffmpeg", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()

	if progressFile != "" {
		stopProgressMonitor(doneCh, wg, ffmpegPipeFile, progressFile, output, inputSize, startTime, err)
	}
	if err != nil {
		return fmt.Errorf("ffmpeg conversion failed: %v", err)
	}
	return nil
}
