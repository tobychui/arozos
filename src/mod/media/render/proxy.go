package render

/*
	proxy.go

	Proxy media: browser-playable stand-ins for footage the browser cannot
	decode (HEVC, AVI, ProRes, 10-bit H.264, WMA, TIFF, ...) or that is too
	large to scrub comfortably. The editor previews the proxy and the final
	render still reads the original.

	Like graph.go this only builds arguments; the caller runs ffmpeg.
*/

import (
	"fmt"
	"strconv"
)

// Proxy kinds.
const (
	ProxyVideo = "video"
	ProxyAudio = "audio"
	ProxyImage = "image"
)

// Proxy output extensions per kind. H.264 / AAC in MP4 and PNG are what
// every mainstream browser decodes.
var ProxyExtension = map[string]string{
	ProxyVideo: ".mp4",
	ProxyAudio: ".m4a",
	ProxyImage: ".png",
}

// ProxyArgs builds the ffmpeg arguments (without the output path) for a
// proxy of the given kind. height caps the video height (0 keeps the source
// size); footage is never upscaled. enc selects the video encoder (nil =
// libx264).
func ProxyArgs(kind string, input string, height int, enc *Encoder) ([]string, error) {
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin"}
	switch kind {
	case ProxyVideo:
		if enc != nil {
			args = append(args, enc.PreInput...)
		}
		args = append(args, "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1")
		// Even dimensions for the encoder; -2 derives the width from the
		// aspect ratio. min() keeps small sources at their own size.
		vf := "scale=trunc(iw/2)*2:trunc(ih/2)*2"
		if height > 0 {
			vf = fmt.Sprintf("scale=-2:'min(ih,%d)'", height)
		}
		if enc != nil && enc.FinalFilter != "" {
			vf += "," + enc.FinalFilter
			args = append(args, "-vf", vf, "-c:v", enc.Codec)
			args = append(args, enc.Args...)
		} else {
			vf += ",format=yuv420p"
			args = append(args, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "main")
		}
		// Keyframes every two seconds keep seeking snappy in the editor
		args = append(args, "-g", "48", "-c:a", "aac", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart")
	case ProxyAudio:
		args = append(args, "-i", input, "-vn", "-sn", "-dn", "-map_metadata", "-1", "-c:a", "aac", "-ac", "2", "-b:a", "160k", "-movflags", "+faststart")
	case ProxyImage:
		args = append(args, "-i", input, "-frames:v", "1", "-update", "1")
	default:
		return nil, fmt.Errorf("unsupported proxy kind %q", kind)
	}
	return args, nil
}

// ProxyHeight maps a preview quality fraction (1, 0.5, 0.25) and a project
// height to the proxy height the editor should ask for: the project height
// scaled by the fraction, never below 240 pixels so thumbnails stay
// readable, and 0 (source size) at full quality.
func ProxyHeight(projectHeight int, quality float64) int {
	if quality >= 1 || quality <= 0 || projectHeight <= 0 {
		return 0
	}
	h := int(float64(projectHeight) * quality)
	if h < 240 {
		h = 240
	}
	return h - h%2
}

// ProxyCacheName derives a stable file name for the proxy of a source so
// the same footage at the same quality is only ever converted once.
func ProxyCacheName(sourceKey string, kind string, height int) string {
	return "proxy_" + sourceKey + "_" + strconv.Itoa(height) + ProxyExtension[kind]
}
