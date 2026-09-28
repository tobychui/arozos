package videoeditor

import (
	"errors"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestParseDurationMs(t *testing.T) {
	tests := []struct {
		in   string
		want int64
	}{
		{"12.345000\n", 12345},
		{"0.5", 500},
		{"N/A", 0},
		{"", 0},
		{"-3", 0},
	}
	for _, tt := range tests {
		if got := parseDurationMs(tt.in); got != tt.want {
			t.Errorf("parseDurationMs(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestDropSilentAudio(t *testing.T) {
	clips := []AudioClip{
		{ID: "a", Src: "/m/with.mp4"},
		{ID: "b", Src: "/m/silent.mkv"},
		{ID: "c", Src: "/m/with.mp4"},
		{ID: "d", Src: "/m/unknown.mov"},
		{ID: "e", Src: "/m/silent.mkv"},
	}
	calls := map[string]int{}
	hasAudio := func(src string) (bool, error) {
		calls[src]++
		switch src {
		case "/m/silent.mkv":
			return false, nil
		case "/m/unknown.mov":
			return true, errors.New("ffprobe unavailable")
		}
		return true, nil
	}

	got := DropSilentAudio(clips, hasAudio)
	ids := ""
	for _, c := range got {
		ids += c.ID
	}
	if ids != "acd" {
		t.Errorf("kept clips %q, want %q", ids, "acd")
	}
	for src, n := range calls {
		if n != 1 {
			t.Errorf("%s probed %d times, want once per file", src, n)
		}
	}
	if len(clips) != 5 {
		t.Errorf("input slice was modified")
	}
	if out := DropSilentAudio(nil, hasAudio); len(out) != 0 {
		t.Errorf("no clips in, got %d out", len(out))
	}
}

func TestProbeWithFFmpeg(t *testing.T) {
	needFFmpeg(t)
	if _, err := exec.LookPath(ffprobeBinary); err != nil {
		t.Skip("ffprobe not installed")
	}
	dir := t.TempDir()
	withAudio := filepath.Join(dir, "with_audio.mp4")
	silent := filepath.Join(dir, "silent.mp4")
	gen := func(out string, extra ...string) {
		args := []string{"-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=1"}
		args = append(args, extra...)
		args = append(args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", out)
		if err := exec.Command(ffmpegBinary, args...).Run(); err != nil {
			t.Fatalf("could not generate %s: %v", out, err)
		}
	}
	gen(withAudio, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac")
	gen(silent)

	tests := []struct {
		name    string
		file    string
		want    bool
		wantErr bool
	}{
		{name: "video with sound", file: withAudio, want: true},
		{name: "silent video", file: silent, want: false},
		{name: "unreadable file keeps audio", file: filepath.Join(dir, "missing.mp4"), want: true, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := HasAudioStream(tt.file)
			if got != tt.want || (err != nil) != tt.wantErr {
				t.Errorf("HasAudioStream = %v, %v; want %v, err %v", got, err, tt.want, tt.wantErr)
			}
		})
	}

	if ms := MediaDurationMs(silent); ms < 900 || ms > 1100 {
		t.Errorf("MediaDurationMs = %d, want about 1000", ms)
	}
	if ms := MediaDurationMs(filepath.Join(dir, "missing.mp4")); ms != 0 {
		t.Errorf("MediaDurationMs of a missing file = %d, want 0", ms)
	}
}
