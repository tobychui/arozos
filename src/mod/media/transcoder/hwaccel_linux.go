//go:build linux
// +build linux

package transcoder

/*
	hwaccel_linux.go

	NVIDIA GPUs are tried first via NVENC (its own proprietary encode API,
	needs the vendor driver but not VAAPI). Intel and AMD GPUs both expose
	hardware decoding, scaling and H.264 encoding through VAAPI via their
	respective iHD/Mesa drivers, so the VAAPI profiles (hwaccel_vaapi.go) cover
	both vendors on every DRM render node present. If a given encoder is
	unsupported or its driver isn't present, testHWEncoder (hwaccel.go) will
	fail that profile's probe and the next candidate (or software encoding) is
	used instead.
*/

func candidateHWProfiles() []*hwEncoderProfile {
	profiles := []*hwEncoderProfile{
		{
			Name:        "NVIDIA NVENC",
			Codec:       "h264_nvenc",
			ScaleFilter: nv12ScaleFilter,
			// -forced-idr: NVENC turns -force_key_frames into plain I-frames,
			// which the HLS muxer cannot cut on, so segments fall back to its
			// 250-frame GOP (~10s) and every seek has to wait for one.
			EncodeArgs: []string{"-preset", "fast", "-forced-idr", "1"},
		},
	}
	for _, device := range vaapiRenderNodes() {
		profiles = append(profiles, vaapiProfiles(device)...)
	}
	return profiles
}
