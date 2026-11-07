// Package rpc answers the DCE/RPC calls Windows makes over IPC$.
//
// It implements what Windows was seen using in real sessions: srvsvc to list
// shares, lsarpc with dssetup to turn the SIDs of a security descriptor into
// names, and wkssvc, which Office asks about the server. Any other call gets the standard "operation out of range"
// fault, which is also how Windows learns to fall back from lsa_OpenPolicy3
// to lsa_OpenPolicy2.
package rpc

import (
	"bytes"
	"encoding/binary"
	"errors"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// PDU types
const (
	ptRequest      = 0
	ptResponse     = 2
	ptFault        = 3
	ptBind         = 11
	ptBindAck      = 12
	ptBindNak      = 13
	ptAlter        = 14
	ptAlterResp    = 15
	flagFirstFrag  = 0x01
	flagLastFrag   = 0x02
	flagObjectUUID = 0x80

	headerSize = 16

	//Largest request the server will reassemble
	maxStub = 1 << 20

	faultOpRangeError = 0x1C010002
	faultUnknownIf    = 0x1C010003
	faultCantPerform  = 0x000006D8
)

var (
	ndr32UUID  = mustUUID("045d888aeb1cc9119fe808002b104860")
	btfnPrefix = []byte{0x2c, 0x1c, 0xb7, 0x6c, 0x12, 0x98, 0x40, 0x45}

	srvsvcUUID  = mustUUID("c84f324b7016d30112785a47bf6ee188")
	lsarpcUUID  = mustUUID("785734123412cdabef000123456789ab")
	dssetupUUID = mustUUID("6a2819390cb1d0119ba800c04fd92ef5")
	wkssvcUUID  = mustUUID("98d0ff6b12a11036983346c3f87e345a")
)

// mustUUID reads a UUID in wire byte order.
func mustUUID(s string) [16]byte {
	var out [16]byte
	for i := range out {
		out[i] = hexDigit(s[i*2])<<4 | hexDigit(s[i*2+1])
	}
	return out
}

func hexDigit(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	}
	return 0
}

// ShareEntry is one row of a share listing.
type ShareEntry struct {
	Name    string
	Comment string
	Type    uint32
}

// Share types of the srvsvc listing
const (
	TypeDisk uint32 = 0x00000000
	TypeIPC  uint32 = 0x80000003
)

// Env is what a call may need to know about the server and the caller.
type Env struct {
	ServerName string
	Workgroup  string
	MachineSID wire.SID
	Username   string
	UserSID    wire.SID
	Shares     func() []ShareEntry
}

type iface int

const (
	ifaceNone iface = iota
	ifaceSrvsvc
	ifaceLsarpc
	ifaceDssetup
	ifaceWkssvc
)

// Pipe is one open named pipe. It takes whole PDUs through Write and queues
// their replies for Read.
type Pipe struct {
	name     string
	env      *Env
	pending  []byte
	out      []byte
	contexts map[uint16]iface
	handles  map[[20]byte]struct{}
	maxFrag  int
	stub     []byte //A request being reassembled
	nextID   uint32
}

// NewPipe opens a pipe by name. The bool is false for a pipe the server does
// not have, and the client then gets STATUS_OBJECT_NAME_NOT_FOUND.
func NewPipe(name string, env *Env) (*Pipe, bool) {
	switch name {
	case "srvsvc", "lsarpc", "wkssvc":
	default:
		return nil, false
	}
	return &Pipe{
		name:     name,
		env:      env,
		contexts: map[uint16]iface{},
		handles:  map[[20]byte]struct{}{},
		maxFrag:  4280,
	}, true
}

// Write feeds bytes from the client in. A PDU may span several writes.
func (p *Pipe) Write(b []byte) error {
	p.pending = append(p.pending, b...)
	for len(p.pending) >= headerSize {
		fragLen := int(binary.LittleEndian.Uint16(p.pending[8:]))
		if fragLen < headerSize {
			return errors.New("smbserver: bad rpc fragment length")
		}
		if len(p.pending) < fragLen {
			return nil
		}
		frag := p.pending[:fragLen]
		if err := p.handlePDU(frag); err != nil {
			return err
		}
		p.pending = p.pending[fragLen:]
	}
	return nil
}

