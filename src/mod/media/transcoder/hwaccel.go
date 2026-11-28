package transcoder

/*
	hwaccel.go

	Detects and caches a working hardware H.264 encoder so TranscodeAndStream
	can offload encoding (and, where the profile supports it, decoding and
	scaling too) from the CPU when the host supports it, falling back
	to the existing libx264 software path otherwise. Platform-specific profiles
	(which encoder, which ffmpeg args) live in hwaccel_linux.go /
	hwaccel_windows.go / hwaccel_darwin.go / hwaccel_other.go.
*/

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// hwEncoderProfile describes how to invoke a hardware-accelerated H.264
// encoder as a drop-in replacement for the software libx264 path.
type hwEncoderProfile struct {
	Name     string   // human-readable label for logging, e.g. "Intel/AMD VAAPI"
	Codec    string   // ffmpeg -vcodec value, e.g. "h264_vaapi"
	PreInput []string // extra global args inserted before -i (device init, etc.)
	// DecodeArgs are input options, placed right before -i, that turn on
	// hardware decoding and keep the decoded frames in GPU memory. They are
	// left out of the probe encode, whose synthetic input has no hardware
	// decoder to test. ffmpeg decodes a source the GPU cannot handle in
	// software instead, so ScaleFilter must then accept both kinds of frame.
	DecodeArgs  []string
	ScaleFilter func(scale string) string // -vf value wrapping the given scale filter ("" = no scaling)
	EncodeArgs  []string                  // encoder-specific args replacing "-preset superfast"
	ProbeSize   string                    // WxH test frame size for the probe encode; "" uses defaultProbeSize
	// Group names profiles that are variants of one pipeline on one device,
	// such as the normal and low-power VAAPI encoder. Only the first of a
	// group that passes the probe is kept, so a failing transcode falls back
	// to a different pipeline rather than to a near copy of the same one.
	// "" makes the profile a group of its own.
	Group string
}

// defaultProbeSize is the test frame size used by testHWEncoder when a profile
// does not ask for a larger one. 320x240 rather than something tiny because
// some encoders (observed with h264_nvenc) reject smaller frames as below their
// minimum encode dimensions.
const defaultProbeSize = "320x240"

var (
	hwProfileOnce sync.Once
	hwProfiles    []*hwEncoderProfile // usable hardware profiles, best first; empty if none
)

// nv12ScaleFilter returns a -vf filter chain that applies the given scale
// filter (if any, see resolutionScaleFilter) and converts to NV12. This is what the hardware encoders
// that accept plain system-memory frames (NVENC, QSV, AMF) expect as input -
// unlike VAAPI, they upload to the GPU internally so no explicit hwupload
// step is needed.
func nv12ScaleFilter(scale string) string {
	if scale == "" {
		return "format=nv12"
	}
	return scale + ",format=nv12"
}

// getHWEncoderProfiles probes the host once for working hardware H.264
// pipelines and caches the result for the lifetime of the process.
func getHWEncoderProfiles() []*hwEncoderProfile {
	hwProfileOnce.Do(func() {
		hwProfiles = probeHWEncoders()
		if len(hwProfiles) == 0 {
			logger.PrintAndLog("Transcoder", "No usable hardware encoder found, using software (libx264) transcoding", nil)
			return
		}
		names := make([]string, len(hwProfiles))
		for i, profile := range hwProfiles {
			names[i] = profile.Name
		}
		logger.PrintAndLog("Transcoder", "Hardware transcoding enabled: "+strings.Join(names, ", then "), nil)
	})
	return hwProfiles
}

// getHWEncoderProfile returns the best usable hardware profile, or nil when
// transcoding has to use libx264.
func getHWEncoderProfile() *hwEncoderProfile {
	if profiles := getHWEncoderProfiles(); len(profiles) > 0 {
		return profiles[0]
	}
	return nil
}

// transcodeChain lists the encoder settings a transcode tries in turn: every
// usable hardware profile, best first, then nil for libx264. The probe only
// shows that a pipeline works for a synthetic 8-bit frame; a real source can
// still break it - a 10-bit HDR film needs a pixel format conversion the GPU
// may not offer - so a transcode that fails before producing anything moves
// on to the next entry instead of leaving the player waiting forever.
func transcodeChain() []*hwEncoderProfile {
	return append(append([]*hwEncoderProfile{}, getHWEncoderProfiles()...), nil)
}

// probeHWEncoders tries each platform candidate in order and keeps those that
// can actually complete a throwaway encode, since an encoder can be compiled
// into ffmpeg yet still fail when no compatible GPU/driver is present on this
// particular machine. Within a Group only the first that works is kept.
func probeHWEncoders() []*hwEncoderProfile {
	return selectWorkingProfiles(candidateHWProfiles(), testHWEncoder)
}

// selectWorkingProfiles is the probing loop of probeHWEncoders, separated so
// the grouping rule can be tested without ffmpeg.
func selectWorkingProfiles(candidates []*hwEncoderProfile, works func(*hwEncoderProfile) bool) []*hwEncoderProfile {
	var usable []*hwEncoderProfile
	satisfied := map[string]bool{}
	for _, profile := range candidates {
		if profile.Group != "" && satisfied[profile.Group] {
			continue
		}
		if !works(profile) {
			continue
		}
		usable = append(usable, profile)
		if profile.Group != "" {
			satisfied[profile.Group] = true
		}
	}
	return usable
}

// probeArgs builds the ffmpeg argument list for a profile's throwaway probe
// encode: a single synthetic frame pushed through the real encoder settings
// and discarded.
//
// The frame is resized on the way, to twice the probe size. Without that the
// probe proved nothing about GPU scaling: scale_vaapi passes a frame straight
// through when neither size nor format changes, so a driver with no video
// processing entrypoint at all (Debian's free Intel driver on 9th generation
// graphics) passed the probe and then failed every real transcode. Doubling
// rather than halving keeps the frame above the minimum size some encoders
// accept.
func probeArgs(profile *hwEncoderProfile) []string {
	size := profile.ProbeSize
	if size == "" {
		size = defaultProbeSize
	}
	args := append([]string{}, profile.PreInput...)
	args = append(args,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=c=black:s="+size+":d=0.1",
	)
	if vf := profile.ScaleFilter(probeScaleFilter(size)); vf != "" {
		args = append(args, "-vf", vf)
	}
	args = append(args, "-frames:v", "1", "-vcodec", profile.Codec)
	args = append(args, profile.EncodeArgs...)
	return append(args, "-f", "null", "-")
}

// testHWEncoder runs a tiny, throwaway encode against the given profile to
// confirm ffmpeg has a working hardware path on this host.
func testHWEncoder(profile *hwEncoderProfile) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", probeArgs(profile)...)
	return cmd.Run() == nil
}

// probeScaleFilter returns a scale filter to twice the given WxH probe size.
func probeScaleFilter(size string) string {
	w, h := 0, 0
	if _, err := fmt.Sscanf(size, "%dx%d", &w, &h); err != nil || w <= 0 || h <= 0 {
		return ""
	}
	return fmt.Sprintf("scale=w=%d:h=%d", w*2, h*2)
}
