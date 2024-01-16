package ffmpegutil

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"imuslab.com/arozos/mod/utils"
)

/*
	FFmepg Utilities function
	for agi.ffmpeg.go


*/

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
