//go:build linux
// +build linux

package videoeditor

/*
	hwencoder_linux.go

	NVIDIA through NVENC first, then Intel and AMD through VAAPI on the
	default DRM render node.
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
			Name:        "Intel/AMD VAAPI",
			Codec:       "h264_vaapi",
			PreInput:    []string{"-vaapi_device", "/dev/dri/renderD128"},
			FinalFilter: "format=nv12,hwupload",
			Args:        []string{"-qp", "21"},
		}},
	}
}
