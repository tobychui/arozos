package syncserv

import (
	"encoding/binary"
	"io"
	"regexp"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	mediadate.go

	Reads when a photo or video was taken from the file itself, for the
	"date taken or created" folders: EXIF of JPEG, TIFF and camera raw files,
	the eXIf chunk and XMP of PNG files, the Exif item of HEIF, HEIC and AVIF
	files, and the movie header of MP4 and MOV files.

	Every upload goes through here, so the files are untrusted: every offset
	is checked against the end of its region before it is read, nothing is
	allocated from a length in the file beyond a small cap, and every walk
	has a fixed number of steps.
*/

const (
	maxMetaBox    = 4 << 20 //Largest HEIF meta box read into memory
	maxTextChunk  = 1 << 20 //Largest PNG text chunk searched for XMP
	maxIFDEntries = 512
	maxBoxes      = 256
)

var exifLayouts = []string{
	"2006:01:02 15:04:05",
	"2006-01-02 15:04:05",
	"2006:01:02 15:04",
	"2006-01-02T15:04:05",
	"2006:01:02",
}

// exifTime reads an EXIF date. EXIF dates carry no time zone: they are the
// time on the camera, which is what the folders should follow.
func exifTime(text string) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "exifTime", "text", text), &out0, &out1)
	text = strings.TrimSpace(strings.TrimRight(text, "\x00 "))
	if text == "" || strings.HasPrefix(text, "0000") {
		return time.Time{}, false
	}
	for _, layout := range exifLayouts {
		if t, err := time.ParseInLocation(layout, text, time.Local); err == nil && plausible(t) {
			return t, true
		}
	}
	return time.Time{}, false
}

// MediaDate reads when a photo or video was taken from its metadata.
func MediaDate(r io.ReaderAt, size int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "MediaDate", "r", r, "size", size), &out0, &out1)
	var head [12]byte
	if size < int64(len(head)) {
		return time.Time{}, false
	}
	if _, err := r.ReadAt(head[:], 0); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return time.Time{}, false
	}
	switch {
	case head[0] == 0xFF && head[1] == 0xD8:
		return jpegDate(r, size)
	case string(head[:4]) == "II*\x00" || string(head[:4]) == "MM\x00*":
		return tiffDate(r, 0, size)
	case string(head[:8]) == "\x89PNG\r\n\x1a\n":
		return pngDate(r, size)
	case isoBoxType(string(head[4:8])):
		return isoDate(r, size)
	}
	return time.Time{}, false
}

/*
	JPEG
*/

func jpegDate(r io.ReaderAt, size int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "jpegDate", "r", r, "size", size), &out0, &out1)
	off := int64(2)
	for i := 0; i < maxBoxes && off <= size-4; i++ {
		var hdr [4]byte
		if _, err := r.ReadAt(hdr[:], off); err != nil || hdr[0] != 0xFF {
			break
		}
		marker := hdr[1]
		switch {
		case marker == 0xFF:
			//Fill byte
			off++
			continue
		case marker == 0x01 || marker == 0xD8 || (marker >= 0xD0 && marker <= 0xD7):
			//Markers without a length
			off += 2
			continue
		case marker == 0xDA || marker == 0xD9:
			//The image data starts: metadata comes before it
			return time.Time{}, false
		}
		length := int64(binary.BigEndian.Uint16(hdr[2:]))
		if length < 2 || length > size-off-2 {
			break
		}
		if marker == 0xE1 && length >= 8+8 {
			var sig [6]byte
			if _, err := r.ReadAt(sig[:], off+4); err == nil && string(sig[:]) == "Exif\x00\x00" {
				if t, ok := tiffDate(r, off+10, off+2+length); ok {
					return t, true
				}
			}
		}
		off += 2 + length
	}
	return time.Time{}, false
}

/*
	TIFF (EXIF)
*/

