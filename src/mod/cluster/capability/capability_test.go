package capability

import (
	"runtime"
	"testing"
)

func TestDetectBasics(t *testing.T) {
	m := Detect()
	if m.OS != runtime.GOOS || m.Arch != runtime.GOARCH {
		t.Errorf("os/arch mismatch: %s/%s", m.OS, m.Arch)
	}
	if m.CPUCores < 1 {
		t.Errorf("expected at least one core, got %d", m.CPUCores)
	}
	if m.Features == nil {
		t.Fatal("features map missing")
	}
	for _, f := range []string{"ffmpeg", "docker", "avx2", "neon", "64bit"} {
		if _, ok := m.Features[f]; !ok {
			t.Errorf("feature %s should always be reported", f)
		}
	}
	if m.DetectedAt == 0 {
		t.Errorf("DetectedAt not set")
	}
}

func TestSatisfies(t *testing.T) {
	m := Manifest{
		OS:       "linux",
		Arch:     "arm64",
		CPUCores: 4,
		TotalRAM: 8 << 30,
		Features: map[string]bool{"ffmpeg": true, "docker": true, "cuda": false},
	}
	tests := []struct {
		name string
		req  Requirements
		want bool
	}{
		{"empty", Requirements{}, true},
		{"has features", Requirements{Features: []string{"ffmpeg", "docker"}}, true},
		{"missing feature", Requirements{Features: []string{"cuda"}}, false},
		{"unknown feature", Requirements{Features: []string{"quantum"}}, false},
		{"ram ok", Requirements{MinRAM: 4 << 30}, true},
		{"ram too small", Requirements{MinRAM: 16 << 30}, false},
		{"cores ok", Requirements{MinCores: 4}, true},
		{"cores too few", Requirements{MinCores: 8}, false},
		{"os allowed", Requirements{OS: []string{"Linux", "darwin"}}, true},
		{"os denied", Requirements{OS: []string{"windows"}}, false},
		{"arch allowed", Requirements{Arch: []string{"amd64", "ARM64"}}, true},
		{"arch denied", Requirements{Arch: []string{"amd64"}}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ok, reason := m.Satisfies(tc.req)
			if ok != tc.want {
				t.Errorf("Satisfies(%+v) = %v (%s), want %v", tc.req, ok, reason, tc.want)
			}
			if !ok && reason == "" {
				t.Errorf("unmet requirement must carry a reason")
			}
		})
	}
}

func TestSatisfiesUnknownRAM(t *testing.T) {
	m := Manifest{TotalRAM: 0, CPUCores: 2, Features: map[string]bool{}}
	if ok, _ := m.Satisfies(Requirements{MinRAM: 1 << 40}); !ok {
		t.Errorf("unknown RAM must not fail a RAM requirement")
	}
}

func TestEnabledFeatures(t *testing.T) {
	m := Manifest{Features: map[string]bool{"a": true, "b": false, "c": true}}
	got := m.EnabledFeatures()
	if len(got) != 2 {
		t.Errorf("expected 2 enabled features, got %v", got)
	}
	if !m.Has("A") || m.Has("b") || m.Has("zzz") {
		t.Errorf("Has() lookup wrong")
	}
}
