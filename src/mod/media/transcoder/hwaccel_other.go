//go:build !linux && !windows && !darwin
// +build !linux,!windows,!darwin

package transcoder

/*
	hwaccel_other.go

	No hardware encode path is implemented yet for platforms other than Linux,
	Windows and macOS (e.g. BSD). These hosts always fall back to software
	(libx264) transcoding.
*/

func candidateHWProfiles() []*hwEncoderProfile {
	return nil
}
