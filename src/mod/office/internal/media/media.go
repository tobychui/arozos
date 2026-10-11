/*
Package media handles the pictures, video and audio inside office
documents: data URLs in and out, the MIME types and file extensions of
media parts, sniffing an image's format and natural size, the media?file=
links the editors keep for pictures from the user's storage, and the
numbered media entries the package writers collect.
*/
package media

import (
	"bytes"
	"image"
)

// ImageConfig probes image bytes for their natural pixel size (decoders
// are registered by the docx writer's blank imports)
func ImageConfig(data []byte) (image.Config, string, error) {
	return image.DecodeConfig(bytes.NewReader(data))
}

type Entry struct {
	Index int
	Ext   string
	Data  []byte
}
