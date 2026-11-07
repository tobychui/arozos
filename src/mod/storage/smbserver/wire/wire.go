// Package wire reads and writes SMB2 and SMB3 messages.
//
// Every parser here sits in front of the login check, or directly behind it,
// and takes bytes from the network. They bound every access and report
// ErrMalformed rather than trusting a length or an offset. Nothing in this
// package imports ArozOS code.
package wire

import (
	"encoding/binary"
	"errors"
	"time"
	"unicode/utf16"
)

// ErrMalformed is returned for a message that cannot be parsed.
var ErrMalformed = errors.New("smbserver: malformed message")

// Header is the SMB2 packet header. Status doubles as the channel sequence
// on requests, and TreeID is replaced by AsyncID when FlagAsync is set.
type Header struct {
	CreditCharge uint16
	Status       uint32
	Command      uint16
	Credits      uint16 //Requested on the way in, granted on the way out
	Flags        uint32
	NextCommand  uint32
	MessageID    uint64
	AsyncID      uint64
	TreeID       uint32
	SessionID    uint64
	Signature    [SignatureSz]byte
}

// IsSMB2 reports whether a frame starts with the SMB2 protocol id.
func IsSMB2(b []byte) bool {
	return len(b) >= 4 && b[0] == 0xFE && b[1] == 'S' && b[2] == 'M' && b[3] == 'B'
}

// IsSMB1 reports whether a frame starts with the SMB1 protocol id.
func IsSMB1(b []byte) bool {
	return len(b) >= 4 && b[0] == 0xFF && b[1] == 'S' && b[2] == 'M' && b[3] == 'B'
}

// ParseHeader reads the header at the start of b.
func ParseHeader(b []byte) (Header, error) {
	var h Header
	if len(b) < HeaderSize || !IsSMB2(b) {
		return h, ErrMalformed
	}
	if binary.LittleEndian.Uint16(b[4:]) != HeaderSize {
		return h, ErrMalformed
	}
	h.CreditCharge = binary.LittleEndian.Uint16(b[6:])
	h.Status = binary.LittleEndian.Uint32(b[8:])
	h.Command = binary.LittleEndian.Uint16(b[12:])
	h.Credits = binary.LittleEndian.Uint16(b[14:])
	h.Flags = binary.LittleEndian.Uint32(b[16:])
	h.NextCommand = binary.LittleEndian.Uint32(b[20:])
	h.MessageID = binary.LittleEndian.Uint64(b[24:])
	if h.Flags&FlagAsync != 0 {
		h.AsyncID = binary.LittleEndian.Uint64(b[32:])
	} else {
		h.TreeID = binary.LittleEndian.Uint32(b[36:])
	}
	h.SessionID = binary.LittleEndian.Uint64(b[40:])
	copy(h.Signature[:], b[SignatureAt:SignatureAt+SignatureSz])
	return h, nil
}

// Put writes the header into the first 64 bytes of b.
func (h *Header) Put(b []byte) {
	b[0], b[1], b[2], b[3] = 0xFE, 'S', 'M', 'B'
	binary.LittleEndian.PutUint16(b[4:], HeaderSize)
	binary.LittleEndian.PutUint16(b[6:], h.CreditCharge)
	binary.LittleEndian.PutUint32(b[8:], h.Status)
	binary.LittleEndian.PutUint16(b[12:], h.Command)
	binary.LittleEndian.PutUint16(b[14:], h.Credits)
	binary.LittleEndian.PutUint32(b[16:], h.Flags)
	binary.LittleEndian.PutUint32(b[20:], h.NextCommand)
	binary.LittleEndian.PutUint64(b[24:], h.MessageID)
	if h.Flags&FlagAsync != 0 {
		binary.LittleEndian.PutUint64(b[32:], h.AsyncID)
	} else {
		binary.LittleEndian.PutUint32(b[32:], 0)
		binary.LittleEndian.PutUint32(b[36:], h.TreeID)
	}
	binary.LittleEndian.PutUint64(b[40:], h.SessionID)
	copy(b[SignatureAt:], h.Signature[:])
}

// Reader walks a byte slice. The first read past the end marks it bad and
// every later read returns zero, so a parser can check once at the end.
type Reader struct {
	b   []byte
	off int
	bad bool
}

// NewReader returns a Reader over b.
func NewReader(b []byte) *Reader { return &Reader{b: b} }

