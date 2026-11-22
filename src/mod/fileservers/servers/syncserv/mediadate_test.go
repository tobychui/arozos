package syncserv

import (
	"bytes"
	"encoding/binary"
	"math/rand"
	"testing"
	"time"
)

// exifDate is "2026:08:14 10:22:01" padded to an EXIF ASCII value.
func exifASCII(text string) []byte {
	b := make([]byte, 20)
	copy(b, text)
	return b
}

// buildTIFF makes a TIFF structure with DateTime in IFD0 and, when original
// is set, DateTimeOriginal in an Exif IFD.
func buildTIFF(order binary.ByteOrder, original, modified string) []byte {
	buf := &bytes.Buffer{}
	w16 := func(v uint16) { b := make([]byte, 2); order.PutUint16(b, v); buf.Write(b) }
	w32 := func(v uint32) { b := make([]byte, 4); order.PutUint32(b, v); buf.Write(b) }
	if order == binary.LittleEndian {
		buf.WriteString("II")
	} else {
		buf.WriteString("MM")
	}
	w16(42)
	w32(8)
	const exifIFD = 8 + 2 + 2*12 + 4 //38
	const dataOriginal = exifIFD + 2 + 12 + 4
	const dataModified = dataOriginal + 20
	w16(2)
	w16(0x0132)
	w16(2)
	w32(20)
	w32(dataModified)
	w16(0x8769)
	w16(4)
	w32(1)
	if original == "" {
		w32(0)
	} else {
		w32(exifIFD)
	}
	w32(0)
	w16(1)
	w16(0x9003)
	w16(2)
	w32(20)
	w32(dataOriginal)
	w32(0)
	buf.Write(exifASCII(original))
	buf.Write(exifASCII(modified))
	return buf.Bytes()
}

