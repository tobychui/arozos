package ffmpegutil

import (
	"testing"
)

func TestIsVideo(t *testing.T) {
	// Test case 1: .mp4 extension
	if !isVideo("video.mp4") {
		t.Error("Test case 1 failed. .mp4 should be recognized as video")
	}

	// Test case 2: .mkv extension
	if !isVideo("video.mkv") {
		t.Error("Test case 2 failed. .mkv should be recognized as video")
	}

	// Test case 3: .avi extension
	if !isVideo("video.avi") {
		t.Error("Test case 3 failed. .avi should be recognized as video")
	}

	// Test case 4: .mov extension
	if !isVideo("video.mov") {
		t.Error("Test case 4 failed. .mov should be recognized as video")
	}

	// Test case 5: .flv extension
	if !isVideo("video.flv") {
		t.Error("Test case 5 failed. .flv should be recognized as video")
	}

	// Test case 6: .webm extension
	if !isVideo("video.webm") {
		t.Error("Test case 6 failed. .webm should be recognized as video")
	}

	// Test case 7: Non-video extension
	if isVideo("document.pdf") {
		t.Error("Test case 7 failed. .pdf should not be recognized as video")
	}

	// Test case 8: Audio file
	if isVideo("audio.mp3") {
		t.Error("Test case 8 failed. .mp3 should not be recognized as video")
	}

	// Test case 9: Image file
	if isVideo("image.jpg") {
		t.Error("Test case 9 failed. .jpg should not be recognized as video")
	}

	// Test case 10: Case sensitivity - uppercase extension
	if isVideo("video.MP4") {
		t.Error("Test case 10 failed. Should be case sensitive")
	}

	// Test case 11: File with path
	if !isVideo("/path/to/video.mp4") {
		t.Error("Test case 11 failed. Should recognize video in path")
	}

	// Test case 12: Nested path
	if !isVideo("/deep/nested/path/to/video.mkv") {
		t.Error("Test case 12 failed. Should recognize video in nested path")
	}

	// Test case 13: No extension
	if isVideo("videofile") {
		t.Error("Test case 13 failed. File without extension should not be recognized")
	}

	// Test case 14: Empty string
	if isVideo("") {
		t.Error("Test case 14 failed. Empty string should not be recognized as video")
	}

	// Test case 15: Multiple dots in filename
	if !isVideo("my.video.file.mp4") {
		t.Error("Test case 15 failed. Should recognize video with multiple dots")
	}

	// Test case 16: Hidden file
	if !isVideo(".hidden.mp4") {
		t.Error("Test case 16 failed. Should recognize hidden video file")
	}
}

func TestIsAudio(t *testing.T) {
	// Test case 1: .mp3 extension
	if !isAudio("audio.mp3") {
		t.Error("Test case 1 failed. .mp3 should be recognized as audio")
	}

	// Test case 2: .wav extension
	if !isAudio("audio.wav") {
		t.Error("Test case 2 failed. .wav should be recognized as audio")
	}

	// Test case 3: .aac extension
	if !isAudio("audio.aac") {
		t.Error("Test case 3 failed. .aac should be recognized as audio")
	}

	// Test case 4: .ogg extension
	if !isAudio("audio.ogg") {
		t.Error("Test case 4 failed. .ogg should be recognized as audio")
	}

	// Test case 5: .flac extension
	if !isAudio("audio.flac") {
		t.Error("Test case 5 failed. .flac should be recognized as audio")
	}

	// Test case 6: Non-audio extension
	if isAudio("document.pdf") {
		t.Error("Test case 6 failed. .pdf should not be recognized as audio")
	}

	// Test case 7: Video file
	if isAudio("video.mp4") {
		t.Error("Test case 7 failed. .mp4 should not be recognized as audio")
	}

	// Test case 8: Image file
	if isAudio("image.jpg") {
		t.Error("Test case 8 failed. .jpg should not be recognized as audio")
	}

	// Test case 9: Case sensitivity - uppercase extension
	if isAudio("audio.MP3") {
		t.Error("Test case 9 failed. Should be case sensitive")
	}

	// Test case 10: File with path
	if !isAudio("/path/to/audio.mp3") {
		t.Error("Test case 10 failed. Should recognize audio in path")
	}

	// Test case 11: Nested path
	if !isAudio("/deep/nested/path/to/audio.flac") {
		t.Error("Test case 11 failed. Should recognize audio in nested path")
	}

	// Test case 12: No extension
	if isAudio("audiofile") {
		t.Error("Test case 12 failed. File without extension should not be recognized")
	}

	// Test case 13: Empty string
	if isAudio("") {
		t.Error("Test case 13 failed. Empty string should not be recognized as audio")
	}

	// Test case 14: Multiple dots in filename
	if !isAudio("my.audio.file.wav") {
		t.Error("Test case 14 failed. Should recognize audio with multiple dots")
	}

	// Test case 15: Hidden file
	if !isAudio(".hidden.mp3") {
		t.Error("Test case 15 failed. Should recognize hidden audio file")
	}
}

