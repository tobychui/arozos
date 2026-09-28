//go:build !linux && !windows && !darwin
// +build !linux,!windows,!darwin

package videoeditor

/*
	hwencoder_other.go

	No hardware encoder is tried on other platforms; renders use libx264.
*/

func candidateEncoders() []hwCandidate {
	return nil
}
