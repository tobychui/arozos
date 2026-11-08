package rpc

import "imuslab.com/arozos/mod/storage/smbserver/wire"

/*
	ndr.go

	The parts of NDR (the DCE/RPC encoding) that the implemented calls need.
	Pointers inside a structure are written as a non zero id, and what they
	point at follows after the structure, in order. Alignment counts from the
	start of the stub.
*/

type ndrWriter struct {
	wire.Writer
	nextRef uint32
}

func newNDR() *ndrWriter {
	return &ndrWriter{nextRef: 0x00020000}
}

func (n *ndrWriter) u32(v uint32) {
	n.Align(4)
	n.U32(v)
}

func (n *ndrWriter) u16(v uint16) {
	n.Align(2)
	n.U16(v)
}

// pointer writes a non null pointer id.
func (n *ndrWriter) pointer() {
	n.u32(n.nextRef)
	n.nextRef += 4
}

// null writes a null pointer.
func (n *ndrWriter) null() { n.u32(0) }

// wstring writes a NUL terminated conformant varying string.
func (n *ndrWriter) wstring(s string) {
	encoded := wire.EncodeUTF16(s + "\x00")
	chars := uint32(len(encoded) / 2)
	n.u32(chars)
	n.u32(0)
	n.u32(chars)
	n.Bytes(encoded)
}

// unicodeHeader writes the fixed part of an RPC_UNICODE_STRING. The characters
// follow later through unicodeBody.
func (n *ndrWriter) unicodeHeader(s string) {
	size := uint16(len(wire.EncodeUTF16(s)))
	n.u16(size)
	n.u16(size)
	if s == "" {
		n.null()
		return
	}
	n.pointer()
}

func (n *ndrWriter) unicodeBody(s string) {
	if s == "" {
		return
	}
	encoded := wire.EncodeUTF16(s)
	chars := uint32(len(encoded) / 2)
	n.u32(chars)
	n.u32(0)
	n.u32(chars)
	n.Bytes(encoded)
}

// sid writes an RPC_SID, which starts with the sub authority count.
func (n *ndrWriter) sid(s wire.SID) {
	n.u32(uint32(len(s.SubAuth)))
	n.Bytes(s.Bytes())
}

// readString reads a conformant varying string.
func readString(r *wire.Reader) string {
	r.Align(4)
	r.U32() //Max count
	r.U32() //Offset
	chars := int(r.U32())
	if chars < 0 || chars > r.Left()/2 {
		r.Skip(r.Left() + 1)
		return ""
	}
	s, _ := wire.DecodeUTF16(r.Bytes(chars * 2))
	for len(s) > 0 && s[len(s)-1] == 0 {
		s = s[:len(s)-1]
	}
	return s
}

// readOptionalString reads a [unique] string pointer.
func readOptionalString(r *wire.Reader) string {
	r.Align(4)
	if r.U32() == 0 {
		return ""
	}
	return readString(r)
}

// readSID reads an RPC_SID.
func readSID(r *wire.Reader) (wire.SID, bool) {
	r.Align(4)
	count := int(r.U32())
	if count > 15 {
		return wire.SID{}, false
	}
	r.Skip(1) //Revision
	if int(r.U8()) != count {
		return wire.SID{}, false
	}
	var authority uint64
	for _, v := range r.Bytes(6) {
		authority = authority<<8 | uint64(v)
	}
	s := wire.SID{Authority: authority}
	for i := 0; i < count; i++ {
		s.SubAuth = append(s.SubAuth, r.U32())
	}
	return s, !r.Bad()
}
