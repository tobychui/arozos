package videoeditor

/*
	probe.go

	The few facts about a media file the renderer needs from ffprobe.
*/

import (
	"os/exec"
	"strconv"
	"strings"
)

const (
	ffmpegBinary  = "ffmpeg"
	ffprobeBinary = "ffprobe"
)

// MediaDurationMs returns the duration of a media file in milliseconds, or
// 0 when ffprobe cannot tell (the job's percentage then stays at 0 until it
// completes).
func MediaDurationMs(input string) int64 {
	out, err := exec.Command(ffprobeBinary, "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", input).Output()
	if err != nil {
		return 0
	}
	return parseDurationMs(string(out))
}

// parseDurationMs turns ffprobe's "12.345000" into 12345; anything it cannot
// read is 0.
func parseDurationMs(s string) int64 {
	sec, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || sec <= 0 {
		return 0
	}
	return int64(sec * 1000)
}

// HasAudioStream reports whether a media file carries at least one audio
// stream (screen recordings, animations and silent footage do not). When
// ffprobe cannot tell, the error is returned together with true so callers
// keep treating the file as they would have without asking.
func HasAudioStream(input string) (bool, error) {
	out, err := exec.Command(ffprobeBinary, "-v", "error", "-select_streams", "a",
		"-show_entries", "stream=index", "-of", "csv=p=0", input).Output()
	if err != nil {
		return true, err
	}
	return strings.TrimSpace(string(out)) != "", nil
}

// DropSilentAudio removes the audio clips whose source has no audio stream.
// The editor lists an audio clip for every video clip, but ffmpeg refuses a
// filter graph that selects a stream which is not there. hasAudio is asked
// once per file; a file it cannot judge keeps its clips.
func DropSilentAudio(clips []AudioClip, hasAudio func(string) (bool, error)) []AudioClip {
	verdict := map[string]bool{}
	kept := make([]AudioClip, 0, len(clips))
	for _, clip := range clips {
		ok, seen := verdict[clip.Src]
		if !seen {
			var err error
			ok, err = hasAudio(clip.Src)
			if err != nil {
				ok = true
			}
			verdict[clip.Src] = ok
		}
		if ok {
			kept = append(kept, clip)
		}
	}
	return kept
}
