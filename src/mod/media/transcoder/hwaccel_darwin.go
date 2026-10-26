//go:build darwin
// +build darwin

package transcoder

/*
	hwaccel_darwin.go

	On macOS, hardware H.264 encoding is provided by the OS-level VideoToolbox
	framework (h264_videotoolbox), which is backed by the Apple Silicon media
	engine or the Intel/AMD GPU on older Macs alike - so a single profile covers
	every supported Mac. Like NVENC/QSV/AMF it accepts plain system-memory
	frames, so no explicit hardware device setup is needed (unlike VAAPI on
	Linux).

	-allow_sw defaults to false in ffmpeg, meaning the encoder refuses to open
	when no hardware encode path exists; that keeps testHWEncoder (hwaccel.go)
	honest and lets such hosts fall back to software (libx264) transcoding.
*/

func candidateHWProfiles() []*hwEncoderProfile {
	return []*hwEncoderProfile{
		{
			Name:        "Apple VideoToolbox",
			Codec:       "h264_videotoolbox",
			ScaleFilter: nv12ScaleFilter,
			// VideoToolbox has no -preset; -realtime hints the encoder to
			// prioritise keeping up with playback over compression efficiency,
			// which is what this live-streaming transcode path wants.
			EncodeArgs: []string{"-realtime", "1"},
			// VideoToolbox refuses to open a compression session for very small
			// frames (measured: 512x384 fails, 640x360 succeeds), so the shared
			// 320x240 probe frame would report a false negative on a Mac that
			// does support hardware encoding.
			ProbeSize: "640x480",
		},
	}
}
