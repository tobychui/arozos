//go:build windows
// +build windows

package transcoder

/*
	hwaccel_windows.go

	On Windows, ffmpeg's h264_nvenc (NVIDIA), h264_qsv (Intel Quick Sync) and
	h264_amf (AMD AMF) encoders all accept plain system-memory frames
	directly, so no explicit hardware device/frames-context setup is needed
	(unlike VAAPI on Linux). NVIDIA is tried first as the most broadly capable
	path, then Intel Quick Sync, then AMD as the fallback for machines with
	neither.
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
			Name:        "Intel Quick Sync (QSV)",
			Codec:       "h264_qsv",
			ScaleFilter: nv12ScaleFilter,
			EncodeArgs:  []string{"-preset", "fast"},
		},
		{
			Name:        "AMD AMF",
			Codec:       "h264_amf",
			ScaleFilter: nv12ScaleFilter,
			EncodeArgs:  []string{"-quality", "speed", "-usage", "transcoding"},
		},
	}
}
