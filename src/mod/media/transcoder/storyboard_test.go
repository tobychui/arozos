package transcoder

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestStoryboardCacheFolder verifies sheets are cached beside the video, under
// the same ".metadata" convention the thumbnail cache uses.
func TestStoryboardCacheFolder(t *testing.T) {
	cases := []struct {
		name  string
		video string
		want  string
	}{
		{
			name:  "nested path",
			video: filepath.Join("files", "users", "bob", "Video", "show.mkv"),
			want:  "files/users/bob/Video/.metadata/.storyboard/",
		},
		{
			name:  "folder with dots in the name",
			video: filepath.Join("media", "Show.S01.1080p", "ep1.mkv"),
			want:  "media/Show.S01.1080p/.metadata/.storyboard/",
		},
		{
			name:  "file at the root of a relative path",
			video: "clip.mp4",
			want:  ".metadata/.storyboard/",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StoryboardCacheFolder(tc.video); got != tc.want {
				t.Errorf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

// TestStoryboardCacheFolder_AlwaysSlashTerminated verifies callers can append a
// filename directly, and that the result never contains backslashes so the same
// path works across the file system abstractions.
func TestStoryboardCacheFolder_AlwaysSlashTerminated(t *testing.T) {
	videos := []string{
		filepath.Join("a", "b", "c.mkv"),
		filepath.Join("a", "video.mp4"),
		"solo.webm",
	}

	for _, v := range videos {
		got := StoryboardCacheFolder(v)
		if !strings.HasSuffix(got, "/") {
			t.Errorf("%q: expected a trailing slash, got %q", v, got)
		}
		if strings.Contains(got, "\\") {
			t.Errorf("%q: expected forward slashes only, got %q", v, got)
		}
		// A bare filename has no parent, so the prefix is legitimately absent —
		// assert on the suffix, which every case must share.
		if !strings.HasSuffix(got, ".metadata/.storyboard/") {
			t.Errorf("%q: expected the metadata cache convention, got %q", v, got)
		}
	}
}

// TestPlanStoryboard_InvalidDuration verifies that non-positive or non-finite
// durations are rejected rather than producing a nonsensical grid.
func TestPlanStoryboard_InvalidDuration(t *testing.T) {
	cases := []struct {
		name     string
		duration float64
	}{
		{"zero", 0},
		{"negative", -12.5},
		{"NaN", math.NaN()},
		{"positive infinity", math.Inf(1)},
		{"negative infinity", math.Inf(-1)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := PlanStoryboard(tc.duration); err == nil {
				t.Errorf("expected an error for duration %v, got nil", tc.duration)
			}
		})
	}
}

// TestPlanStoryboard_IntervalBounds checks the sampling interval across
// realistic clip lengths.
//
// The two ceilings can conflict: past roughly four hours, honouring
// storyboardMaxInterval would need more than storyboardMaxTiles tiles. The tile
// ceiling is a hard resource bound on sheet size, so it wins and the interval is
// allowed to widen — but only in exactly that case.
func TestPlanStoryboard_IntervalBounds(t *testing.T) {
	cases := []struct {
		name     string
		duration float64
	}{
		{"ten second clip", 10},
		{"four minute music video", 243},
		{"twenty two minute episode", 1320},
		{"forty five minute episode", 2700},
		{"two hour film", 7200},
		{"six hour recording", 21600},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			layout, err := PlanStoryboard(tc.duration)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if layout.Interval < storyboardMinInterval && tc.duration > storyboardMinInterval {
				t.Errorf("interval %.3f below minimum %.3f", layout.Interval, storyboardMinInterval)
			}
			if layout.Interval > storyboardMaxInterval && layout.Count != storyboardMaxTiles {
				t.Errorf("interval %.3f exceeds maximum %.3f without hitting the %d tile ceiling (count %d)",
					layout.Interval, storyboardMaxInterval, storyboardMaxTiles, layout.Count)
			}
		})
	}
}

// TestPlanStoryboard_ShortInputsRespectIntervalCeiling verifies that anything
// short enough to fit inside the tile budget does honour the interval ceiling.
func TestPlanStoryboard_ShortInputsRespectIntervalCeiling(t *testing.T) {
	// storyboardMaxInterval * storyboardMaxTiles is the longest clip that can be
	// covered without widening the interval past its ceiling.
	longestFullyCovered := storyboardMaxInterval * float64(storyboardMaxTiles)

	for _, d := range []float64{60, 600, 3600, 7200, longestFullyCovered} {
		layout, err := PlanStoryboard(d)
		if err != nil {
			t.Fatalf("duration %.0f: unexpected error: %v", d, err)
		}
		if layout.Interval > storyboardMaxInterval+0.001 {
			t.Errorf("duration %.0f: interval %.3f exceeds maximum %.3f",
				d, layout.Interval, storyboardMaxInterval)
		}
	}
}

// TestPlanStoryboard_GridCoversWholeClip is the important invariant: the grid
// must hold at least one tile for every sampled instant, otherwise ffmpeg's tile
// filter would emit a second sheet and the tail of the video would be missing.
func TestPlanStoryboard_GridCoversWholeClip(t *testing.T) {
	durations := []float64{1, 5, 30, 243, 1320, 2700, 7200, 21600, 86400}

	for _, d := range durations {
		layout, err := PlanStoryboard(d)
		if err != nil {
			t.Fatalf("duration %.0f: unexpected error: %v", d, err)
		}
		if layout.Cols*layout.Rows < layout.Count {
			t.Errorf("duration %.0f: grid %dx%d cannot hold %d tiles",
				d, layout.Cols, layout.Rows, layout.Count)
		}
		if covered := float64(layout.Count) * layout.Interval; covered < d-0.001 {
			t.Errorf("duration %.0f: tiles cover only %.2fs", d, covered)
		}
	}
}

// TestPlanStoryboard_TileCountCeiling verifies long inputs do not blow past the
// sheet-size ceiling, and that the interval widens instead.
func TestPlanStoryboard_TileCountCeiling(t *testing.T) {
	durations := []float64{7200, 21600, 43200, 86400}

	for _, d := range durations {
		layout, err := PlanStoryboard(d)
		if err != nil {
			t.Fatalf("duration %.0f: unexpected error: %v", d, err)
		}
		if layout.Count > storyboardMaxTiles {
			t.Errorf("duration %.0f: produced %d tiles, ceiling is %d",
				d, layout.Count, storyboardMaxTiles)
		}
		if layout.Count < 1 {
			t.Errorf("duration %.0f: produced %d tiles", d, layout.Count)
		}
	}
}

// TestPlanStoryboard_ShortClipGridShrinks verifies a clip shorter than one full
// row does not claim a 10-wide grid it cannot fill.
func TestPlanStoryboard_ShortClipGridShrinks(t *testing.T) {
	layout, err := PlanStoryboard(6) // 6s at the 2s floor -> 3 tiles
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if layout.Cols > layout.Count {
		t.Errorf("expected at most %d columns, got %d", layout.Count, layout.Cols)
	}
	if layout.Rows != 1 {
		t.Errorf("expected a single row, got %d", layout.Rows)
	}
}

// TestPlanStoryboard_DurationEchoed verifies the source duration is carried
// through to the layout, since the player maps hover position against it.
func TestPlanStoryboard_DurationEchoed(t *testing.T) {
	layout, err := PlanStoryboard(1234.5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if layout.Duration != 1234.5 {
		t.Errorf("expected duration 1234.5, got %v", layout.Duration)
	}
	if layout.TileWidth != storyboardTileWidth {
		t.Errorf("expected tile width %d, got %d", storyboardTileWidth, layout.TileWidth)
	}
}

// TestGenerateStoryboard_InvalidDuration verifies the duration guard runs before
// any attempt to invoke ffmpeg, so the call is safe on hosts without it.
func TestGenerateStoryboard_InvalidDuration(t *testing.T) {
	sheet, _, err := GenerateStoryboard("nonexistent.mkv", t.TempDir(), 0)
	if err == nil {
		t.Error("expected an error for zero duration, got nil")
	}
	if sheet != nil {
		t.Errorf("expected no sheet bytes on failure, got %d", len(sheet))
	}
}

// TestGenerateStoryboard_LeavesNoScratchFiles verifies the scratch file used to
// bridge ffmpeg's native-only output is always cleaned up, including on the
// failure path where ffmpeg cannot read the input.
func TestGenerateStoryboard_LeavesNoScratchFiles(t *testing.T) {
	workDir := t.TempDir()

	// A missing input makes ffmpeg fail (or the binary may be absent entirely);
	// either way the scratch file must not be left behind.
	_, _, err := GenerateStoryboard(filepath.Join(workDir, "missing.mkv"), workDir, 120)
	if err == nil {
		t.Skip("ffmpeg unexpectedly succeeded on a missing input")
	}

	entries, readErr := os.ReadDir(workDir)
	if readErr != nil {
		t.Fatalf("could not inspect scratch dir: %v", readErr)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "storyboard-") {
			t.Errorf("scratch file %q was left behind", e.Name())
		}
	}
}

// TestGenerateStoryboard_CreatesMissingWorkDir verifies a not-yet-created
// scratch directory is created rather than failing the whole render.
func TestGenerateStoryboard_CreatesMissingWorkDir(t *testing.T) {
	workDir := filepath.Join(t.TempDir(), "nested", "scratch")

	// Duration is valid, so this proceeds past the guard and into scratch setup.
	// It then fails at ffmpeg, which is fine — we only care that the directory
	// was created rather than the call erroring out early.
	GenerateStoryboard(filepath.Join(workDir, "missing.mkv"), workDir, 120)

	if info, err := os.Stat(workDir); err != nil || !info.IsDir() {
		t.Errorf("expected the scratch directory to be created, got err=%v", err)
	}
}

// TestLastLines checks the ffmpeg stderr trimming helper.
func TestLastLines(t *testing.T) {
	cases := []struct {
		name  string
		input string
		n     int
		want  string
	}{
		{"empty", "", 2, ""},
		{"single line", "only", 2, "only"},
		{"fewer than n", "a\nb", 5, "a | b"},
		{"trims to last n", "a\nb\nc\nd", 2, "c | d"},
		{"ignores blank lines", "a\n\nb\n", 2, "a | b"},
		{"no trailing newline", "a\nb\nc", 1, "c"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lastLines(tc.input, tc.n); got != tc.want {
				t.Errorf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

// TestLastLines_NoNewlinesInOutput verifies the helper always collapses to a
// single line, so it cannot break a one-line log entry.
func TestLastLines_NoNewlinesInOutput(t *testing.T) {
	got := lastLines("first\nsecond\nthird\nfourth", 3)
	if strings.Contains(got, "\n") {
		t.Errorf("expected a single-line result, got %q", got)
	}
}
