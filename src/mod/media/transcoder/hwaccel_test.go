package transcoder

import (
	"regexp"
	"strings"
	"testing"
)

// TestNV12ScaleFilter verifies the shared scale/format filter chain used by
// the hardware encoders that accept plain system-memory frames.
func TestNV12ScaleFilter(t *testing.T) {
	cases := []struct {
		name   string
		height string
		want   string
	}{
		{"no resize", "", "format=nv12"},
		{"resize to 360", "360", "scale=-1:360,format=nv12"},
		{"resize to 720", "720", "scale=-1:720,format=nv12"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nv12ScaleFilter(tc.height)
			if got != tc.want {
				t.Errorf("nv12ScaleFilter(%q) = %q, want %q", tc.height, got, tc.want)
			}
		})
	}
}

// TestCandidateHWProfiles verifies that every profile the current platform
// offers is well-formed: it has a name, a codec, and a scale filter that
// does not panic and always returns a non-empty filter chain.
func TestCandidateHWProfiles(t *testing.T) {
	for _, profile := range candidateHWProfiles() {
		if profile.Name == "" {
			t.Errorf("profile has empty Name: %+v", profile)
		}
		if profile.Codec == "" {
			t.Errorf("profile %q has empty Codec", profile.Name)
		}
		if profile.ScaleFilter == nil {
			t.Fatalf("profile %q has nil ScaleFilter", profile.Name)
		}
		for _, height := range []string{"", "360", "720", "1080"} {
			if vf := profile.ScaleFilter(height); vf == "" {
				t.Errorf("profile %q ScaleFilter(%q) returned empty string", profile.Name, height)
			}
		}
		if profile.ProbeSize != "" && !regexp.MustCompile(`^\d+x\d+$`).MatchString(profile.ProbeSize) {
			t.Errorf("profile %q has malformed ProbeSize %q, want WxH", profile.Name, profile.ProbeSize)
		}
	}
}

// TestProbeArgs verifies the probe command line: profile args are placed in the
// order ffmpeg expects, and ProbeSize overrides the default test frame size
// (VideoToolbox needs a larger frame than the 320x240 default to open at all).
func TestProbeArgs(t *testing.T) {
	cases := []struct {
		name        string
		profile     *hwEncoderProfile
		wantSize    string
		wantOrdered []string // args that must appear in this relative order
		wantAbsent  []string
	}{
		{
			name: "default probe size and no pre-input",
			profile: &hwEncoderProfile{
				Name:        "system memory encoder",
				Codec:       "h264_fake",
				ScaleFilter: nv12ScaleFilter,
				EncodeArgs:  []string{"-preset", "fast"},
			},
			wantSize:    defaultProbeSize,
			wantOrdered: []string{"-i", "-vf", "format=nv12", "-vcodec", "h264_fake", "-preset", "fast", "-f", "null", "-"},
		},
		{
			name: "explicit probe size overrides the default",
			profile: &hwEncoderProfile{
				Name:        "videotoolbox-like",
				Codec:       "h264_videotoolbox",
				ScaleFilter: nv12ScaleFilter,
				EncodeArgs:  []string{"-realtime", "1"},
				ProbeSize:   "640x480",
			},
			wantSize:    "640x480",
			wantOrdered: []string{"-i", "-vcodec", "h264_videotoolbox", "-realtime", "1"},
			wantAbsent:  []string{"color=c=black:s=" + defaultProbeSize + ":d=0.1"},
		},
		{
			name: "pre-input args come before the input",
			profile: &hwEncoderProfile{
				Name:        "vaapi-like",
				Codec:       "h264_vaapi",
				PreInput:    []string{"-vaapi_device", "/dev/dri/renderD128"},
				ScaleFilter: func(string) string { return "format=nv12,hwupload" },
			},
			wantSize:    defaultProbeSize,
			wantOrdered: []string{"-vaapi_device", "/dev/dri/renderD128", "-f", "lavfi", "-i"},
		},
		{
			name: "empty scale filter emits no -vf",
			profile: &hwEncoderProfile{
				Name:        "no filter",
				Codec:       "h264_fake",
				ScaleFilter: func(string) string { return "" },
			},
			wantSize:   defaultProbeSize,
			wantAbsent: []string{"-vf"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args := probeArgs(tc.profile)
			joined := strings.Join(args, " ")

			wantInput := "color=c=black:s=" + tc.wantSize + ":d=0.1"
			if !strings.Contains(joined, wantInput) {
				t.Errorf("probeArgs() = %v, want it to contain input %q", args, wantInput)
			}

			at := 0
			for _, want := range tc.wantOrdered {
				found := -1
				for i := at; i < len(args); i++ {
					if args[i] == want {
						found = i
						break
					}
				}
				if found == -1 {
					t.Fatalf("probeArgs() = %v, missing %q at or after index %d", args, want, at)
				}
				at = found + 1
			}

			for _, absent := range tc.wantAbsent {
				for _, arg := range args {
					if arg == absent {
						t.Errorf("probeArgs() = %v, did not expect %q", args, absent)
					}
				}
			}
		})
	}
}

// TestGetHWEncoderProfile_Cached verifies that repeated calls return the same
// cached result (the underlying probe only runs once per process).
func TestGetHWEncoderProfile_Cached(t *testing.T) {
	first := getHWEncoderProfile()
	second := getHWEncoderProfile()
	if first != second {
		t.Errorf("getHWEncoderProfile() returned different results across calls: %v vs %v", first, second)
	}
}
