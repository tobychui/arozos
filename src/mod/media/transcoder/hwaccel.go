package transcoder

/*
	hwaccel.go

	Detects and caches a working hardware H.264 encoder so TranscodeAndStream
	can offload encoding from the CPU when the host supports it, falling back
	to the existing libx264 software path otherwise. Platform-specific profiles
	(which encoder, which ffmpeg args) live in hwaccel_linux.go /
	hwaccel_windows.go / hwaccel_darwin.go / hwaccel_other.go.
*/

import (
	"context"
	"os/exec"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// hwEncoderProfile describes how to invoke a hardware-accelerated H.264
// encoder as a drop-in replacement for the software libx264 path.
type hwEncoderProfile struct {
	Name        string                    // human-readable label for logging, e.g. "Intel/AMD VAAPI"
	Codec       string                    // ffmpeg -vcodec value, e.g. "h264_vaapi"
	PreInput    []string                  // extra global args inserted before -i (device init, etc.)
	ScaleFilter func(scale string) string // -vf value wrapping the given scale filter ("" = no scaling)
	EncodeArgs  []string                  // encoder-specific args replacing "-preset superfast"
	ProbeSize   string                    // WxH test frame size for the probe encode; "" uses defaultProbeSize
}

// defaultProbeSize is the test frame size used by testHWEncoder when a profile
// does not ask for a larger one. 320x240 rather than something tiny because
// some encoders (observed with h264_nvenc) reject smaller frames as below their
// minimum encode dimensions.
const defaultProbeSize = "320x240"

var (
	hwProfileOnce sync.Once
	hwProfile     *hwEncoderProfile // nil if no usable hardware encoder was found
)

// nv12ScaleFilter returns a -vf filter chain that applies the given scale
// filter (if any, see resolutionScaleFilter) and converts to NV12. This is what the hardware encoders
// that accept plain system-memory frames (NVENC, QSV, AMF) expect as input -
// unlike VAAPI, they upload to the GPU internally so no explicit hwupload
// step is needed.
func nv12ScaleFilter(scale string) (out0 string) {
	defer logger.Out1(logger.In1("media/transcoder", "nv12ScaleFilter", "scale", scale), &out0)
	if scale == "" {
		return "format=nv12"
	}
	return scale + ",format=nv12"
}

// getHWEncoderProfile probes the host once for a working Intel/AMD hardware
// H.264 encoder and caches the result for the lifetime of the process.
func getHWEncoderProfile() (out0 *hwEncoderProfile) {
	defer logger.Out1(logger.In0("media/transcoder", "getHWEncoderProfile"), &out0)
	hwProfileOnce.Do(func() {
		hwProfile = probeHWEncoders()
		if hwProfile != nil {
			logger.PrintAndLog("Transcoder", "Hardware transcoding enabled: "+hwProfile.Name, nil)
		} else {
			logger.PrintAndLog("Transcoder", "No usable hardware encoder found, using software (libx264) transcoding", nil)
		}
	})
	return hwProfile
}

// probeHWEncoders tries each platform candidate in order and returns the
// first one that can actually complete a throwaway encode, since an encoder
// can be compiled into ffmpeg yet still fail when no compatible GPU/driver
// is present on this particular machine.
func probeHWEncoders() (out0 *hwEncoderProfile) {
	defer logger.Out1(logger.In0("media/transcoder", "probeHWEncoders"), &out0)
	for _, profile := range candidateHWProfiles() {
		if testHWEncoder(profile) {
			return profile
		}
	}
	return nil
}

// probeArgs builds the ffmpeg argument list for a profile's throwaway probe
// encode: a single synthetic frame pushed through the real encoder settings
// and discarded.
func probeArgs(profile *hwEncoderProfile) (out0 []string) {
	defer logger.Out1(logger.In1("media/transcoder", "probeArgs", "profile", profile), &out0)
	size := profile.ProbeSize
	if size == "" {
		size = defaultProbeSize
	}
	args := append([]string{}, profile.PreInput...)
	args = append(args,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "color=c=black:s="+size+":d=0.1",
	)
	if vf := profile.ScaleFilter(""); vf != "" {
		args = append(args, "-vf", vf)
	}
	args = append(args, "-frames:v", "1", "-vcodec", profile.Codec)
	args = append(args, profile.EncodeArgs...)
	return append(args, "-f", "null", "-")
}

// testHWEncoder runs a tiny, throwaway encode against the given profile to
// confirm ffmpeg has a working hardware path on this host.
func testHWEncoder(profile *hwEncoderProfile) (out0 bool) {
	defer logger.Out1(logger.In1("media/transcoder", "testHWEncoder", "profile", profile), &out0)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", probeArgs(profile)...)
	return cmd.Run() == nil
}