func (r *Reader) take(n int) []byte {
	if r.bad || n < 0 || r.off+n > len(r.b) {
		r.bad = true
		return nil
	}
	v := r.b[r.off : r.off+n]
	r.off += n
	return v
}

// U8 reads one byte.
func (r *Reader) U8() uint8 {
	if v := r.take(1); v != nil {
		return v[0]
	}
	return 0
}

// U16 reads a little endian uint16.
func (r *Reader) U16() uint16 {
	if v := r.take(2); v != nil {
		return binary.LittleEndian.Uint16(v)
	}
	return 0
}

// U32 reads a little endian uint32.
func (r *Reader) U32() uint32 {
	if v := r.take(4); v != nil {
		return binary.LittleEndian.Uint32(v)
	}
	return 0
}

// U64 reads a little endian uint64.
func (r *Reader) U64() uint64 {
	if v := r.take(8); v != nil {
		return binary.LittleEndian.Uint64(v)
	}
	return 0
}

// Bytes reads n bytes without copying them.
func (r *Reader) Bytes(n int) []byte { return r.take(n) }

// Skip moves forward n bytes.
func (r *Reader) Skip(n int) { r.take(n) }

// Align moves forward to the next multiple of n.
func (r *Reader) Align(n int) {
	if rem := r.off % n; rem != 0 {
		r.take(n - rem)
	}
}

// Off returns the current position.
func (r *Reader) Off() int { return r.off }

// Left returns how many bytes remain.
func (r *Reader) Left() int { return len(r.b) - r.off }

// Bad reports whether any read ran past the end.
func (r *Reader) Bad() bool { return r.bad }

// Writer appends little endian values to a growing slice.
type Writer struct {
	B []byte
}

// NewWriter returns a Writer with room for n bytes.
func NewWriter(n int) *Writer { return &Writer{B: make([]byte, 0, n)} }

// U8 appends one byte.
func (w *Writer) U8(v uint8) { w.B = append(w.B, v) }

// U16 appends a little endian uint16.
func (w *Writer) U16(v uint16) { w.B = binary.LittleEndian.AppendUint16(w.B, v) }

// U32 appends a little endian uint32.
func (w *Writer) U32(v uint32) { w.B = binary.LittleEndian.AppendUint32(w.B, v) }

// U64 appends a little endian uint64.
func (w *Writer) U64(v uint64) { w.B = binary.LittleEndian.AppendUint64(w.B, v) }

// Bytes appends raw bytes.
func (w *Writer) Bytes(v []byte) { w.B = append(w.B, v...) }

// Zero appends n zero bytes.
func (w *Writer) Zero(n int) {
	for i := 0; i < n; i++ {
		w.B = append(w.B, 0)
	}
}

// Align pads with zeros to the next multiple of n.
func (w *Writer) Align(n int) {
	if rem := len(w.B) % n; rem != 0 {
		w.Zero(n - rem)
	}
}

// Len returns the number of bytes written.
func (w *Writer) Len() int { return len(w.B) }

// Slice returns length bytes at an offset measured from the start of the
// header, which is how SMB2 addresses its variable fields.
func Slice(msg []byte, offset, length int) ([]byte, bool) {
	if length == 0 {
		return nil, true
	}
	if offset < HeaderSize || length < 0 || offset > len(msg) || length > len(msg)-offset {
		return nil, false
	}
	return msg[offset : offset+length], true
}

// EncodeUTF16 converts a string to UTF-16LE without a terminator.
func EncodeUTF16(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := make([]byte, len(u)*2)
	for i, v := range u {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	return b
}

// DecodeUTF16 converts UTF-16LE to a string. An odd length is malformed.
func DecodeUTF16(b []byte) (string, bool) {
	if len(b)%2 != 0 {
		return "", false
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(b[i*2:])
	}
	return string(utf16.Decode(u)), true
}

// Seconds between 1601 and 1970, the two epochs in play.
const filetimeEpochDelta = 11644473600

// Filetime converts a time to 100 nanosecond ticks since 1601. The zero time
// is reported as zero, which clients read as "not set".
func Filetime(t time.Time) uint64 {
	if t.IsZero() {
		return 0
	}
	return uint64(t.Unix()+filetimeEpochDelta)*10000000 + uint64(t.Nanosecond())/100
}

// TimeFromFiletime is the inverse of Filetime.
func TimeFromFiletime(v uint64) time.Time {
	if v == 0 {
		return time.Time{}
	}
	return time.Unix(int64(v/10000000)-filetimeEpochDelta, int64(v%10000000)*100)
}
