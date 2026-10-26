//go:build race

package sharedspace

// raceDetectorEnabled reports whether this test binary was built with the
// race detector. The bundled boltdb v1.3.1 performs unsafe pointer
// arithmetic that trips the race detector's checkptr instrumentation, so
// database-backed tests skip themselves under -race (CI runs the full
// suite without -race, where they always execute).
const raceDetectorEnabled = true
