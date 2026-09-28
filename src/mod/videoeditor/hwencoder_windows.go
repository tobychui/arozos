//go:build windows
// +build windows

package videoeditor

/*
	hwencoder_windows.go

	NVENC, Intel Quick Sync and AMD AMF all take system-memory frames, so no
	device setup is needed.
*/

func candidateEncoders() []hwCandidate {
	return []hwCandidate{
		{Encoder: Encoder{
			Name:        "NVIDIA NVENC",
			Codec:       "h264_nvenc",
			FinalFilter: nv12Filter,
			Args:        []string{"-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", "0"},
		}},
		{Encoder: Encoder{
			Name:        "Intel Quick Sync (QSV)",
			Codec:       "h264_qsv",
			FinalFilter: nv12Filter,
			Args:        []string{"-preset", "medium", "-global_quality", "21"},
		}},
		{Encoder: Encoder{
			Name:        "AMD AMF",
			Codec:       "h264_amf",
			FinalFilter: nv12Filter,
			Args:        []string{"-quality", "balanced", "-rc", "cqp", "-qp_i", "21", "-qp_p", "23"},
		}},
	}
}
