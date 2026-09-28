//go:build darwin
// +build darwin

package videoeditor

/*
	hwencoder_darwin.go

	VideoToolbox covers Apple Silicon and Intel Macs alike. It refuses to
	open a session for small frames, hence the larger probe frame.
*/

func candidateEncoders() []hwCandidate {
	return []hwCandidate{
		{Encoder: Encoder{
			Name:        "Apple VideoToolbox",
			Codec:       "h264_videotoolbox",
			FinalFilter: nv12Filter,
			Args:        []string{"-q:v", "65"},
		}, ProbeSize: "640x480"},
	}
}
