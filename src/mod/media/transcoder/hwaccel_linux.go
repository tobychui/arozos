//go:build linux
// +build linux

package transcoder

/*
	hwaccel_linux.go

	NVIDIA GPUs are tried first via NVENC (its own proprietary encode API,
	needs the vendor driver but not VAAPI). Intel and AMD GPUs both expose
	hardware H.264 encoding through VAAPI via their respective iHD/Mesa
	drivers, so a single fallback profile covers both vendors, using the
	default DRM render node. If a given encoder is unsupported or its driver
	isn't present, testHWEncoder (hwaccel.go) will fail that profile's probe
	and the next candidate (or software encoding) is used instead.
*/

func candidateHWProfiles() []*hwEncoderProfile {
	return []*hwEncoderProfile{
		{
			Name:        "NVIDIA NVENC",
			Codec:       "h264_nvenc",
			ScaleFilter: nv12ScaleFilter,
			// -forced-idr: NVENC turns -force_key_frames into plain I-frames,
			// which the HLS muxer cannot cut on, so segments fall back to its
			// 250-frame GOP (~10s) and every seek has to wait for one.
			EncodeArgs: []string{"-preset", "fast", "-forced-idr", "1"},
		},
		{
			Name:     "Intel/AMD VAAPI",
			Codec:    "h264_vaapi",
			PreInput: []string{"-vaapi_device", "/dev/dri/renderD128"},
			ScaleFilter: func(height string) string {
				if height == "" {
					return "format=nv12,hwupload"
				}
				return "scale=-1:" + height + ",format=nv12,hwupload"
			},
		},
	}
}
