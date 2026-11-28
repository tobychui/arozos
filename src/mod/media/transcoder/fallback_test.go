package transcoder

import (
	"errors"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// brokenProfile names an encoder ffmpeg does not have, so a transcode using it
// fails at once without producing anything - the same outcome as a hardware
// pipeline the driver cannot run for a given source.
var brokenProfile = &hwEncoderProfile{
	Name:        "broken test encoder",
	Codec:       "h264_arozos_does_not_exist",
	ScaleFilter: nv12ScaleFilter,
}

// TestSelectWorkingProfiles verifies the probe keeps every working profile in
// order but only the first working one of each group.
func TestSelectWorkingProfiles(t *testing.T) {
	full := &hwEncoderProfile{Name: "full", Group: "full"}
	fullLP := &hwEncoderProfile{Name: "full LP", Group: "full"}
	hybrid := &hwEncoderProfile{Name: "hybrid", Group: "hybrid"}
	hybridLP := &hwEncoderProfile{Name: "hybrid LP", Group: "hybrid"}
	nvenc := &hwEncoderProfile{Name: "nvenc"}
	other := &hwEncoderProfile{Name: "other"}
	candidates := []*hwEncoderProfile{nvenc, full, fullLP, hybrid, hybridLP, other}

	cases := []struct {
		name  string
		works map[*hwEncoderProfile]bool
		want  []*hwEncoderProfile
	}{
		{"nothing works", nil, nil},
		{"all work, groups collapse", map[*hwEncoderProfile]bool{nvenc: true, full: true, fullLP: true, hybrid: true, hybridLP: true, other: true},
			[]*hwEncoderProfile{nvenc, full, hybrid, other}},
		{"only low-power encode, no scale_vaapi", map[*hwEncoderProfile]bool{hybridLP: true},
			[]*hwEncoderProfile{hybridLP}},
		{"normal fails, low-power stands in", map[*hwEncoderProfile]bool{fullLP: true, hybrid: true},
			[]*hwEncoderProfile{fullLP, hybrid}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			probed := map[*hwEncoderProfile]bool{}
			got := selectWorkingProfiles(candidates, func(p *hwEncoderProfile) bool {
				probed[p] = true
				return tc.works[p]
			})
			if len(got) != len(tc.want) {
				t.Fatalf("selectWorkingProfiles() = %v, want %v", names(got), names(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("selectWorkingProfiles()[%d] = %s, want %s", i, got[i].Name, tc.want[i].Name)
				}
			}
			// A group already satisfied is not probed again.
			if tc.works[full] && probed[fullLP] {
				t.Error("probed the low-power variant although the normal one works")
			}
		})
	}
}

func names(profiles []*hwEncoderProfile) []string {
	out := make([]string, len(profiles))
	for i, p := range profiles {
		out[i] = profileName(p)
	}
	return out
}

// TestProbeScaleFilter verifies the probe frame is resized to twice its size.
func TestProbeScaleFilter(t *testing.T) {
	cases := []struct {
		size string
		want string
	}{
		{"320x240", "scale=w=640:h=480"},
		{"640x480", "scale=w=1280:h=960"},
		{"", ""},
		{"banana", ""},
		{"0x240", ""},
	}
	for _, tc := range cases {
		if got := probeScaleFilter(tc.size); got != tc.want {
			t.Errorf("probeScaleFilter(%q) = %q, want %q", tc.size, got, tc.want)
		}
	}
}

// TestTranscodeChain verifies software encoding always ends the chain.
func TestTranscodeChain(t *testing.T) {
	chain := transcodeChain()
	if len(chain) == 0 || chain[len(chain)-1] != nil {
		t.Fatalf("transcodeChain() = %v, want it to end with software (nil)", names(chain))
	}
	if profileName(nil) != "software (libx264)" {
		t.Errorf("profileName(nil) = %q", profileName(nil))
	}
}

// TestRunWithFallback verifies when the loop moves to the next entry.
func TestRunWithFallback(t *testing.T) {
	a := &hwEncoderProfile{Name: "a"}
	b := &hwEncoderProfile{Name: "b"}
	chain := []*hwEncoderProfile{a, b, nil}
	failure := errors.New("ffmpeg failed")

	type result struct {
		wrote bool
		err   error
	}
	cases := []struct {
		name      string
		results   map[*hwEncoderProfile]result
		cancelled bool
		wantTried []string
		wantWrote bool
		wantErr   bool
	}{
		{"first works", map[*hwEncoderProfile]result{a: {true, nil}},
			false, []string{"a"}, true, false},
		{"first fails, second works", map[*hwEncoderProfile]result{a: {false, failure}, b: {true, nil}},
			false, []string{"a", "b"}, true, false},
		{"hardware fails, software works", map[*hwEncoderProfile]result{a: {false, failure}, b: {false, failure}, nil: {true, nil}},
			false, []string{"a", "b", "software (libx264)"}, true, false},
		{"all fail", map[*hwEncoderProfile]result{a: {false, failure}, b: {false, failure}, nil: {false, failure}},
			false, []string{"a", "b", "software (libx264)"}, false, true},
		{"output then error is not retried", map[*hwEncoderProfile]result{a: {true, failure}},
			false, []string{"a"}, true, true},
		{"clean exit without output is not retried", map[*hwEncoderProfile]result{a: {false, nil}},
			false, []string{"a"}, false, false},
		{"cancelled request is not retried", map[*hwEncoderProfile]result{a: {false, failure}},
			true, []string{"a"}, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var tried []string
			failedCalls := 0
			wrote, err := runWithFallback(chain, func(hw *hwEncoderProfile) (bool, error) {
				tried = append(tried, profileName(hw))
				r := tc.results[hw]
				return r.wrote, r.err
			}, func(*hwEncoderProfile, error) {
				failedCalls++
			}, func() bool { return tc.cancelled })

			if len(tried) != len(tc.wantTried) {
				t.Fatalf("tried %v, want %v", tried, tc.wantTried)
			}
			for i := range tried {
				if tried[i] != tc.wantTried[i] {
					t.Errorf("tried %v, want %v", tried, tc.wantTried)
				}
			}
			if wrote != tc.wantWrote {
				t.Errorf("wrote = %v, want %v", wrote, tc.wantWrote)
			}
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, want error %v", err, tc.wantErr)
			}
			// failed is reported for every attempt that is followed by another
			if want := len(tried) - 1; failedCalls != want {
				t.Errorf("failed called %d times, want %d", failedCalls, want)
			}
		})
	}
}