func TestIsImage(t *testing.T) {
	// Test case 1: .jpg extension
	if !isImage("image.jpg") {
		t.Error("Test case 1 failed. .jpg should be recognized as image")
	}

	// Test case 2: .png extension
	if !isImage("image.png") {
		t.Error("Test case 2 failed. .png should be recognized as image")
	}

	// Test case 3: .gif extension
	if !isImage("image.gif") {
		t.Error("Test case 3 failed. .gif should be recognized as image")
	}

	// Test case 4: .bmp extension
	if !isImage("image.bmp") {
		t.Error("Test case 4 failed. .bmp should be recognized as image")
	}

	// Test case 5: .tiff extension
	if !isImage("image.tiff") {
		t.Error("Test case 5 failed. .tiff should be recognized as image")
	}

	// Test case 6: .webp extension
	if !isImage("image.webp") {
		t.Error("Test case 6 failed. .webp should be recognized as image")
	}

	// Test case 7: Non-image extension
	if isImage("document.pdf") {
		t.Error("Test case 7 failed. .pdf should not be recognized as image")
	}

	// Test case 8: Video file
	if isImage("video.mp4") {
		t.Error("Test case 8 failed. .mp4 should not be recognized as image")
	}

	// Test case 9: Audio file
	if isImage("audio.mp3") {
		t.Error("Test case 9 failed. .mp3 should not be recognized as image")
	}

	// Test case 10: Case sensitivity - uppercase extension
	if isImage("image.JPG") {
		t.Error("Test case 10 failed. Should be case sensitive")
	}

	// Test case 11: File with path
	if !isImage("/path/to/image.jpg") {
		t.Error("Test case 11 failed. Should recognize image in path")
	}

	// Test case 12: Nested path
	if !isImage("/deep/nested/path/to/image.png") {
		t.Error("Test case 12 failed. Should recognize image in nested path")
	}

	// Test case 13: No extension
	if isImage("imagefile") {
		t.Error("Test case 13 failed. File without extension should not be recognized")
	}

	// Test case 14: Empty string
	if isImage("") {
		t.Error("Test case 14 failed. Empty string should not be recognized as image")
	}

	// Test case 15: Multiple dots in filename
	if !isImage("my.image.file.png") {
		t.Error("Test case 15 failed. Should recognize image with multiple dots")
	}

	// Test case 16: Hidden file
	if !isImage(".hidden.jpg") {
		t.Error("Test case 16 failed. Should recognize hidden image file")
	}

	// Test case 17: SVG (not in supported list)
	if isImage("vector.svg") {
		t.Error("Test case 17 failed. .svg should not be in supported image formats")
	}
}

func TestMediaTypeDetection(t *testing.T) {
	// Test case 1: Same file tested as different types
	filename := "media.mp4"
	if !isVideo(filename) {
		t.Error("Test case 1a failed. .mp4 should be video")
	}
	if isAudio(filename) {
		t.Error("Test case 1b failed. .mp4 should not be audio")
	}
	if isImage(filename) {
		t.Error("Test case 1c failed. .mp4 should not be image")
	}

	// Test case 2: Audio file exclusivity
	audioFile := "song.mp3"
	if isVideo(audioFile) {
		t.Error("Test case 2a failed. .mp3 should not be video")
	}
	if !isAudio(audioFile) {
		t.Error("Test case 2b failed. .mp3 should be audio")
	}
	if isImage(audioFile) {
		t.Error("Test case 2c failed. .mp3 should not be image")
	}

	// Test case 3: Image file exclusivity
	imageFile := "photo.jpg"
	if isVideo(imageFile) {
		t.Error("Test case 3a failed. .jpg should not be video")
	}
	if isAudio(imageFile) {
		t.Error("Test case 3b failed. .jpg should not be audio")
	}
	if !isImage(imageFile) {
		t.Error("Test case 3c failed. .jpg should be image")
	}

	// Test case 4: GIF as both video and image context
	gifFile := "animation.gif"
	if isVideo(gifFile) {
		t.Error("Test case 4a failed. .gif should not be classified as video")
	}
	if !isImage(gifFile) {
		t.Error("Test case 4b failed. .gif should be classified as image")
	}

	// Test case 5: Unknown file type
	unknownFile := "data.xyz"
	if isVideo(unknownFile) || isAudio(unknownFile) || isImage(unknownFile) {
		t.Error("Test case 5 failed. Unknown extension should not match any type")
	}
}
