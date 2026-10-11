package officeart

/*
	blip.go - pictures ("BLIPs") and the picture store.

	A drawing group keeps every picture of the file once, in its
	BStoreContainer; shapes name them by 1-based index (the pib property).
	Each store entry (FBSE) either carries the BLIP record inline - Excel
	and Word's inline pictures - or points at it with an offset into a
	"delay" stream: PowerPoint's Pictures stream, Word's WordDocument
	stream for floating pictures.

	A bitmap BLIP is the file as it was (PNG, JPEG, TIFF) or a headerless
	DIB; a metafile BLIP (EMF, WMF, PICT) is usually DEFLATE compressed
	behind a small header that gives its bounds. DecodeBlip returns bytes
	in a form an image decoder or metafile.BrowserPicture accepts.
*/

import (
	"bytes"
	"compress/flate"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"io"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/metafile"
)

// Blip is one picture
type Blip struct {
	Data []byte
	// Ext names the format: png, jpeg, gif, tiff, emf, wmf, pict, bmp
	Ext  string
	Name string
}

// maxBlipSize guards the decompression of a metafile against a bomb
const maxBlipSize = 256 << 20

// DecodeBlip decodes a BLIP record (types 0xF018 - 0xF117)
func DecodeBlip(r *Record) (*Blip, error) {
	if r == nil || r.Type < BlipFirst || r.Type > BlipLast {
		return nil, errors.New("not a picture record")
	}
	// the instance names the format; an odd instance carries a second
	// 16-byte UID after the first
	inst := r.Instance
	uids := 16
	switch inst {
	case 0x3D5, 0x217, 0x543, 0x46B, 0x6E3, 0x6E1, 0x7A9, 0x6E5:
		uids = 32
	}
	b := r.Data
	switch r.Type {
	case BlipEMF, BlipWMF, BlipPICT:
		if len(b) < uids+34 {
			return nil, errShort
		}
		h := b[uids:]
		size := int(binary.LittleEndian.Uint32(h))
		saved := int(binary.LittleEndian.Uint32(h[28:]))
		compression := h[32]
		data := h[34:]
		if saved >= 0 && saved < len(data) {
			data = data[:saved]
		}
		if compression == 0 {
			out, err := inflate(data, size)
			if err != nil {
				return nil, err
			}
			data = out
		}
		ext := map[uint16]string{BlipEMF: "emf", BlipWMF: "wmf", BlipPICT: "pict"}[r.Type]
		return &Blip{Data: data, Ext: ext}, nil
	case BlipJPEG, BlipJPEGCMYK, BlipPNG, BlipDIB, BlipTIFF:
		if len(b) < uids+1 {
			return nil, errShort
		}
		data := b[uids+1:]
		switch r.Type {
		case BlipJPEG, BlipJPEGCMYK:
			return &Blip{Data: data, Ext: "jpeg"}, nil
		case BlipPNG:
			return &Blip{Data: data, Ext: sniff(data, "png")}, nil
		case BlipTIFF:
			return &Blip{Data: data, Ext: "tiff"}, nil
		case BlipDIB:
			png, err := metafile.DIBToPNG(data)
			if err != nil {
				return nil, err
			}
			return &Blip{Data: png, Ext: "png"}, nil
		}
	}
	return nil, errors.New("unsupported picture format")
}

// sniff corrects the stated format by the content's signature (Office
// stores GIFs as "PNG" BLIPs)
func sniff(data []byte, def string) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "jpeg"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "gif"
	}
	return def
}

// inflate undoes the DEFLATE compression of a metafile BLIP: a zlib
// stream in practice, raw DEFLATE by the letter of the specification
func inflate(data []byte, size int) ([]byte, error) {
	limit := int64(maxBlipSize)
	if size > 0 && size < maxBlipSize {
		limit = int64(size) + 1
	}
	if zr, err := zlib.NewReader(bytes.NewReader(data)); err == nil {
		out, err := io.ReadAll(io.LimitReader(zr, limit))
		if err == nil || (len(out) > 0 && errors.Is(err, io.ErrUnexpectedEOF)) {
			return out, nil
		}
	}
	out, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(data)), limit))
	if err != nil && len(out) == 0 {
		return nil, errors.New("cannot decompress the picture")
	}
	return out, nil
}

// ReadBSE decodes one picture store entry; delay is the stream its
// foDelay offset points into (nil when the host embeds every picture)
func ReadBSE(r *Record, delay []byte) *Blip {
	if r == nil || r.Type != FBSE || len(r.Data) < 36 {
		return nil
	}
	b := r.Data
	size := binary.LittleEndian.Uint32(b[20:])
	foDelay := binary.LittleEndian.Uint32(b[28:])
	cbName := int(b[33])
	name := ""
	if 36+cbName <= len(b) && cbName > 1 {
		u := make([]uint16, 0, cbName/2)
		for i := 36; i+1 < 36+cbName; i += 2 {
			c := binary.LittleEndian.Uint16(b[i:])
			if c == 0 {
				break
			}
			u = append(u, c)
		}
		name = string(utf16.Decode(u))
	}
	var blipRec *Record
	if inline := 36 + cbName; inline+HeaderSize <= len(b) {
		blipRec, _, _ = ParseOne(b, inline)
	} else if size > 0 && foDelay != 0xFFFFFFFF && delay != nil && int64(foDelay)+HeaderSize <= int64(len(delay)) {
		blipRec, _, _ = ParseOne(delay, int(foDelay))
	}
	if blipRec == nil {
		return nil
	}
	blip, err := DecodeBlip(blipRec)
	if err != nil {
		return nil
	}
	blip.Name = name
	return blip
}

// BStore decodes the picture store of a drawing group container; entry i
// is the picture shapes call pib i+1 (nil where it cannot be read)
func BStore(dgg *Record, delay []byte) []*Blip {
	store := dgg.Child(BStoreContainer)
	if store == nil {
		return nil
	}
	var out []*Blip
	for _, c := range store.Children {
		if c.Type == FBSE {
			out = append(out, ReadBSE(c, delay))
		} else if c.Type >= BlipFirst && c.Type <= BlipLast {
			b, _ := DecodeBlip(c)
			out = append(out, b)
		}
	}
	return out
}
