package pdfrender

import (
	"bytes"
	"compress/flate"
	"compress/zlib"
	"errors"
	"io"

	"golang.org/x/image/ccitt"
)

/*
	filters.go

	Stream data and the standard decode filters. Every filter is bounded by
	a byte limit so a small compressed stream cannot inflate into gigabytes,
	and corrupt data decodes as far as it is readable: a partly broken page
	still renders what it can.
*/

var errTooLarge = errors.New("pdfrender: stream too large")

// rawStream returns the stream bytes as stored, decrypted
func (d *Document) rawStream(s *Stream) ([]byte, error) {
	if s.data != nil || s.offset < 0 {
		return s.data, nil
	}
	if s.length > 1<<30 {
		return nil, errTooLarge
	}
	data := d.readAt(s.offset, s.length)
	if d.crypt != nil && s.ref != d.encryptRef {
		typ := d.name(s.Dict["Type"])
		skip := typ == "XRef" || (typ == "Metadata" && !d.crypt.encMet)
		//A /Crypt filter with the Identity filter means not encrypted
		for _, f := range d.filterList(s.Dict) {
			if f.name == "Crypt" {
				if d.name(f.parms["Name"]) == "Identity" || f.parms == nil {
					skip = true
				}
			}
		}
		if !skip {
			data = d.crypt.decrypt(data, s.ref, d.crypt.stmM)
		}
	}
	return data, nil
}

type filterSpec struct {
	name  Name
	parms Dict
}

// filterList reads /Filter and /DecodeParms (or the inline image short forms)
func (d *Document) filterList(dict Dict) []filterSpec {
	f := d.resolve(dict["Filter"])
	if f == nil {
		f = d.resolve(dict["F"])
	}
	p := d.resolve(dict["DecodeParms"])
	if p == nil {
		p = d.resolve(dict["DP"])
	}
	var out []filterSpec
	switch v := f.(type) {
	case Name:
		out = append(out, filterSpec{name: expandFilter(v), parms: d.dict(firstOf(p))})
	case Array:
		pa, _ := p.(Array)
		for i, e := range v {
			var parms Dict
			if i < len(pa) {
				parms = d.dict(pa[i])
			} else if pd, ok := p.(Dict); ok && len(v) == 1 {
				parms = pd
			}
			out = append(out, filterSpec{name: expandFilter(d.name(e)), parms: parms})
		}
	}
	return out
}

func firstOf(o Object) Object {
	if a, ok := o.(Array); ok {
		if len(a) > 0 {
			return a[0]
		}
		return nil
	}
	return o
}

func expandFilter(n Name) Name {
	switch n {
	case "AHx":
		return "ASCIIHexDecode"
	case "A85":
		return "ASCII85Decode"
	case "LZW":
		return "LZWDecode"
	case "Fl":
		return "FlateDecode"
	case "RL":
		return "RunLengthDecode"
	case "CCF":
		return "CCITTFaxDecode"
	case "DCT":
		return "DCTDecode"
	}
	return n
}

// isImageCodec reports filters whose output is an image, not a byte stream
func isImageCodec(n Name) bool {
	return n == "DCTDecode" || n == "JPXDecode" || n == "JBIG2Decode"
}

// decodeStream applies every filter of the stream
func (d *Document) decodeStream(s *Stream, limit int) ([]byte, error) {
	data, _, _, err := d.decodeStreamImage(s, limit, false)
	return data, err
}

// decodeStreamImage applies the filters, stopping before an image codec
// when stopAtImage is set. It returns the data and the remaining codec.
func (d *Document) decodeStreamImage(s *Stream, limit int, stopAtImage bool) ([]byte, Name, Dict, error) {
	data, err := d.rawStream(s)
	if err != nil {
		return nil, "", nil, err
	}
	filters := d.filterList(s.Dict)
	for i, f := range filters {
		if stopAtImage && isImageCodec(f.name) {
			return data, f.name, f.parms, nil
		}
		var out []byte
		switch f.name {
		case "FlateDecode":
			out, err = flateDecode(data, limit)
			if err == nil || len(out) > 0 {
				out, err = applyPredictor(d, out, f.parms)
			}
		case "LZWDecode":
			early := 1
			if f.parms != nil {
				early = d.integer(f.parms["EarlyChange"], 1)
			}
			out, err = lzwDecode(data, early, limit)
			if err == nil || len(out) > 0 {
				out, err = applyPredictor(d, out, f.parms)
			}
		case "ASCIIHexDecode":
			out = asciiHexDecode(data)
		case "ASCII85Decode":
			out = ascii85Decode(data)
		case "RunLengthDecode":
			out, err = runLengthDecode(data, limit)
		case "CCITTFaxDecode":
			out, err = d.ccittDecode(data, f.parms, s.Dict, limit)
		case "Crypt":
			out = data
		case "DCTDecode", "JPXDecode", "JBIG2Decode":
			//Image codecs outside an image context are left encoded
			return data, f.name, f.parms, nil
		default:
			return data, "", nil, errors.New("pdfrender: unsupported filter " + string(f.name))
		}
		if err != nil && len(out) == 0 {
			return nil, "", nil, err
		}
		if len(out) > limit {
			return nil, "", nil, errTooLarge
		}
		data = out
		_ = i
	}
	return data, "", nil, nil
}