// Read returns up to max bytes of the reply. The bool is true when more of
// the same reply is waiting.
func (p *Pipe) Read(max int) ([]byte, bool) {
	if len(p.out) <= max {
		out := p.out
		p.out = nil
		return out, false
	}
	out := p.out[:max]
	p.out = p.out[max:]
	return out, true
}

// Available reports how many reply bytes are waiting.
func (p *Pipe) Available() int { return len(p.out) }

func (p *Pipe) handlePDU(frag []byte) error {
	r := wire.NewReader(frag)
	if r.U8() != 5 || r.U8() != 0 {
		return errors.New("smbserver: unsupported rpc version")
	}
	ptype := r.U8()
	flags := r.U8()
	if drep := r.Bytes(4); len(drep) == 4 && drep[0]&0x10 == 0 {
		return errors.New("smbserver: big endian rpc is not supported")
	}
	r.Skip(2) //Fragment length
	authLen := int(r.U16())
	callID := r.U32()
	if r.Bad() {
		return errors.New("smbserver: short rpc header")
	}

	switch ptype {
	case ptBind, ptAlter:
		p.handleBind(frag, ptype, callID, authLen)
		return nil
	case ptRequest:
		return p.handleRequest(frag, flags, callID, authLen)
	}
	return errors.New("smbserver: unexpected rpc packet type")
}

func header(ptype, flags uint8, callID uint32) *wire.Writer {
	w := wire.NewWriter(64)
	w.Bytes([]byte{5, 0, ptype, flags, 0x10, 0, 0, 0})
	w.U16(0) //Fragment length, filled in by finish
	w.U16(0)
	w.U32(callID)
	return w
}

func (p *Pipe) finish(w *wire.Writer) {
	binary.LittleEndian.PutUint16(w.B[8:], uint16(w.Len()))
	p.out = append(p.out, w.B...)
}