func buildJPEG(tiff []byte) []byte {
	buf := &bytes.Buffer{}
	buf.Write([]byte{0xFF, 0xD8})
	//APP0 JFIF
	buf.Write([]byte{0xFF, 0xE0, 0x00, 0x10})
	buf.WriteString("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
	//APP1 Exif
	length := 2 + 6 + len(tiff)
	buf.Write([]byte{0xFF, 0xE1, byte(length >> 8), byte(length)})
	buf.WriteString("Exif\x00\x00")
	buf.Write(tiff)
	//Start of scan, some data, end of image
	buf.Write([]byte{0xFF, 0xDA, 0x00, 0x02, 0x11, 0x22, 0xFF, 0xD9})
	return buf.Bytes()
}

func pngChunk(typ string, data []byte) []byte {
	buf := &bytes.Buffer{}
	binary.Write(buf, binary.BigEndian, uint32(len(data)))
	buf.WriteString(typ)
	buf.Write(data)
	buf.Write([]byte{0, 0, 0, 0}) //CRC, not checked
	return buf.Bytes()
}

func buildPNG(chunks ...[]byte) []byte {
	buf := &bytes.Buffer{}
	buf.WriteString("\x89PNG\r\n\x1a\n")
	buf.Write(pngChunk("IHDR", make([]byte, 13)))
	for _, c := range chunks {
		buf.Write(c)
	}
	buf.Write(pngChunk("IDAT", []byte{1, 2, 3}))
	buf.Write(pngChunk("IEND", nil))
	return buf.Bytes()
}

func box(typ string, payload ...[]byte) []byte {
	body := bytes.Join(payload, nil)
	buf := &bytes.Buffer{}
	binary.Write(buf, binary.BigEndian, uint32(8+len(body)))
	buf.WriteString(typ)
	buf.Write(body)
	return buf.Bytes()
}

func fullBox(typ string, version byte, payload ...[]byte) []byte {
	return box(typ, append([][]byte{{version, 0, 0, 0}}, payload...)...)
}

func u16(v uint16) []byte { b := make([]byte, 2); binary.BigEndian.PutUint16(b, v); return b }
func u32(v uint32) []byte { b := make([]byte, 4); binary.BigEndian.PutUint32(b, v); return b }
func u64(v uint64) []byte { b := make([]byte, 8); binary.BigEndian.PutUint64(b, v); return b }

func infe(id uint16, typ string) []byte {
	return fullBox("infe", 2, u16(id), u16(0), []byte(typ), []byte{0})
}

// exifItem is the payload of a HEIF Exif item.
func exifItem(tiff []byte) []byte {
	return append(append(u32(6), []byte("Exif\x00\x00")...), tiff...)
}

// buildHEIF makes a HEIF file whose Exif item is in mdat (iloc version 0)
// or, with inIdat, inside the idat box of meta (iloc version 1).
func buildHEIF(tiff []byte, inIdat bool) []byte {
	ftyp := box("ftyp", []byte("heic"), u32(0), []byte("mif1heic"))
	payload := exifItem(tiff)
	iinf := fullBox("iinf", 0, u16(2), infe(1, "hvc1"), infe(2, "Exif"))
	if inIdat {
		iloc := fullBox("iloc", 1, u16(0x4400), u16(1),
			u16(2), u16(1), u16(0), u16(1), u32(0), u32(uint32(len(payload))))
		meta := fullBox("meta", 0, box("hdlr", make([]byte, 24)), iinf, iloc, box("idat", payload))
		return bytes.Join([][]byte{ftyp, meta, box("mdat", []byte("image data"))}, nil)
	}
	build := func(offset uint32) []byte {
		iloc := fullBox("iloc", 0, u16(0x4400), u16(2),
			u16(1), u16(0), u16(1), u32(0), u32(10),
			u16(2), u16(0), u16(1), u32(offset), u32(uint32(len(payload))))
		return fullBox("meta", 0, box("hdlr", make([]byte, 24)), iinf, iloc)
	}
	meta := build(0)
	offset := uint32(len(ftyp) + len(meta) + 8 + 10)
	meta = build(offset)
	mdat := box("mdat", []byte("image data"), payload)
	return bytes.Join([][]byte{ftyp, meta, mdat}, nil)
}

// buildMOV makes a QuickTime file with its movie header after the media data,
// as phones write them. With large, mdat uses a 64-bit size.
func buildMOV(created time.Time, version byte, large bool) []byte {
	ftyp := box("ftyp", []byte("qt  "), u32(0), []byte("qt  "))
	var mdat []byte
	if large {
		data := []byte("frames")
		mdat = bytes.Join([][]byte{u32(1), []byte("mdat"), u64(uint64(16 + len(data))), data}, nil)
	} else {
		mdat = box("mdat", []byte("frames"))
	}
	secs := uint64(created.Unix() - quicktimeEpoch)
	var mvhd []byte
	if version == 1 {
		mvhd = fullBox("mvhd", 1, u64(secs), u64(secs), u32(600), u64(1200), make([]byte, 80))
	} else {
		mvhd = fullBox("mvhd", 0, u32(uint32(secs)), u32(uint32(secs)), u32(600), u32(1200), make([]byte, 80))
	}
	moov := box("moov", mvhd, box("trak", []byte("track")))
	return bytes.Join([][]byte{ftyp, box("wide", nil), mdat, moov}, nil)
}

func TestMediaDate(t *testing.T) {
	want := time.Date(2026, 8, 14, 10, 22, 1, 0, time.Local)
	movieTime := time.Date(2026, 8, 14, 2, 22, 1, 0, time.UTC)
	le := buildTIFF(binary.LittleEndian, "2026:08:14 10:22:01", "2027:01:01 00:00:00")
	be := buildTIFF(binary.BigEndian, "2026:08:14 10:22:01", "2027:01:01 00:00:00")
	onlyModified := buildTIFF(binary.LittleEndian, "", "2026:08:14 10:22:01")
	xmp := append([]byte("XML:com.adobe.xmp\x00\x00\x00\x00\x00"), []byte(`<x:xmpmeta><rdf:Description photoshop:DateCreated="2026-08-14T10:22:01"/></x:xmpmeta>`)...)

	cases := []struct {
		name string
		data []byte
		want time.Time
		ok   bool
	}{
		{"jpeg little endian", buildJPEG(le), want, true},
		{"jpeg big endian", buildJPEG(be), want, true},
		{"jpeg DateTime only", buildJPEG(onlyModified), want, true},
		{"tiff raw", le, want, true},
		{"png eXIf", buildPNG(pngChunk("eXIf", be)), want, true},
		{"png xmp", buildPNG(pngChunk("iTXt", xmp)), want, true},
		{"png plain", buildPNG(), time.Time{}, false},
		{"heic in mdat", buildHEIF(le, false), want, true},
		{"heic in idat", buildHEIF(be, true), want, true},
		{"mov v0", buildMOV(movieTime, 0, false), movieTime, true},
		{"mov v1 large mdat", buildMOV(movieTime, 1, true), movieTime, true},
		{"jpeg zero date", buildJPEG(buildTIFF(binary.LittleEndian, "0000:00:00 00:00:00", "")), time.Time{}, false},
		{"text", []byte("this is not a photo at all, just words"), time.Time{}, false},
		{"tiny", []byte{0xFF, 0xD8}, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := MediaDate(bytes.NewReader(c.data), int64(len(c.data)))
		if ok != c.ok {
			t.Errorf("%s: ok = %v, want %v", c.name, ok, c.ok)
			continue
		}
		if ok && !got.Equal(c.want) {
			t.Errorf("%s: date = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestMediaDateHostileInput feeds cut and damaged files: the reader must
// never panic, hang or read outside the file.
func TestMediaDateHostileInput(t *testing.T) {
	le := buildTIFF(binary.LittleEndian, "2026:08:14 10:22:01", "2026:08:14 10:22:01")
	samples := [][]byte{
		buildJPEG(le),
		le,
		buildPNG(pngChunk("eXIf", le)),
		buildHEIF(le, false),
		buildHEIF(le, true),
		buildMOV(time.Now(), 0, false),
		buildMOV(time.Now(), 1, true),
	}
	values := []byte{0x00, 0x01, 0x7F, 0x80, 0xFE, 0xFF}
	rng := rand.New(rand.NewSource(1))
	for _, sample := range samples {
		for n := 0; n <= len(sample); n++ {
			MediaDate(bytes.NewReader(sample[:n]), int64(n))
		}
		for i := range sample {
			for _, v := range values {
				damaged := append([]byte(nil), sample...)
				damaged[i] = v
				MediaDate(bytes.NewReader(damaged), int64(len(damaged)))
			}
		}
		for round := 0; round < 2000; round++ {
			damaged := append([]byte(nil), sample...)
			for k := 0; k < 4; k++ {
				damaged[rng.Intn(len(damaged))] = byte(rng.Intn(256))
			}
			MediaDate(bytes.NewReader(damaged), int64(len(damaged)))
		}
	}
}

// TestMediaDateBoundaryValues puts the largest values in every size and
// offset field: they must be refused, not wrapped around.
func TestMediaDateBoundaryValues(t *testing.T) {
	huge := []byte{0xFF, 0xFF, 0xFF, 0xFF}
	le := buildTIFF(binary.LittleEndian, "2026:08:14 10:22:01", "")
	for _, sample := range [][]byte{buildHEIF(le, false), buildHEIF(le, true), buildMOV(time.Now(), 1, true), buildJPEG(le), le} {
		for i := 0; i+4 <= len(sample); i++ {
			damaged := append([]byte(nil), sample...)
			copy(damaged[i:], huge)
			MediaDate(bytes.NewReader(damaged), int64(len(damaged)))
			copy(damaged[i:], []byte{0x80, 0, 0, 0})
			MediaDate(bytes.NewReader(damaged), int64(len(damaged)))
		}
	}
	//A 64-bit box size larger than the file
	bad := bytes.Join([][]byte{u32(1), []byte("moov"), u64(1 << 63), make([]byte, 16)}, nil)
	if _, ok := MediaDate(bytes.NewReader(bad), int64(len(bad))); ok {
		t.Errorf("a box larger than the file was read")
	}
}