// tiffRegion is a TIFF structure in [start, end) of a file. Offsets inside
// it are relative to start.
type tiffRegion struct {
	r          io.ReaderAt
	start, end int64
	order      binary.ByteOrder
}

func (t *tiffRegion) read(off int64, n int) (out0 []byte, out1 bool) {
	defer logger.Out2(logger.In3("fileservers/servers/syncserv", "tiffRegion.read", "t", t, "off", off, "n", n), &out0, &out1)
	if off < 0 || n < 0 || off > t.end-t.start-int64(n) {
		return nil, false
	}
	buf := make([]byte, n)
	if _, err := t.r.ReadAt(buf, t.start+off); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return nil, false
	}
	return buf, true
}

// entries calls fn for every entry of the IFD at off.
func (t *tiffRegion) entries(off int64, fn func(tag, typ uint16, count uint32, value []byte)) {
	defer logger.Out0(logger.In3("fileservers/servers/syncserv", "tiffRegion.entries", "t", t, "off", off, "fn", fn))
	head, ok := t.read(off, 2)
	if !ok {
		return
	}
	n := int(t.order.Uint16(head))
	if n > maxIFDEntries {
		n = maxIFDEntries
	}
	body, ok := t.read(off+2, n*12)
	if !ok {
		return
	}
	for i := 0; i < n; i++ {
		e := body[i*12 : i*12+12]
		fn(t.order.Uint16(e), t.order.Uint16(e[2:]), t.order.Uint32(e[4:]), e[8:12])
	}
}

// ascii reads an ASCII entry short enough to be a date.
func (t *tiffRegion) ascii(typ uint16, count uint32, value []byte) (out0 string) {
	defer logger.Out1(logger.In4("fileservers/servers/syncserv", "tiffRegion.ascii", "t", t, "typ", typ, "count", count, "value", value), &out0)
	if typ != 2 || count == 0 || count > 64 {
		return ""
	}
	if count <= 4 {
		return string(value[:count])
	}
	b, ok := t.read(int64(t.order.Uint32(value)), int(count))
	if !ok {
		return ""
	}
	return string(b)
}

func tiffDate(r io.ReaderAt, start, end int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In3("fileservers/servers/syncserv", "tiffDate", "r", r, "start", start, "end", end), &out0, &out1)
	if start < 0 || end-start < 8 {
		return time.Time{}, false
	}
	t := &tiffRegion{r: r, start: start, end: end}
	head, ok := t.read(0, 8)
	if !ok {
		return time.Time{}, false
	}
	switch string(head[:2]) {
	case "II":
		t.order = binary.LittleEndian
	case "MM":
		t.order = binary.BigEndian
	default:
		return time.Time{}, false
	}
	if t.order.Uint16(head[2:]) != 42 {
		return time.Time{}, false
	}

	exifIFD := int64(-1)
	modified := ""
	t.entries(int64(t.order.Uint32(head[4:])), func(tag, typ uint16, count uint32, value []byte) {
		switch tag {
		case 0x8769: //Exif IFD
			if typ == 4 || typ == 13 {
				exifIFD = int64(t.order.Uint32(value))
			}
		case 0x0132: //DateTime, when the file was last changed
			modified = t.ascii(typ, count, value)
		}
	})
	if exifIFD > 0 {
		original, digitized := "", ""
		t.entries(exifIFD, func(tag, typ uint16, count uint32, value []byte) {
			switch tag {
			case 0x9003:
				original = t.ascii(typ, count, value)
			case 0x9004:
				digitized = t.ascii(typ, count, value)
			}
		})
		for _, text := range []string{original, digitized} {
			if when, ok := exifTime(text); ok {
				return when, true
			}
		}
	}
	return exifTime(modified)
}

/*
	PNG
*/

var xmpDatePattern = regexp.MustCompile(`(?:exif:DateTimeOriginal|photoshop:DateCreated|xmp:CreateDate)\s*(?:=\s*["']|>)\s*([0-9][0-9T:.+\- Z]{9,34})`)

