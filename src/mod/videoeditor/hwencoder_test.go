package videoeditor

import (
	"strings"
	"testing"
)

func TestProbeHardwareEncoders(t *testing.T) {
	a := hwCandidate{Encoder: Encoder{Name: "A", Codec: "a_enc"}}
	b := hwCandidate{Encoder: Encoder{Name: "B", Codec: "b_enc"}}
	tests := []struct {
		name  string
		works map[string]bool
		want  string
	}{
		{name: "first working wins", works: map[string]bool{"A": true, "B": true}, want: "A"},
		{name: "falls through", works: map[string]bool{"B": true}, want: "B"},
		{name: "none works", works: map[string]bool{}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := probeHardwareEncoders([]hwCandidate{a, b}, func(c hwCandidate) bool { return tt.works[c.Name] })
			name := ""
			if got != nil {
				name = got.Name
			}
			if name != tt.want {
				t.Errorf("picked %q, want %q", name, tt.want)
			}
		})
	}
}

func TestProbeArgs(t *testing.T) {
	c := hwCandidate{Encoder: Encoder{Codec: "h264_vaapi", PreInput: []string{"-vaapi_device", "/dev/dri/renderD128"},
		FinalFilter: "format=nv12,hwupload", Args: []string{"-qp", "21"}}}
	joined := strings.Join(probeArgs(c), " ")
	for _, want := range []string{"-vaapi_device /dev/dri/renderD128 -hide_banner", "s=" + defaultProbeSize, "-vf format=nv12,hwupload", "-c:v h264_vaapi -qp 21", "-f null -"} {
		if !strings.Contains(joined, want) {
			t.Errorf("probe args %q missing %q", joined, want)
		}
	}
	c.ProbeSize = "640x480"
	if !strings.Contains(strings.Join(probeArgs(c), " "), "s=640x480") {
		t.Errorf("probe size not applied")
	}
}

func TestCandidateEncodersAreComplete(t *testing.T) {
	for _, c := range candidateEncoders() {
		if c.Name == "" || c.Codec == "" {
			t.Errorf("candidate %+v needs a name and a codec", c)
		}
	}
}

func TestHardwareEncoderReturnsCopy(t *testing.T) {
	enc := HardwareEncoder()
	if enc == nil {
		t.Skip("no hardware encoder on this host")
	}
	enc.Args = append(enc.Args[:0], "changed")
	if again := HardwareEncoder(); len(again.Args) > 0 && again.Args[0] == "changed" {
		t.Errorf("callers must not be able to change the cached profile")
	}
}
