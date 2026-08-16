//go:build !linux && !windows
// +build !linux,!windows

package transcoder

/*
	hwaccel_other.go

	No Intel/AMD hardware encode path is implemented yet for platforms other
	than Linux and Windows (e.g. macOS, BSD). These hosts always fall back to
	software (libx264) transcoding.
*/

func candidateHWProfiles() []*hwEncoderProfile {
	return nil
}
