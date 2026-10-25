package transcoder

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestParseTranscodeResolution covers the request parameter mapping, including
// the fall back to the source resolution for anything unknown.
func TestParseTranscodeResolution(t *testing.T) {
	cases := []struct {
		value string
		want  TranscodeOutputResolution
	}{
		{"360p", TranscodeResolution_360p},
		{"480p", TranscodeResolution_480p},
		{"720p", TranscodeResolution_720p},
		{"1080p", TranscodeResolution_1080p},
		{" 720P ", TranscodeResolution_720p},
		{"", TranscodeResolution_original},
		{"original", TranscodeResolution_original},
		{"1280p", TranscodeResolution_original},
		{"240p", TranscodeResolution_original},
		{"banana", TranscodeResolution_original},
	}

	for _, tc := range cases {
		t.Run(tc.value, func(t *testing.T) {
			if got := ParseTranscodeResolution(tc.value); got != tc.want {
				t.Errorf("ParseTranscodeResolution(%q) = %q, want %q", tc.value, got, tc.want)
			}
		})
	}
}

// TestResolutionScaleFilter covers the shared filter used by both the MP4 and
// the HLS path, including the rejection that guards the endpoint.
func TestResolutionScaleFilter(t *testing.T) {
	cases := []struct {
		resolution TranscodeOutputResolution
		want       string
		wantErr    bool
	}{
		{TranscodeResolution_original, "", false},
		{TranscodeResolution_360p, "min(1,min(640/max(iw,ih),360/min(iw,ih)))", false},
		{TranscodeResolution_1080p, "min(1,min(1920/max(iw,ih),1080/min(iw,ih)))", false},
		{"banana", "", true},
	}

	for _, tc := range cases {
		t.Run(string(tc.resolution), func(t *testing.T) {
			got, err := resolutionScaleFilter(tc.resolution)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("resolutionScaleFilter(%q) returned no error, want one", tc.resolution)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolutionScaleFilter(%q) returned error: %v", tc.resolution, err)
			}
			if tc.want == "" {
				if got != "" {
					t.Errorf("resolutionScaleFilter(%q) = %q, want no filter", tc.resolution, got)
				}
				return
			}
			if !strings.HasPrefix(got, "scale=") || !strings.Contains(got, tc.want) {
				t.Errorf("resolutionScaleFilter(%q) = %q, want a scale filter using %q", tc.resolution, got, tc.want)
			}
		})
	}
}

// TestResolutionScaleFilterOutput runs the filter through ffmpeg to check the
// sizes it produces: fitted to the box, turned for portrait sources, never
// enlarged and always even. Skipped where ffmpeg is not installed.
func TestResolutionScaleFilterOutput(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}

	cases := []struct {
		name       string
		source     string
		resolution TranscodeOutputResolution
		want       string
	}{
		{"widescreen down", "1920x1080", TranscodeResolution_720p, "1280,720"},
		{"scope film keeps width", "1920x800", TranscodeResolution_1080p, "1920,800"},
		{"scope film down", "1920x800", TranscodeResolution_720p, "1280,532"},
		{"portrait", "1080x1920", TranscodeResolution_720p, "720,1280"},
		{"four by three", "1440x1080", TranscodeResolution_480p, "640,480"},
		{"never upscales", "720x480", TranscodeResolution_1080p, "720,480"},
		{"odd width made even", "853x480", TranscodeResolution_480p, "852,480"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scale, err := resolutionScaleFilter(tc.resolution)
			if err != nil {
				t.Fatalf("resolutionScaleFilter(%q) returned error: %v", tc.resolution, err)
			}
			out := filepath.Join(t.TempDir(), "out.mp4")
			encode := exec.Command("ffmpeg", "-v", "error",
				"-f", "lavfi", "-i", "color=c=black:s="+tc.source+":d=0.1",
				"-vf", scale, "-frames:v", "1", "-vcodec", "libx264", "-pix_fmt", "yuv420p", "-y", out)
			if output, err := encode.CombinedOutput(); err != nil {
				t.Fatalf("ffmpeg failed: %v\n%s", err, output)
			}
			probe, err := exec.Command("ffprobe", "-v", "quiet", "-select_streams", "v:0",
				"-show_entries", "stream=width,height", "-of", "csv=p=0", out).Output()
			if err != nil {
				t.Fatalf("ffprobe failed: %v", err)
			}
			if got := strings.TrimSpace(string(probe)); got != tc.want {
				t.Errorf("%s at %s = %s, want %s", tc.source, tc.resolution, got, tc.want)
			}
		})
	}
}

// TestRateControlArgs checks the bitrate ceiling each path gets.
func TestRateControlArgs(t *testing.T) {
	cases := []struct {
		name       string
		resolution TranscodeOutputResolution
		hardware   bool
		want       string
	}{
		{"original software", TranscodeResolution_original, false, ""},
		{"original hardware", TranscodeResolution_original, true, ""},
		{"480p software", TranscodeResolution_480p, false, "-crf 23 -maxrate 1400k -bufsize 2800k"},
		{"720p hardware", TranscodeResolution_720p, true, "-b:v 2100k -maxrate 2800k -bufsize 5600k"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := strings.Join(rateControlArgs(tc.resolution, tc.hardware), " ")
			if got != tc.want {
				t.Errorf("rateControlArgs(%q, %v) = %q, want %q", tc.resolution, tc.hardware, got, tc.want)
			}
		})
	}
}