func xmpDate(text []byte) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "xmpDate", "text", text), &out0, &out1)
	m := xmpDatePattern.FindSubmatch(text)
	if m == nil {
		return time.Time{}, false
	}
	return ParseDate(strings.TrimSpace(string(m[1])))
}

func pngDate(r io.ReaderAt, size int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "pngDate", "r", r, "size", size), &out0, &out1)
	off := int64(8)
	for i := 0; i < 4096 && off <= size-12; i++ {
		var hdr [8]byte
		if _, err := r.ReadAt(hdr[:], off); err != nil {
			logger.DebugErr("fileservers/servers/syncserv", err)
			break
		}
		length := int64(binary.BigEndian.Uint32(hdr[:4]))
		if length > size-off-12 {
			break
		}
		switch string(hdr[4:8]) {
		case "eXIf":
			if t, ok := tiffDate(r, off+8, off+8+length); ok {
				return t, true
			}
		case "iTXt", "tEXt":
			if length <= maxTextChunk {
				text := make([]byte, length)
				if _, err := r.ReadAt(text, off+8); err == nil {
					if t, ok := xmpDate(text); ok {
						return t, true
					}
				}
			}
		case "IEND":
			return time.Time{}, false
		}
		off += 12 + length
	}
	return time.Time{}, false
}

/*
	ISO base media files: HEIF, HEIC, AVIF, MP4, MOV
*/

func isoBoxType(typ string) (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "isoBoxType", "typ", typ), &out0)
	switch typ {
	case "ftyp", "moov", "mdat", "wide", "free", "skip", "meta", "pnot", "uuid":
		return true
	}
	return false
}

type isoBox struct {
	typ             string
	body, end, head int64
}

// readBox reads the header of the box at off, which must end by limit.
func readBox(r io.ReaderAt, off, limit int64) (out0 isoBox, out1 bool) {
	defer logger.Out2(logger.In3("fileservers/servers/syncserv", "readBox", "r", r, "off", off, "limit", limit), &out0, &out1)
	if off < 0 || off > limit-8 {
		return isoBox{}, false
	}
	var h [16]byte
	if _, err := r.ReadAt(h[:8], off); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return isoBox{}, false
	}
	size := uint64(binary.BigEndian.Uint32(h[:4]))
	headLen := int64(8)
	switch size {
	case 1:
		if off > limit-16 {
			return isoBox{}, false
		}
		if _, err := r.ReadAt(h[8:16], off+8); err != nil {
			logger.DebugErr("fileservers/servers/syncserv", err)
			return isoBox{}, false
		}
		size = binary.BigEndian.Uint64(h[8:16])
		headLen = 16
	case 0:
		size = uint64(limit - off)
	}
	if size < uint64(headLen) || size > uint64(limit-off) {
		return isoBox{}, false
	}
	return isoBox{typ: string(h[4:8]), head: off, body: off + headLen, end: off + int64(size)}, true
}

func isoDate(r io.ReaderAt, size int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "isoDate", "r", r, "size", size), &out0, &out1)
	var meta, moov *isoBox
	off := int64(0)
	for i := 0; i < maxBoxes && off < size; i++ {
		b, ok := readBox(r, off, size)
		if !ok {
			break
		}
		switch b.typ {
		case "meta":
			if meta == nil {
				meta = &b
			}
		case "moov":
			if moov == nil {
				moov = &b
			}
		}
		off = b.end
	}
	if meta != nil {
		if t, ok := heifDate(r, *meta, size); ok {
			return t, true
		}
	}
	if moov != nil {
		return mvhdDate(r, *moov)
	}
	return time.Time{}, false
}

// cursor reads big-endian numbers from a slice and remembers running off it.
type cursor struct {
	b   []byte
	p   int
	bad bool
}

