package transcoder

/*
	hwaccel.go

	Detects and caches a working Intel/AMD hardware H.264 encoder so
	TranscodeAndStream can offload encoding from the CPU when the host
	supports it, falling back to the existing libx264 software path
	otherwise. Platform-specific profiles (which encoder, which ffmpeg
	args) live in hwaccel_linux.go / hwaccel_windows.go / hwaccel_other.go.
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
	Name        string                     // human-readable label for logging, e.g. "Intel/AMD VAAPI"
	Codec       string                     // ffmpeg -vcodec value, e.g. "h264_vaapi"
	PreInput    []string                   // extra global args inserted before -i (device init, etc.)
	ScaleFilter func(height string) string // -vf value for the given target height ("" height = no scaling)
	EncodeArgs  []string                   // encoder-specific args replacing "-preset superfast"
}

var (
	hwProfileOnce sync.Once
	hwProfile     *hwEncoderProfile // nil if no usable hardware encoder was found
)

// nv12ScaleFilter returns a -vf filter chain that performs the requested
// resize (if any) and converts to NV12. This is what the hardware encoders
// that accept plain system-memory frames (NVENC, QSV, AMF) expect as input -
// unlike VAAPI, they upload to the GPU internally so no explicit hwupload
// step is needed.
func nv12ScaleFilter(height string) string {
	if height == "" {
		return "format=nv12"
	}
	return "scale=-1:" + height + ",format=nv12"
}

// getHWEncoderProfile probes the host once for a working Intel/AMD hardware
// H.264 encoder and caches the result for the lifetime of the process.
func getHWEncoderProfile() *hwEncoderProfile {
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
func probeHWEncoders() *hwEncoderProfile {
	for _, profile := range candidateHWProfiles() {
		if testHWEncoder(profile) {
			return profile
		}
	}
	return nil
}

// testHWEncoder runs a tiny, throwaway encode against the given profile to
// confirm ffmpeg has a working hardware path on this host.
func testHWEncoder(profile *hwEncoderProfile) bool {
	args := append([]string{}, profile.PreInput...)
	args = append(args,
		"-hide_banner", "-loglevel", "error",
		// 320x240: some encoders (observed with h264_nvenc) reject much
		// smaller test frames as below their minimum encode dimensions.
		"-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1",
	)
	if vf := profile.ScaleFilter(""); vf != "" {
		args = append(args, "-vf", vf)
	}
	args = append(args, "-frames:v", "1", "-vcodec", profile.Codec)
	args = append(args, profile.EncodeArgs...)
	args = append(args, "-f", "null", "-")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	return cmd.Run() == nil
}