type limitWriter struct {
	buf   bytes.Buffer
	limit int
}

func (w *limitWriter) Write(p []byte) (int, error) {
	if w.buf.Len()+len(p) > w.limit {
		return 0, errTooLarge
	}
	return w.buf.Write(p)
}

func flateDecode(data []byte, limit int) ([]byte, error) {
	w := &limitWriter{limit: limit}
	zr, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		//Some writers omit the zlib header; try raw deflate
		fr := flate.NewReader(bytes.NewReader(data))
		_, err = io.Copy(w, fr)
		if err == errTooLarge {
			return nil, err
		}
		if w.buf.Len() == 0 && len(data) > 2 {
			w.buf.Reset()
			fr = flate.NewReader(bytes.NewReader(data[2:]))
			_, err = io.Copy(w, fr)
		}
		return w.buf.Bytes(), nilIfData(err, w.buf.Len())
	}
	_, err = io.Copy(w, zr)
	if err == errTooLarge {
		return nil, err
	}
	//A truncated or checksum broken stream still gives usable data
	return w.buf.Bytes(), nilIfData(err, w.buf.Len())
}

func nilIfData(err error, n int) error {
	if n > 0 {
		return nil
	}
	return err
}

func applyPredictor(d *Document, data []byte, parms Dict) ([]byte, error) {
	if parms == nil {
		return data, nil
	}
	pred := d.integer(parms["Predictor"], 1)
	if pred <= 1 {
		return data, nil
	}
	colors := d.integer(parms["Colors"], 1)
	bpc := d.integer(parms["BitsPerComponent"], 8)
	cols := d.integer(parms["Columns"], 1)
	if colors < 1 || colors > 32 || bpc < 1 || bpc > 16 || cols < 1 || cols > 1<<20 {
		return data, nil
	}
	bpp := (colors*bpc + 7) / 8
	rowLen := (colors*bpc*cols + 7) / 8
	if pred == 2 {
		//TIFF predictor, 8 bit samples only (the common case)
		if bpc != 8 {
			return data, nil
		}
		out := append([]byte{}, data...)
		for r := 0; r+rowLen <= len(out); r += rowLen {
			for i := bpp; i < rowLen; i++ {
				out[r+i] += out[r+i-bpp]
			}
		}
		return out, nil
	}
	//PNG predictors: every row starts with its filter type byte
	out := make([]byte, 0, len(data))
	prev := make([]byte, rowLen)
	cur := make([]byte, rowLen)
	for pos := 0; pos < len(data); {
		ft := data[pos]
		pos++
		n := copy(cur, data[pos:])
		pos += n
		for i := n; i < rowLen; i++ {
			cur[i] = 0
		}
		switch ft {
		case 1:
			for i := bpp; i < rowLen; i++ {
				cur[i] += cur[i-bpp]
			}
		case 2:
			for i := 0; i < rowLen; i++ {
				cur[i] += prev[i]
			}
		case 3:
			for i := 0; i < rowLen; i++ {
				left := 0
				if i >= bpp {
					left = int(cur[i-bpp])
				}
				cur[i] += byte((left + int(prev[i])) / 2)
			}
		case 4:
			for i := 0; i < rowLen; i++ {
				var a, c int
				if i >= bpp {
					a = int(cur[i-bpp])
					c = int(prev[i-bpp])
				}
				b := int(prev[i])
				p := a + b - c
				pa, pb, pc := abs(p-a), abs(p-b), abs(p-c)
				if pa <= pb && pa <= pc {
					cur[i] += byte(a)
				} else if pb <= pc {
					cur[i] += byte(b)
				} else {
					cur[i] += byte(c)
				}
			}
		}
		out = append(out, cur[:n]...)
		prev, cur = cur, prev
		if n < rowLen {
			break
		}
	}
	return out, nil
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// lzwDecode is the PDF flavour of LZW (MSB first, optional early change)
func lzwDecode(data []byte, early int, limit int) ([]byte, error) {
	type entry struct {
		prefix int
		last   byte
		length int
	}
	table := make([]entry, 4096)
	for i := 0; i < 256; i++ {
		table[i] = entry{prefix: -1, last: byte(i), length: 1}
	}
	next := 258
	width := 9
	out := make([]byte, 0, len(data)*3)
	var bitBuf uint32
	bits := 0
	pos := 0
	prev := -1
	buf := make([]byte, 4096)
	emit := func(code int) []byte {
		n := table[code].length
		if n > len(buf) {
			n = len(buf)
		}
		s := buf[:n]
		for i := n - 1; i >= 0 && code >= 0; i-- {
			s[i] = table[code].last
			code = table[code].prefix
		}
		return s
	}
	for {
		for bits < width && pos < len(data) {
			bitBuf = bitBuf<<8 | uint32(data[pos])
			pos++
			bits += 8
		}
		if bits < width {
			break
		}
		code := int(bitBuf>>(bits-width)) & (1<<width - 1)
		bits -= width
		if code == 256 {
			next = 258
			width = 9
			prev = -1
			continue
		}
		if code == 257 {
			break
		}
		var first byte
		if code < next {
			s := emit(code)
			if len(s) == 0 {
				break
			}
			first = s[0]
			out = append(out, s...)
		} else if code == next && prev >= 0 {
			s := emit(prev)
			if len(s) == 0 {
				break
			}
			first = s[0]
			out = append(out, s...)
			out = append(out, first)
		} else {
			break
		}
		if len(out) > limit {
			return nil, errTooLarge
		}
		if prev >= 0 && next < 4096 {
			table[next] = entry{prefix: prev, last: first, length: table[prev].length + 1}
			next++
		}
		prev = code
		if next+early >= 1<<width && width < 12 {
			width++
		}
	}
	return out, nil
}

func asciiHexDecode(data []byte) []byte {
	out := make([]byte, 0, len(data)/2)
	hi := -1
	for _, c := range data {
		if c == '>' {
			break
		}
		v := unhex(c)
		if v < 0 {
			continue
		}
		if hi < 0 {
			hi = v
		} else {
			out = append(out, byte(hi<<4|v))
			hi = -1
		}
	}
	if hi >= 0 {
		out = append(out, byte(hi<<4))
	}
	return out
}

func ascii85Decode(data []byte) []byte {
	out := make([]byte, 0, len(data))
	if bytes.HasPrefix(data, []byte("<~")) {
		data = data[2:]
	}
	var group [5]byte
	n := 0
	flush := func(count int) {
		var v uint32
		for i := 0; i < 5; i++ {
			c := byte('u')
			if i < count {
				c = group[i]
			}
			v = v*85 + uint32(c-'!')
		}
		b := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
		out = append(out, b[:count-1]...)
	}
	for _, c := range data {
		if c == '~' {
			break
		}
		if isWhite(c) {
			continue
		}
		if c == 'z' && n == 0 {
			out = append(out, 0, 0, 0, 0)
			continue
		}
		if c < '!' || c > 'u' {
			continue
		}
		group[n] = c
		n++
		if n == 5 {
			flush(5)
			n = 0
		}
	}
	if n > 1 {
		flush(n)
	}
	return out
}

func runLengthDecode(data []byte, limit int) ([]byte, error) {
	out := make([]byte, 0, len(data)*2)
	for i := 0; i < len(data); {
		l := int(data[i])
		i++
		if l == 128 {
			break
		}
		if l < 128 {
			n := l + 1
			if n > len(data)-i {
				n = len(data) - i
			}
			out = append(out, data[i:i+n]...)
			i += n
		} else {
			if i >= len(data) {
				break
			}
			for k := 0; k < 257-l; k++ {
				out = append(out, data[i])
			}
			i++
		}
		if len(out) > limit {
			return nil, errTooLarge
		}
	}
	return out, nil
}

func (d *Document) ccittDecode(data []byte, parms Dict, dict Dict, limit int) ([]byte, error) {
	k := 0
	cols := 1728
	rows := 0
	blackIs1 := false
	align := false
	if parms != nil {
		k = d.integer(parms["K"], 0)
		cols = d.integer(parms["Columns"], 1728)
		rows = d.integer(parms["Rows"], 0)
		if b, ok := d.resolve(parms["BlackIs1"]).(bool); ok {
			blackIs1 = b
		}
		if b, ok := d.resolve(parms["EncodedByteAlign"]).(bool); ok {
			align = b
		}
	}
	if rows <= 0 {
		rows = d.integer(dict["Height"], 0)
		if rows <= 0 {
			rows = d.integer(dict["H"], 0)
		}
	}
	if cols <= 0 || cols > 1<<16 || rows <= 0 || rows > 1<<16 || int64(cols+7)/8*int64(rows) > int64(limit) {
		return nil, errTooLarge
	}
	sf := ccitt.Group3
	if k < 0 {
		sf = ccitt.Group4
	}
	r := ccitt.NewReader(bytes.NewReader(data), ccitt.MSB, sf, cols, rows, &ccitt.Options{Align: align, Invert: blackIs1})
	out := make([]byte, (cols+7)/8*rows)
	n, err := io.ReadFull(r, out)
	if n == 0 {
		return nil, err
	}
	//Rows the decoder could not reach stay white
	for i := n; i < len(out); i++ {
		out[i] = 0xff
		if blackIs1 {
			out[i] = 0
		}
	}
	return out, nil
}