func (c *cursor) uint(n int) (out0 uint64) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "cursor.uint", "c", c, "n", n), &out0)
	if c.bad || n < 0 || n > 8 || len(c.b)-c.p < n {
		c.bad = true
		return 0
	}
	var v uint64
	for i := 0; i < n; i++ {
		v = v<<8 | uint64(c.b[c.p+i])
	}
	c.p += n
	return v
}

// children calls fn with the type and body of every box in buf.
func children(buf []byte, fn func(typ string, body []byte, bodyOff int)) {
	defer logger.Out0(logger.In2("fileservers/servers/syncserv", "children", "buf", buf, "fn", fn))
	p := 0
	for i := 0; i < maxBoxes && len(buf)-p >= 8; i++ {
		size := uint64(binary.BigEndian.Uint32(buf[p:]))
		typ := string(buf[p+4 : p+8])
		headLen := 8
		switch size {
		case 1:
			if len(buf)-p < 16 {
				return
			}
			size = binary.BigEndian.Uint64(buf[p+8:])
			headLen = 16
		case 0:
			size = uint64(len(buf) - p)
		}
		if size < uint64(headLen) || size > uint64(len(buf)-p) {
			return
		}
		fn(typ, buf[p+headLen:p+int(size)], p+headLen)
		p += int(size)
	}
}

func validFieldSize(n int) (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "validFieldSize", "n", n), &out0)
	return n == 0 || n == 4 || n == 8
}

// heifDate finds the Exif item of a HEIF file and reads its date.
func heifDate(r io.ReaderAt, meta isoBox, size int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In3("fileservers/servers/syncserv", "heifDate", "r", r, "&meta", &meta, "size", size), &out0, &out1)
	//meta is a full box: version and flags come first
	bodyLen := meta.end - meta.body - 4
	if bodyLen <= 0 || bodyLen > maxMetaBox {
		return time.Time{}, false
	}
	buf := make([]byte, bodyLen)
	if _, err := r.ReadAt(buf, meta.body+4); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return time.Time{}, false
	}

	var iinf, iloc []byte
	idatStart, idatLen := int64(-1), int64(0)
	children(buf, func(typ string, body []byte, bodyOff int) {
		switch typ {
		case "iinf":
			iinf = body
		case "iloc":
			iloc = body
		case "idat":
			idatStart = meta.body + 4 + int64(bodyOff)
			idatLen = int64(len(body))
		}
	})
	if iinf == nil || iloc == nil {
		return time.Time{}, false
	}

	//Which item is the Exif block
	exifID, found := uint64(0), false
	c := &cursor{b: iinf}
	version := c.uint(1)
	c.uint(3)
	if version == 0 {
		c.uint(2)
	} else {
		c.uint(4)
	}
	if c.bad {
		return time.Time{}, false
	}
	children(iinf[c.p:], func(typ string, body []byte, _ int) {
		if typ != "infe" || found {
			return
		}
		e := &cursor{b: body}
		v := e.uint(1)
		e.uint(3)
		var id uint64
		switch v {
		case 2:
			id = e.uint(2)
		case 3:
			id = e.uint(4)
		default:
			return
		}
		e.uint(2) //Protection index
		if e.bad || len(body)-e.p < 4 {
			return
		}
		if string(body[e.p:e.p+4]) == "Exif" {
			exifID, found = id, true
		}
	})
	if !found {
		return time.Time{}, false
	}

	//Where the Exif item is
	l := &cursor{b: iloc}
	version = l.uint(1)
	l.uint(3)
	sizes := l.uint(2)
	offSize, lenSize, baseSize := int(sizes>>12&0xF), int(sizes>>8&0xF), int(sizes>>4&0xF)
	idxSize := 0
	if version == 1 || version == 2 {
		idxSize = int(sizes & 0xF)
	}
	if version > 2 || !validFieldSize(offSize) || !validFieldSize(lenSize) || !validFieldSize(baseSize) || !validFieldSize(idxSize) {
		return time.Time{}, false
	}
	var count uint64
	if version < 2 {
		count = l.uint(2)
	} else {
		count = l.uint(4)
	}
	budget := 1 << 16
	for i := uint64(0); i < count && !l.bad && budget > 0; i++ {
		var id uint64
		if version < 2 {
			id = l.uint(2)
		} else {
			id = l.uint(4)
		}
		method := uint64(0)
		if version == 1 || version == 2 {
			method = l.uint(2) & 0xF
		}
		l.uint(2) //Data reference index
		base := l.uint(baseSize)
		extents := l.uint(2)
		var first, firstLen uint64
		for e := uint64(0); e < extents && !l.bad && budget > 0; e++ {
			budget--
			if idxSize > 0 {
				l.uint(idxSize)
			}
			off, length := l.uint(offSize), l.uint(lenSize)
			if e == 0 {
				first, firstLen = off, length
			}
		}
		budget--
		if l.bad || id != exifID || extents == 0 {
			continue
		}

		//The item is in the file, or inside the idat box
		regionStart, regionEnd := int64(0), size
		switch method {
		case 0:
		case 1:
			if idatStart < 0 {
				return time.Time{}, false
			}
			regionStart, regionEnd = idatStart, idatStart+idatLen
		default:
			return time.Time{}, false
		}
		span := uint64(regionEnd - regionStart)
		if base > span || first > span-base {
			return time.Time{}, false
		}
		start := regionStart + int64(base+first)
		end := regionEnd
		if firstLen > 0 && firstLen < uint64(end-start) {
			end = start + int64(firstLen)
		}
		return exifItemDate(r, start, end)
	}
	return time.Time{}, false
}

