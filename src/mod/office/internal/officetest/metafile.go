package officetest

import (
	"bytes"
	"encoding/binary"
	"image/color"
)

/* ---------------- metafile fixtures ---------------- */

var (
	MfRed   = color.NRGBA{255, 0, 0, 255}
	MfGreen = color.NRGBA{0, 255, 0, 255}
	MfBlue  = color.NRGBA{0, 0, 255, 255}
	MfWhite = color.NRGBA{255, 255, 255, 255}
)

func Le16(v int) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, uint16(int16(v)))
	return b
}

func Le32(v int64) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(v))
	return b
}

func Cat(parts ...[]byte) []byte {
	return bytes.Join(parts, nil)
}

// dib24 builds a packed bottom-up 24-bit BITMAPINFOHEADER DIB
func Dib24(w, h int, px func(x, y int) color.NRGBA) []byte {
	stride := (w*3 + 3) &^ 3
	hdr := Cat(Le32(40), Le32(int64(w)), Le32(int64(h)), Le16(1), Le16(24), Le32(0),
		Le32(int64(stride*h)), Le32(0), Le32(0), Le32(0), Le32(0))
	bits := make([]byte, stride*h)
	for y := 0; y < h; y++ {
		row := (h - 1 - y) * stride
		for x := 0; x < w; x++ {
			c := px(x, y)
			bits[row+3*x], bits[row+3*x+1], bits[row+3*x+2] = c.B, c.G, c.R
		}
	}
	return Cat(hdr, bits)
}

// quadrants: red top-left, green top-right, blue bottom-left, white bottom-right
func Quadrants(w, h int) func(x, y int) color.NRGBA {
	return func(x, y int) color.NRGBA {
		switch {
		case x < w/2 && y < h/2:
			return MfRed
		case y < h/2:
			return MfGreen
		case x < w/2:
			return MfBlue
		}
		return MfWhite
	}
}

// wmfRec builds one WMF record from 16-bit words and a byte tail
func WmfRec(fn uint16, words []int, tail []byte) []byte {
	if len(tail)%2 == 1 {
		tail = append(tail, 0)
	}
	var b bytes.Buffer
	b.Write(Le32(int64(3 + len(words) + len(tail)/2)))
	binary.Write(&b, binary.LittleEndian, fn)
	for _, w := range words {
		b.Write(Le16(w))
	}
	b.Write(tail)
	return b.Bytes()
}

func WmfColor(c color.NRGBA) []int {
	return []int{int(c.R) | int(c.G)<<8, int(c.B)}
}

// buildWmf wraps records in a placeable header (box in logical units,
// inch units per inch) and the standard header, ending with EOF
func BuildWmf(box [4]int, inch int, recs ...[]byte) []byte {
	var b bytes.Buffer
	b.Write(Le32(0x9AC6CDD7))
	b.Write(Le16(0))
	for _, v := range box {
		b.Write(Le16(v))
	}
	b.Write(Le16(inch))
	b.Write(Le32(0))
	b.Write(Le16(0))
	b.Write(Cat(Le16(1), Le16(9), Le16(0x300), Le32(0), Le16(8), Le32(0), Le16(0)))
	for _, r := range recs {
		b.Write(r)
	}
	b.Write(WmfRec(0, nil, nil))
	return b.Bytes()
}

// emfRecBytes builds one EMF record from 32-bit values and a byte tail
func EmfRecBytes(typ int, vals []int64, tail []byte) []byte {
	for len(tail)%4 != 0 {
		tail = append(tail, 0)
	}
	var b bytes.Buffer
	b.Write(Le32(int64(typ)))
	b.Write(Le32(int64(8 + 4*len(vals) + len(tail))))
	for _, v := range vals {
		b.Write(Le32(v))
	}
	b.Write(tail)
	return b.Bytes()
}

// buildEmf writes a header whose frame is w x h millimetres on a 1 px per
// 0.1 mm reference device (so a logical unit is 0.1 mm), records and EOF
func BuildEmf(wMM, hMM int, recs ...[]byte) []byte {
	devW, devH := wMM*10, hMM*10
	hdr := Cat(Le32(1), Le32(88),
		Le32(0), Le32(0), Le32(int64(devW-1)), Le32(int64(devH-1)),
		Le32(0), Le32(0), Le32(int64(wMM*100)), Le32(int64(hMM*100)),
		[]byte(" EMF"), Le32(0x10000), Le32(0), Le32(0), Le16(8), Le16(0),
		Le32(0), Le32(0), Le32(0),
		Le32(int64(devW)), Le32(int64(devH)), Le32(int64(wMM)), Le32(int64(hMM)))
	var b bytes.Buffer
	b.Write(hdr)
	for _, r := range recs {
		b.Write(r)
	}
	b.Write(EmfRecBytes(14, []int64{0, 0, 20}, nil))
	return b.Bytes()
}

func EmfColor(c color.NRGBA) int64 {
	return int64(c.R) | int64(c.G)<<8 | int64(c.B)<<16
}

// emfSolidBrush creates brush ih and selects it, with a null pen
func EmfSolidBrush(ih int64, c color.NRGBA) [][]byte {
	return [][]byte{
		EmfRecBytes(39, []int64{ih, 0, EmfColor(c), 0}, nil),
		EmfRecBytes(37, []int64{ih}, nil),
		EmfRecBytes(37, []int64{0x80000008}, nil), // NULL_PEN
	}
}
