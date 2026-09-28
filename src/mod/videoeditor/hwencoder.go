package videoeditor

/*
	hwencoder.go

	Finds a hardware H.264 encoder the host can really use for offline
	renders and proxies, once per process. The candidates per platform live
	in hwencoder_linux.go / hwencoder_windows.go / hwencoder_darwin.go /
	hwencoder_other.go.

	This is deliberately separate from the streaming transcoder's probe: a
	render wants quality settings, the live transcoder wants low latency and
	HLS-friendly keyframes, and the two packages must not depend on each
	other.
*/

import (
	"context"
	"os/exec"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// hwCandidate is one hardware encoder worth trying on this platform.
type hwCandidate struct {
	Encoder
	// ProbeSize is the WxH of the probe frame; "" uses defaultProbeSize.
	// Some encoders refuse frames below their minimum size.
	ProbeSize string
}

// defaultProbeSize is large enough for NVENC, which rejects tiny frames.
const defaultProbeSize = "320x240"

// nv12Filter is the final filter for encoders that take system-memory NV12
// frames and upload them to the GPU themselves (NVENC, QSV, AMF,
// VideoToolbox).
const nv12Filter = "format=nv12"

var (
	hwOnce    sync.Once
	hwEncoder *Encoder
)

// HardwareEncoder returns the host's working hardware H.264 encoder, or nil
// when only software encoding is available. The probe runs on first use and
// its result is kept for the lifetime of the process.
func HardwareEncoder() *Encoder {
	hwOnce.Do(func() {
		hwEncoder = probeHardwareEncoders(candidateEncoders(), testEncoder)
		if hwEncoder != nil {
			logger.PrintAndLog("VideoEditor", "Hardware encoder available for renders: "+hwEncoder.Name, nil)
		}
	})
	if hwEncoder == nil {
		return nil
	}
	enc := *hwEncoder
	enc.PreInput = append([]string{}, hwEncoder.PreInput...)
	enc.Args = append([]string{}, hwEncoder.Args...)
	return &enc
}

// probeHardwareEncoders returns the first candidate that test accepts. An
// encoder can be compiled into ffmpeg and still fail without a matching GPU
// or driver, so every candidate is tried with a real encode.
func probeHardwareEncoders(candidates []hwCandidate, test func(hwCandidate) bool) *Encoder {
	for _, c := range candidates {
		if test(c) {
			enc := c.Encoder
			return &enc
		}
	}
	return nil
}

// probeArgs is a one-frame throwaway encode through the candidate's real
// settings.
func probeArgs(c hwCandidate) []string {
	size := c.ProbeSize
	if size == "" {
		size = defaultProbeSize
	}
	args := append([]string{}, c.PreInput...)
	args = append(args, "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=c=black:s="+size+":d=0.1")
	if c.FinalFilter != "" {
		args = append(args, "-vf", c.FinalFilter)
	}
	args = append(args, "-frames:v", "1", "-c:v", c.Codec)
	args = append(args, c.Args...)
	return append(args, "-f", "null", "-")
}

func testEncoder(c hwCandidate) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, ffmpegBinary, probeArgs(c)...).Run() == nil
}