// exifItemDate reads a HEIF Exif item: the offset of the TIFF header, then
// usually "Exif\0\0", then the TIFF structure.
func exifItemDate(r io.ReaderAt, start, end int64) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In3("fileservers/servers/syncserv", "exifItemDate", "r", r, "start", start, "end", end), &out0, &out1)
	if end-start < 4+8 {
		return time.Time{}, false
	}
	var head [4]byte
	if _, err := r.ReadAt(head[:], start); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return time.Time{}, false
	}
	skip := int64(binary.BigEndian.Uint32(head[:]))
	if skip > end-start-4-8 {
		return time.Time{}, false
	}
	return tiffDate(r, start+4+skip, end)
}

// quicktimeEpoch is 1904-01-01 in Unix seconds.
const quicktimeEpoch = -2082844800

// mvhdDate reads the creation time of the movie header, which is UTC.
func mvhdDate(r io.ReaderAt, moov isoBox) (out0 time.Time, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "mvhdDate", "r", r, "&moov", &moov), &out0, &out1)
	off := moov.body
	for i := 0; i < maxBoxes && off < moov.end; i++ {
		b, ok := readBox(r, off, moov.end)
		if !ok {
			break
		}
		if b.typ == "mvhd" {
			var buf [12]byte
			n := int64(8)
			if b.end-b.body >= 12 {
				n = 12
			}
			if b.end-b.body < n {
				return time.Time{}, false
			}
			if _, err := r.ReadAt(buf[:n], b.body); err != nil {
				logger.DebugErr("fileservers/servers/syncserv", err)
				return time.Time{}, false
			}
			var secs uint64
			if buf[0] == 1 {
				if n < 12 {
					return time.Time{}, false
				}
				secs = binary.BigEndian.Uint64(buf[4:12])
			} else {
				secs = uint64(binary.BigEndian.Uint32(buf[4:8]))
			}
			if secs == 0 || secs > 1<<40 {
				return time.Time{}, false
			}
			t := time.Unix(quicktimeEpoch+int64(secs), 0).In(time.Local)
			return t, plausible(t)
		}
		off = b.end
	}
	return time.Time{}, false
}
