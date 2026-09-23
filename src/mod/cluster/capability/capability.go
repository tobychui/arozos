package capability

/*
	ArozOS Cluster - node capability manifest

	Cluster nodes are heterogeneous (different OS, CPU architecture, RAM,
	accelerators and installed tools). Each node publishes a manifest in its
	membership record so the job scheduler can match a job's requirements
	against what a node can actually do.

	Detection is deliberately portable: it only uses runtime information,
	the Go CPU feature flags and PATH lookups, never platform-only commands.
*/

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"golang.org/x/sys/cpu"
	"imuslab.com/arozos/mod/info/usageinfo"
)

// Manifest describes what a node offers.
type Manifest struct {
	OS         string          `json:"os"`
	Arch       string          `json:"arch"`
	CPUCores   int             `json:"cpuCores"`
	TotalRAM   int64           `json:"totalRam"` //bytes, 0 when unknown
	Hostname   string          `json:"hostname"`
	Features   map[string]bool `json:"features"`
	GoVersion  string          `json:"goVersion"`
	DetectedAt int64           `json:"detectedAt"`
}

// Requirements is what a job asks for. Empty fields mean "no constraint".
type Requirements struct {
	Features []string `json:"features,omitempty"`
	MinRAM   int64    `json:"minRam,omitempty"`
	MinCores int      `json:"minCores,omitempty"`
	OS       []string `json:"os,omitempty"`
	Arch     []string `json:"arch,omitempty"`
}

// toolFeatures maps a feature name to the executable whose presence enables it.
var toolFeatures = map[string]string{
	"ffmpeg":  "ffmpeg",
	"ffprobe": "ffprobe",
	"docker":  "docker",
	"nvidia":  "nvidia-smi",
	"git":     "git",
	"python3": "python3",
	"node":    "node",
}

// Detect builds the manifest of the local machine.
func Detect() Manifest {
	m := Manifest{
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		CPUCores:   runtime.NumCPU(),
		Features:   map[string]bool{},
		GoVersion:  runtime.Version(),
		DetectedAt: time.Now().Unix(),
	}
	if hn, err := os.Hostname(); err == nil {
		m.Hostname = hn
	}
	if _, total := usageinfo.GetNumericRAMUsage(); total > 0 {
		m.TotalRAM = total
	}

	for feature, binary := range toolFeatures {
		m.Features[feature] = lookPath(binary)
	}
	if m.Features["nvidia"] {
		m.Features["cuda"] = true
		m.Features["gpu"] = true
	}

	//CPU instruction sets, false on architectures that do not have them
	m.Features["avx"] = cpu.X86.HasAVX
	m.Features["avx2"] = cpu.X86.HasAVX2
	m.Features["avx512"] = cpu.X86.HasAVX512F
	m.Features["neon"] = cpu.ARM64.HasASIMD
	m.Features["64bit"] = strings.HasSuffix(runtime.GOARCH, "64")
	return m
}

func lookPath(binary string) bool {
	_, err := exec.LookPath(binary)
	return err == nil
}

// Has reports whether a feature is present.
func (m Manifest) Has(feature string) bool {
	return m.Features != nil && m.Features[strings.ToLower(feature)]
}

// Satisfies checks the manifest against job requirements and explains the
// first unmet one.
func (m Manifest) Satisfies(r Requirements) (bool, string) {
	for _, f := range r.Features {
		if !m.Has(f) {
			return false, "missing feature " + f
		}
	}
	if r.MinRAM > 0 && m.TotalRAM > 0 && m.TotalRAM < r.MinRAM {
		return false, "insufficient memory"
	}
	if r.MinCores > 0 && m.CPUCores < r.MinCores {
		return false, "insufficient cpu cores"
	}
	if len(r.OS) > 0 && !containsFold(r.OS, m.OS) {
		return false, "os " + m.OS + " not allowed"
	}
	if len(r.Arch) > 0 && !containsFold(r.Arch, m.Arch) {
		return false, "architecture " + m.Arch + " not allowed"
	}
	return true, ""
}

// EnabledFeatures returns the sorted-insensitive list of features that are true.
func (m Manifest) EnabledFeatures() []string {
	out := []string{}
	for f, on := range m.Features {
		if on {
			out = append(out, f)
		}
	}
	return out
}

func containsFold(list []string, v string) bool {
	for _, item := range list {
		if strings.EqualFold(item, v) {
			return true
		}
	}
	return false
}