// TestMP4FallsBackToNextEncoder runs a real transcode whose first encoder
// cannot start and checks the video still arrives, from the next one.
func TestMP4FallsBackToNextEncoder(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed on this host")
	}
	source := filepath.Join(t.TempDir(), "source.mp4")
	generateTestVideo(t, source)

	req := httptest.NewRequest("GET", "/media/transcode", nil)
	rr := httptest.NewRecorder()
	var tried []string
	wrote, err := runWithFallback([]*hwEncoderProfile{brokenProfile, nil}, func(hw *hwEncoderProfile) (bool, error) {
		tried = append(tried, profileName(hw))
		args, err := buildMP4Args(source, TranscodeResolution_original, 0, hw)
		if err != nil {
			return false, err
		}
		return streamMP4(rr, req, args)
	}, func(*hwEncoderProfile, error) {}, func() bool { return false })

	if !wrote || err != nil {
		t.Fatalf("wrote = %v, err = %v, want video from the software encoder (tried %v)", wrote, err, tried)
	}
	if len(tried) != 2 {
		t.Errorf("tried %v, want the broken encoder then software", tried)
	}
	if rr.Body.Len() == 0 {
		t.Error("no video reached the response")
	}
}

// TestHLSSuperviseFallsBackToNextEncoder starts an HLS session on an encoder
// that cannot run and checks the supervisor restarts it with the next one.
func TestHLSSuperviseFallsBackToNextEncoder(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed on this host")
	}
	tmp := t.TempDir()
	source := filepath.Join(tmp, "source.mp4")
	generateTestVideo(t, source)

	session := &HLSSession{
		ID:     "fallback",
		Dir:    filepath.Join(tmp, "session"),
		stderr: &tailBuffer{},
		exited: make(chan struct{}),
	}
	if err := os.MkdirAll(session.Dir, 0755); err != nil {
		t.Fatal(err)
	}
	build := func(hw *hwEncoderProfile) ([]string, error) {
		return buildHLSArgs(source, session.Dir, TranscodeResolution_original, 0, "/seg/", hw)
	}
	chain := []*hwEncoderProfile{brokenProfile, nil}
	args, err := build(chain[0])
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("ffmpeg", args...)
	cmd.Stderr = session.stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	session.cmd = cmd
	go session.supervise(cmd, chain, build)
	defer session.stop()

	if err := session.WaitForPlaylist(HLSPlaylistWaitTimeout); err != nil {
		t.Fatalf("no segment after falling back: %v (ffmpeg: %s)", err, session.StderrTail())
	}
	session.mu.Lock()
	restarted := session.cmd != cmd
	session.mu.Unlock()
	if !restarted {
		t.Error("the session is still on the broken encoder's process")
	}
}
