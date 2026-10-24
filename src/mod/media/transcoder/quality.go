package transcoder

/*
	quality.go

	Output quality presets for the video transcoder.

	The player offers the familiar 360p to 1080p ladder. Each step is a bounding
	box the picture is fitted into plus a bitrate ceiling, so choosing a lower
	quality really does cost less bandwidth rather than only fewer pixels. The
	source resolution (an empty resolution) keeps the encoder's own defaults,
	which is how every transcode behaved before the ladder existed.
*/

import (
	"errors"
	"fmt"
	"strings"
)

type qualityPreset struct {
	long    int // long side of the bounding box, in pixels
	short   int // short side of the bounding box, in pixels
	maxRate int // peak video bitrate, in kbit/s
}

var qualityPresets = map[TranscodeOutputResolution]qualityPreset{
	TranscodeResolution_360p:  {long: 640, short: 360, maxRate: 800},
	TranscodeResolution_480p:  {long: 854, short: 480, maxRate: 1400},
	TranscodeResolution_720p:  {long: 1280, short: 720, maxRate: 2800},
	TranscodeResolution_1080p: {long: 1920, short: 1080, maxRate: 5000},
}

// ParseTranscodeResolution maps a request parameter onto a known resolution.
// Anything unrecognised means the source resolution, matching the behaviour the
// transcode endpoints have always had for an unknown value.
func ParseTranscodeResolution(value string) TranscodeOutputResolution {
	resolution := TranscodeOutputResolution(strings.ToLower(strings.TrimSpace(value)))
	if _, ok := qualityPresets[resolution]; ok {
		return resolution
	}
	return TranscodeResolution_original
}

// resolutionScaleFilter returns the ffmpeg scale filter for a resolution, or ""
// for the source resolution.
//
// The picture is fitted into the preset's box turned to match the source, so a
// portrait clip at 720p comes out 720 wide rather than 720 tall, and a 2.4:1
// film at 1080p keeps its full 1920 width. It is never enlarged, and both sides
// are rounded down to even numbers, which yuv420p requires (libx264 rejects an
// odd width outright). This is spelt out as expressions rather than with
// force_original_aspect_ratio / force_divisible_by because the latter needs
// ffmpeg 4.3, newer than several distributions still ship.
func resolutionScaleFilter(resolution TranscodeOutputResolution) (string, error) {
	if resolution == TranscodeResolution_original {
		return "", nil
	}
	preset, ok := qualityPresets[resolution]
	if !ok {
		return "", errors.New("invalid resolution parameter")
	}
	factor := fmt.Sprintf("min(1,min(%d/max(iw,ih),%d/min(iw,ih)))", preset.long, preset.short)
	return fmt.Sprintf("scale=w='trunc(%s*iw/2)*2':h='trunc(%s*ih/2)*2'", factor, factor), nil
}

// rateControlArgs caps the video bitrate of a resized transcode; the source
// resolution gets none and keeps the encoder defaults.
//
// libx264 stays on constant quality and only falls back to the ceiling where a
// scene needs more than it allows. Hardware encoders share no common quality
// mode, so they get a target bitrate under the same ceiling instead.
func rateControlArgs(resolution TranscodeOutputResolution, hardware bool) []string {
	preset, ok := qualityPresets[resolution]
	if !ok {
		return nil
	}
	maxRate := fmt.Sprintf("%dk", preset.maxRate)
	bufSize := fmt.Sprintf("%dk", preset.maxRate*2)
	if hardware {
		return []string{"-b:v", fmt.Sprintf("%dk", preset.maxRate*3/4), "-maxrate", maxRate, "-bufsize", bufSize}
	}
	return []string{"-crf", "23", "-maxrate", maxRate, "-bufsize", bufSize}
}
