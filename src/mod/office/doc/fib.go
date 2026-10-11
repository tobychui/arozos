package doc

/*
	fib.go - the File Information Block (LibreOffice: WW8Fib, ww8scan.cxx).

	The FIB opens the WordDocument stream and says where everything else
	is: the character counts of the main text and of each sub-document
	(footnotes, headers, comments, endnotes, text boxes), which of the two
	table streams is current, and an array of (offset, size) pairs into
	the table stream - the "FcLcb" array - for every structure: styles,
	fonts, the piece table, the formatting page indexes, lists, sections,
	notes, drawings.
*/

import (
	"encoding/binary"
	"errors"
)

// indexes into the FibRgFcLcb97 array
const (
	lcbStshf          = 1
	lcbPlcffndRef     = 2
	lcbPlcffndTxt     = 3
	lcbPlcfandRef     = 4
	lcbPlcfandTxt     = 5
	lcbPlcfSed        = 6
	lcbPlcfHdd        = 11
	lcbPlcfBteChpx    = 12
	lcbPlcfBtePapx    = 13
	lcbSttbfFfn       = 15
	lcbPlcfFldMom     = 16
	lcbSttbfBkmk      = 21
	lcbPlcfBkf        = 22
	lcbPlcfBkl        = 23
	lcbDop            = 31
	lcbClx            = 33
	lcbGrpXstAtnOwner = 36
	lcbSttbfAtnBkmk   = 37
	lcbPlcSpaMom      = 40
	lcbPlcSpaHdr      = 41
	lcbPlcfAtnBkf     = 42
	lcbPlcfAtnBkl     = 43
	lcbPlcfendRef     = 46
	lcbPlcfendTxt     = 47
	lcbDggInfo        = 50
	lcbSttbfRMark     = 51
	lcbPlcftxbxTxt    = 56
	lcbPlcfHdrtxbxTxt = 58
	lcbPlfLst         = 73
	lcbPlfLfo         = 74
)

type fib struct {
	nFib       uint16
	lid        uint16
	complex    bool
	encrypted  bool
	obfuscated bool
	table1     bool // the current table stream is "1Table"
	farEast    bool

	ccpText, ccpFtn, ccpHdd, ccpMcr, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx int

	fcLcb []uint32 // fc0, lcb0, fc1, lcb1, ...
}

var errOldWord = errors.New("Word 6.0 / 95 and older documents are not supported; save the file as a Word 97-2003 or .docx document first")

// parseFib reads the FIB at the start of the WordDocument stream
func parseFib(wd []byte) (*fib, error) {
	le := binary.LittleEndian
	if len(wd) < 0x22 || le.Uint16(wd) != 0xA5EC {
		if len(wd) >= 2 && (le.Uint16(wd) == 0xA5DC || le.Uint16(wd) == 0xA59B) {
			return nil, errOldWord
		}
		return nil, errors.New("not a Word document")
	}
	f := &fib{nFib: le.Uint16(wd[2:]), lid: le.Uint16(wd[6:])}
	// Word 6 and 95 share the identifier but not the layout: Word 97 and
	// later always have 14 16-bit values after the FIB base (csw)
	if f.nFib < 0x6A || le.Uint16(wd[0x20:]) != 14 {
		return nil, errOldWord
	}
	flags := le.Uint16(wd[0x0A:])
	f.complex = flags&0x0004 != 0
	f.encrypted = flags&0x0100 != 0
	f.table1 = flags&0x0200 != 0
	f.farEast = flags&0x4000 != 0
	f.obfuscated = flags&0x8000 != 0

	p := 0x20
	csw := int(le.Uint16(wd[p:]))
	p += 2 + 2*csw
	if p+2 > len(wd) {
		return nil, errors.New("truncated FIB")
	}
	cslw := int(le.Uint16(wd[p:]))
	lw := p + 2
	if lw+4*cslw > len(wd) || cslw < 11 {
		return nil, errors.New("truncated FIB")
	}
	rd := func(i int) int { return int(int32(le.Uint32(wd[lw+4*i:]))) }
	f.ccpText, f.ccpFtn, f.ccpHdd, f.ccpMcr = rd(3), rd(4), rd(5), rd(6)
	f.ccpAtn, f.ccpEdn, f.ccpTxbx, f.ccpHdrTxbx = rd(7), rd(8), rd(9), rd(10)
	p = lw + 4*cslw
	if p+2 > len(wd) {
		return nil, errors.New("truncated FIB")
	}
	n := int(le.Uint16(wd[p:]))
	p += 2
	if p+8*n > len(wd) {
		n = (len(wd) - p) / 8
	}
	f.fcLcb = make([]uint32, 2*n)
	for i := 0; i < 2*n; i++ {
		f.fcLcb[i] = le.Uint32(wd[p+4*i:])
	}
	for _, c := range []int{f.ccpText, f.ccpFtn, f.ccpHdd, f.ccpMcr, f.ccpAtn, f.ccpEdn, f.ccpTxbx, f.ccpHdrTxbx} {
		if c < 0 || c > 1<<28 {
			return nil, errors.New("corrupted FIB")
		}
	}
	return f, nil
}

// span returns the bytes of the table stream structure at FcLcb index i
// (nil when absent or out of range)
func (f *fib) span(tbl []byte, i int) []byte {
	if 2*i+1 >= len(f.fcLcb) {
		return nil
	}
	fc, lcb := f.fcLcb[2*i], f.fcLcb[2*i+1]
	if lcb == 0 || int64(fc)+int64(lcb) > int64(len(tbl)) {
		return nil
	}
	return tbl[fc : fc+lcb]
}

// spanTail returns the table stream from the structure at FcLcb index i
// to the end: PlfLst's levels follow it beyond the size the FIB states
func (f *fib) spanTail(tbl []byte, i int) []byte {
	if 2*i+1 >= len(f.fcLcb) || f.fcLcb[2*i+1] == 0 {
		return nil
	}
	fc := f.fcLcb[2*i]
	if int64(fc) >= int64(len(tbl)) {
		return nil
	}
	return tbl[fc:]
}

// story starts: every sub-document's CPs follow the main text's
func (f *fib) ftnStart() int     { return f.ccpText }
func (f *fib) hddStart() int     { return f.ccpText + f.ccpFtn }
func (f *fib) atnStart() int     { return f.hddStart() + f.ccpHdd + f.ccpMcr }
func (f *fib) ednStart() int     { return f.atnStart() + f.ccpAtn }
func (f *fib) txbxStart() int    { return f.ednStart() + f.ccpEdn }
func (f *fib) hdrTxbxStart() int { return f.txbxStart() + f.ccpTxbx }
func (f *fib) totalCP() int      { return f.hdrTxbxStart() + f.ccpHdrTxbx }
