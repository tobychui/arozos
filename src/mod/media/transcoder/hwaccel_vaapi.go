package transcoder

/*
	hwaccel_vaapi.go

	VAAPI profiles for Intel and AMD GPUs. Only Linux offers them (see
	hwaccel_linux.go), but they are plain argument builders with no syscalls,
	so they live in an untagged file and are tested on every platform.

	Two pipelines are offered, best first:

	  - Full hardware: the GPU decodes the source (-hwaccel vaapi), scales it and
	    converts 10-bit to 8-bit (scale_vaapi), then encodes it. Frames never
	    leave GPU memory, so a 1080p or 4K HEVC source costs the CPU little more
	    than demuxing and the audio track. Before this existed, only the encode
	    was offloaded: an HEVC source was still decoded, scaled and converted to
	    NV12 by the CPU, which a low-end dual-core cannot keep up with.
	  - Encode only: the CPU decodes and scales, the GPU encodes. Kept for
	    drivers without the video processing (VPP) entrypoint scale_vaapi needs.

	Each comes in two flavours. Intel's media driver exposes H.264 encoding
	either through the full encode entrypoint or the low-power (VDEnc) one,
	and the free build Debian and Ubuntu ship as intel-media-va-driver has only
	the low-power one on most generations, since the other needs the non-free
	shader kernels. ffmpeg's h264_vaapi asks for the full entrypoint unless
	told -low_power 1 and does not try the other on its own, so without the
	low-power variant such a host would fall back to libx264 entirely.
*/

import (
	"path/filepath"
	"sort"
	"strings"
)

// vaapiRenderNodeGlob matches the DRM render nodes VAAPI devices are opened
// through (renderD128, renderD129, ... one per GPU).
const vaapiRenderNodeGlob = "/dev/dri/renderD*"

// vaapiDefaultRenderNode is tried when no render node can be listed, which
// keeps the behaviour of the single hardcoded node used before.
const vaapiDefaultRenderNode = "/dev/dri/renderD128"

// vaapiRenderNodes lists the render nodes to probe, in name order. A machine
// with an NVIDIA card next to the Intel iGPU has the iGPU on renderD129, which
// the single default node used to miss.
func vaapiRenderNodes() []string {
	nodes, err := filepath.Glob(vaapiRenderNodeGlob)
	if err != nil || len(nodes) == 0 {
		return []string{vaapiDefaultRenderNode}
	}
	sort.Strings(nodes)
	return nodes
}

// vaapiProfiles returns the VAAPI candidates for one render node, best first.
func vaapiProfiles(device string) []*hwEncoderProfile {
	preInput := []string{"-vaapi_device", device}
	lowPower := []string{"-low_power", "1"}
	// -hwaccel_output_format vaapi keeps decoded frames on the GPU. A source
	// the GPU cannot decode (an unsupported profile, or a codec such as MPEG-4
	// Part 2 that VAAPI never had) is decoded in software by ffmpeg instead
	// of failing, and vaapiHWFilter uploads those frames.
	decode := []string{"-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi"}
	name := filepath.Base(device)

	return []*hwEncoderProfile{
		{
			Name:        "Intel/AMD VAAPI, hardware decode and encode (" + name + ")",
			Codec:       "h264_vaapi",
			PreInput:    preInput,
			DecodeArgs:  decode,
			ScaleFilter: vaapiHWFilter,
		},
		{
			Name:        "Intel/AMD VAAPI low-power, hardware decode and encode (" + name + ")",
			Codec:       "h264_vaapi",
			PreInput:    preInput,
			DecodeArgs:  decode,
			ScaleFilter: vaapiHWFilter,
			EncodeArgs:  lowPower,
		},
		{
			Name:        "Intel/AMD VAAPI, encode only (" + name + ")",
			Codec:       "h264_vaapi",
			PreInput:    preInput,
			ScaleFilter: vaapiUploadFilter,
		},
		{
			Name:        "Intel/AMD VAAPI low-power, encode only (" + name + ")",
			Codec:       "h264_vaapi",
			PreInput:    preInput,
			ScaleFilter: vaapiUploadFilter,
			EncodeArgs:  lowPower,
		},
	}
}

// vaapiHWFilter is the -vf chain of the full hardware pipeline.
//
// format=nv12|vaapi lets GPU-decoded frames through untouched and converts
// software-decoded ones to NV12; hwupload then uploads the latter and passes
// the former through. scale_vaapi resizes on the GPU and, with format=nv12,
// also turns 10-bit (P010) frames into the 8-bit NV12 that h264_vaapi and the
// browsers need - so it stays in the chain even when nothing is resized.
func vaapiHWFilter(scale string) string {
	return "format=nv12|vaapi,hwupload," + vaapiScaleFilter(scale)
}

// vaapiScaleFilter turns a software scale filter from resolutionScaleFilter
// into its scale_vaapi equivalent; the w/h expressions are the same, since
// scale_vaapi evaluates them like scale does.
func vaapiScaleFilter(scale string) string {
	if scale == "" {
		return "scale_vaapi=format=nv12"
	}
	return "scale_vaapi=" + strings.TrimPrefix(scale, "scale=") + ":format=nv12"
}

// vaapiUploadFilter is the -vf chain of the encode-only pipeline: scale and
// convert in software, then upload for the encoder.
func vaapiUploadFilter(scale string) string {
	if scale == "" {
		return "format=nv12,hwupload"
	}
	return scale + ",format=nv12,hwupload"
}
