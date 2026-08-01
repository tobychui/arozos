package transcoder

import "testing"

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