func (p *Pipe) handleBind(frag []byte, ptype uint8, callID uint32, authLen int) {
	r := wire.NewReader(frag[headerSize:])
	maxXmit := int(r.U16())
	maxRecv := int(r.U16())
	assoc := r.U32()
	count := int(r.U8())
	r.Skip(3)
	if r.Bad() || authLen != 0 || count == 0 {
		w := header(ptBindNak, flagFirstFrag|flagLastFrag, callID)
		w.U16(0)
		w.U8(0)
		p.finish(w)
		return
	}
	if maxRecv >= headerSize+8 && maxRecv < p.maxFrag {
		p.maxFrag = maxRecv
	}

	type result struct {
		code, reason uint16
		syntax       []byte
	}
	results := make([]result, 0, count)
	for i := 0; i < count; i++ {
		ctxID := r.U16()
		transfers := int(r.U8())
		r.Skip(1)
		abstract := r.Bytes(16)
		r.Skip(4) //Interface version
		out := result{code: 2, reason: 2, syntax: make([]byte, 20)}
		target := p.lookupInterface(abstract)
		for t := 0; t < transfers; t++ {
			syntax := r.Bytes(20)
			if r.Bad() {
				break
			}
			switch {
			case bytes.Equal(syntax[:16], ndr32UUID[:]) && target != ifaceNone:
				p.contexts[ctxID] = target
				out = result{code: 0, reason: 0, syntax: append([]byte{}, syntax...)}
			case bytes.HasPrefix(syntax, btfnPrefix) && out.code != 0:
				//Bind time feature negotiation: acknowledged with no features
				out = result{code: 3, reason: 0, syntax: make([]byte, 20)}
			}
		}
		results = append(results, out)
	}

	reply := uint8(ptBindAck)
	if ptype == ptAlter {
		reply = ptAlterResp
	}
	w := header(reply, flagFirstFrag|flagLastFrag, callID)
	w.U16(uint16(maxXmit))
	w.U16(uint16(maxRecv))
	if assoc == 0 {
		assoc = 0x00005A5A
	}
	w.U32(assoc)
	if ptype == ptBind {
		addr := append([]byte(`\PIPE\`+p.name), 0)
		w.U16(uint16(len(addr)))
		w.Bytes(addr)
	} else {
		w.U16(0)
	}
	w.Align(4)
	w.U8(uint8(len(results)))
	w.Zero(3)
	for _, res := range results {
		w.U16(res.code)
		w.U16(res.reason)
		w.Bytes(res.syntax)
	}
	p.finish(w)
}

func (p *Pipe) lookupInterface(abstract []byte) iface {
	if len(abstract) != 16 {
		return ifaceNone
	}
	switch {
	case p.name == "srvsvc" && bytes.Equal(abstract, srvsvcUUID[:]):
		return ifaceSrvsvc
	case p.name == "lsarpc" && bytes.Equal(abstract, lsarpcUUID[:]):
		return ifaceLsarpc
	case p.name == "lsarpc" && bytes.Equal(abstract, dssetupUUID[:]):
		return ifaceDssetup
	case p.name == "wkssvc" && bytes.Equal(abstract, wkssvcUUID[:]):
		return ifaceWkssvc
	}
	return ifaceNone
}

func (p *Pipe) handleRequest(frag []byte, flags uint8, callID uint32, authLen int) error {
	r := wire.NewReader(frag[headerSize:])
	r.Skip(4) //Allocation hint
	ctxID := r.U16()
	opnum := r.U16()
	if flags&flagObjectUUID != 0 {
		r.Skip(16)
	}
	if r.Bad() {
		return errors.New("smbserver: short rpc request")
	}
	end := len(frag) - authLen
	if authLen != 0 {
		end -= 8
	}
	if r.Off()+headerSize > end {
		return errors.New("smbserver: bad rpc stub length")
	}
	stubPart := frag[headerSize+r.Off() : end]

	if flags&flagFirstFrag != 0 {
		p.stub = nil
	}
	if len(p.stub)+len(stubPart) > maxStub {
		return errors.New("smbserver: rpc request too large")
	}
	p.stub = append(p.stub, stubPart...)
	if flags&flagLastFrag == 0 {
		return nil
	}
	stub := p.stub
	p.stub = nil

	target, known := p.contexts[ctxID]
	if !known {
		p.fault(callID, ctxID, faultUnknownIf)
		return nil
	}

	var out []byte
	var fault uint32
	switch target {
	case ifaceSrvsvc:
		out, fault = p.srvsvc(opnum, stub)
	case ifaceLsarpc:
		out, fault = p.lsarpc(opnum, stub)
	case ifaceDssetup:
		out, fault = p.dssetup(opnum, stub)
	case ifaceWkssvc:
		out, fault = p.wkssvc(opnum, stub)
	}
	if fault != 0 {
		p.fault(callID, ctxID, fault)
		return nil
	}
	p.respond(callID, ctxID, out)
	return nil
}

func (p *Pipe) fault(callID uint32, ctxID uint16, status uint32) {
	w := header(ptFault, flagFirstFrag|flagLastFrag, callID)
	w.U32(0)
	w.U16(ctxID)
	w.U8(0)
	w.U8(0)
	w.U32(status)
	w.U32(0)
	p.finish(w)
}

// respond splits a reply into fragments the client said it can take.
func (p *Pipe) respond(callID uint32, ctxID uint16, stub []byte) {
	const overhead = headerSize + 8
	room := p.maxFrag - overhead
	room -= room % 8
	total := len(stub)
	first := true
	for {
		n := len(stub)
		if n > room {
			n = room
		}
		var flags uint8
		if first {
			flags |= flagFirstFrag
		}
		if n == len(stub) {
			flags |= flagLastFrag
		}
		w := header(ptResponse, flags, callID)
		w.U32(uint32(total))
		w.U16(ctxID)
		w.U8(0)
		w.U8(0)
		w.Bytes(stub[:n])
		p.finish(w)
		stub = stub[n:]
		first = false
		if len(stub) == 0 {
			return
		}
	}
}

// newHandle returns a fresh 20 byte policy handle.
func (p *Pipe) newHandle() [20]byte {
	p.nextID++
	var h [20]byte
	binary.LittleEndian.PutUint32(h[4:], p.nextID)
	copy(h[8:], "arozossmb")
	p.handles[h] = struct{}{}
	return h
}
