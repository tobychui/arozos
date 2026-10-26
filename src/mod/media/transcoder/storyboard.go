package transcoder

/*
	Storyboard.go

	Generates "storyboard" sprite sheets for video scrub-bar previews: a single
	tiled JPEG holding one downscaled frame every N seconds. The player loads one
	image into memory and slices it with CSS, so hovering the timeline never has
	to hit ffmpeg — which matters because seeking a software-decoded H.265 source
	per hover would be far too slow to feel interactive.
*/

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // registers the JPEG decoder used by image.DecodeConfig
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// StoryboardCacheFolder returns the folder holding the storyboard sheet for a
// given video file.
//
// Sheets live beside the media they describe, following the same ".metadata"
// convention the thumbnail cache uses, so a storyboard travels with its video
// across the file system abstraction and disappears with the folder it belongs
// to. The trailing separator matches how the metadata package builds its own
// cache paths, so callers can concatenate a filename directly.
func StoryboardCacheFolder(videoRealPath string) string {
	return filepath.ToSlash(
		filepath.Join(filepath.Clean(filepath.Dir(videoRealPath)), "/.metadata/.storyboard/")) + "/"
}

const (
	// Tile width in pixels; height follows the source aspect ratio.
	storyboardTileWidth = 160
	// Tiles per row in the generated sheet.
	storyboardCols = 10
	// Frame budget: how many tiles we aim for regardless of clip length.
	storyboardTargetTiles = 120
	// Hard ceiling so a very long film cannot produce an enormous sheet.
	storyboardMaxTiles = 240
	// Sampling interval bounds, in seconds.
	storyboardMinInterval = 2.0
	storyboardMaxInterval = 60.0
	// Generation is capped so a pathological input cannot pin a core forever.
	storyboardTimeout = 5 * time.Minute
)

// StoryboardLayout describes the geometry of a generated sheet. The player needs
// every field to map a hovered timestamp onto the right tile.
type StoryboardLayout struct {
	Interval   float64 `json:"interval"`   // seconds represented by each tile
	Count      int     `json:"count"`      // tiles that carry a real frame
	Cols       int     `json:"cols"`       // tiles per row
	Rows       int     `json:"rows"`       // rows in the sheet
	TileWidth  int     `json:"tileWidth"`  // pixel width of one tile
	TileHeight int     `json:"tileHeight"` // pixel height of one tile
	Duration   float64 `json:"duration"`   // source duration in seconds
}

// PlanStoryboard picks the sampling interval and grid for a clip of the given
// duration.
//
// The interval scales with length so short clips get fine-grained previews and
// long ones stay within a sane sheet size: roughly storyboardTargetTiles frames,
// clamped to [storyboardMinInterval, storyboardMaxInterval], then widened again
// if the tile count would exceed storyboardMaxTiles.
//
// Kept free of ffmpeg so the sizing rules can be unit-tested directly.
func PlanStoryboard(duration float64) (StoryboardLayout, error) {
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return StoryboardLayout{}, errors.New("invalid duration")
	}

	interval := duration / storyboardTargetTiles
	if interval < storyboardMinInterval {
		interval = storyboardMinInterval
	}
	if interval > storyboardMaxInterval {
		interval = storyboardMaxInterval
	}

	count := int(math.Ceil(duration / interval))
	if count > storyboardMaxTiles {
		count = storyboardMaxTiles
		interval = duration / float64(count)
	}
	if count < 1 {
		count = 1
	}

	cols := storyboardCols
	if count < cols {
		cols = count
	}
	rows := int(math.Ceil(float64(count) / float64(cols)))

	return StoryboardLayout{
		Interval:  interval,
		Count:     count,
		Cols:      cols,
		Rows:      rows,
		TileWidth: storyboardTileWidth,
		Duration:  duration,
	}, nil
}

// GenerateStoryboard renders the sprite sheet for inputFile and returns the
// encoded JPEG together with the layout describing it.
//
// The sheet is deliberately returned as bytes rather than written to a path:
// ffmpeg can only write to a native filesystem path, but the caller may be
// serving a video that lives behind an arozfs abstraction (S3, remote mounts,
// …). Rendering into scratch space under workDir and handing the bytes back
// lets the caller store the result through whichever file system actually owns
// the video, instead of stranding it on local disk.
//
// Decoding is restricted to keyframes (-skip_frame nokey), which is what makes
// this affordable: a full decode of a two-hour software-decoded H.265 file would
// take many minutes, while a keyframe-only pass runs an order of magnitude
// faster and is more than accurate enough for thumbnails.
func GenerateStoryboard(inputFile string, workDir string, duration float64) ([]byte, StoryboardLayout, error) {
	layout, err := PlanStoryboard(duration)
	if err != nil {
		return nil, StoryboardLayout{}, err
	}

	if strings.TrimSpace(workDir) == "" {
		workDir = os.TempDir()
	}
	if err := os.MkdirAll(workDir, 0775); err != nil {
		return nil, StoryboardLayout{}, fmt.Errorf("scratch directory unavailable: %w", err)
	}

	// The .jpg suffix matters: ffmpeg picks its muxer from the output extension.
	scratch, err := os.CreateTemp(workDir, "storyboard-*.jpg")
	if err != nil {
		return nil, StoryboardLayout{}, fmt.Errorf("could not create scratch file: %w", err)
	}
	scratchPath := scratch.Name()
	scratch.Close()
	defer os.Remove(scratchPath)

	vf := fmt.Sprintf("fps=1/%.6f,scale=%d:-2,tile=%dx%d",
		layout.Interval, storyboardTileWidth, layout.Cols, layout.Rows)

	ctx, cancel := context.WithTimeout(context.Background(), storyboardTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y",
		"-skip_frame", "nokey", // decode keyframes only
		"-i", inputFile,
		"-an", "-sn", // no audio or subtitle streams
		"-vf", vf,
		"-frames:v", "1", // a single tiled sheet
		"-q:v", "5",
		scratchPath,
	)

	if out, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, StoryboardLayout{}, errors.New("storyboard generation timed out")
		}
		return nil, StoryboardLayout{}, fmt.Errorf("ffmpeg failed: %w (%s)", err, lastLines(string(out), 2))
	}

	sheet, err := os.ReadFile(scratchPath)
	if err != nil {
		return nil, StoryboardLayout{}, fmt.Errorf("storyboard not written: %w", err)
	}
	if len(sheet) == 0 {
		return nil, StoryboardLayout{}, errors.New("storyboard came out empty")
	}

	// Read the real tile height back from the sheet: it depends on the source
	// aspect ratio, which we do not know until ffmpeg has scaled a frame.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(sheet))
	if err != nil {
		return nil, StoryboardLayout{}, fmt.Errorf("unreadable storyboard: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || layout.Cols <= 0 || layout.Rows <= 0 {
		return nil, StoryboardLayout{}, errors.New("unexpected storyboard dimensions")
	}

	layout.TileWidth = cfg.Width / layout.Cols
	layout.TileHeight = cfg.Height / layout.Rows
	if layout.TileWidth <= 0 || layout.TileHeight <= 0 {
		return nil, StoryboardLayout{}, errors.New("unexpected storyboard tile size")
	}

	return sheet, layout, nil
}

// lastLines trims ffmpeg's very verbose output down to the tail, which is where
// the actual failure reason lives.
func lastLines(s string, n int) string {
	if s == "" {
		return ""
	}
	lines := []string{}
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			if i > start {
				lines = append(lines, s[start:i])
			}
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += " | "
		}
		out += l
	}
	return out
}
