//go:build !race

package sharedspace

// raceDetectorEnabled reports whether this test binary was built with the
// race detector; see race_enabled_test.go.
const raceDetectorEnabled = false
