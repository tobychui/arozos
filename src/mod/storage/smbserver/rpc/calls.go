package rpc

import (
	"strings"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	calls.go

	The implemented calls of srvsvc, lsarpc, dssetup and wkssvc.
*/

// Windows errors of srvsvc
const (
	errInvalidLevel   = 124
	nerrNetNameNotFnd = 2310
)

// NT status values of lsarpc
const (
	statusOK            = 0x00000000
	statusSomeNotMapped = 0x00000107
	statusInvalidHandle = 0xC0000008
	statusInvalidInfo   = 0xC0000003
	statusNoneMapped    = 0xC0000073
)

// SID name use
const (
	useUser           = 1
	useAlias          = 4
	useWellKnownGroup = 5
	useUnknown        = 8
)

// ---- srvsvc ----

func (p *Pipe) srvsvc(opnum uint16, stub []byte) ([]byte, uint32) {
	switch opnum {
	case 15:
		return p.netShareEnumAll(stub)
	case 16:
		return p.netShareGetInfo(stub)
	}
	return nil, faultOpRangeError
}

func (p *Pipe) netShareEnumAll(stub []byte) ([]byte, uint32) {
	r := wire.NewReader(stub)
	readOptionalString(r)
	r.Align(4)
	level := r.U32()
	if r.Bad() {
		return nil, faultCantPerform
	}
	shares := p.env.Shares()

	n := newNDR()
	if level != 0 && level != 1 {
		n.u32(level)
		n.u32(level)
		n.null()
		n.u32(0)
		n.null()
		n.u32(errInvalidLevel)
		return n.B, 0
	}

	n.u32(level)
	n.u32(level)
	n.pointer() //The container
	n.u32(uint32(len(shares)))
	if len(shares) == 0 {
		n.null()
	} else {
		n.pointer()
		n.u32(uint32(len(shares)))
		for _, s := range shares {
			n.pointer()
			if level == 1 {
				n.u32(s.Type)
				n.pointer()
			}
		}
		for _, s := range shares {
			n.wstring(s.Name)
			if level == 1 {
				n.wstring(s.Comment)
			}
		}
	}
	n.u32(uint32(len(shares))) //Total entries
	n.pointer()                //Resume handle
	n.u32(0)
	n.u32(0) //WERROR
	return n.B, 0
}

func (p *Pipe) netShareGetInfo(stub []byte) ([]byte, uint32) {
	r := wire.NewReader(stub)
	readOptionalString(r)
	name := readString(r)
	r.Align(4)
	level := r.U32()
	if r.Bad() {
		return nil, faultCantPerform
	}

	var found *ShareEntry
	for _, s := range p.env.Shares() {
		if strings.EqualFold(s.Name, name) {
			entry := s
			found = &entry
			break
		}
	}

	n := newNDR()
	n.u32(level)
	switch {
	case found == nil:
		n.null()
		n.u32(nerrNetNameNotFnd)
	case level == 0:
		n.pointer()
		n.pointer()
		n.wstring(found.Name)
		n.u32(0)
	case level == 1:
		n.pointer()
		n.pointer()
		n.u32(found.Type)
		n.pointer()
		n.wstring(found.Name)
		n.wstring(found.Comment)
		n.u32(0)
	case level == 1005:
		n.pointer()
		n.u32(0) //No flags
		n.u32(0)
	default:
		n.null()
		n.u32(errInvalidLevel)
	}
	return n.B, 0
}

// ---- lsarpc ----

func (p *Pipe) lsarpc(opnum uint16, stub []byte) ([]byte, uint32) {
	switch opnum {
	case 0:
		return p.lsaClose(stub)
	case 7, 46:
		return p.lsaQueryInfo(stub)
	case 6, 44:
		return p.lsaOpenPolicy2()
	case 130:
		return p.lsaOpenPolicy3()
	case 15:
		return p.lsaLookupSids(stub, false)
	case 57:
		return p.lsaLookupSids(stub, true)
	}
	return nil, faultOpRangeError
}

func (p *Pipe) lsaOpenPolicy2() ([]byte, uint32) {
	handle := p.newHandle()
	n := newNDR()
	n.Bytes(handle[:])
	n.u32(statusOK)
	return n.B, 0
}

// lsaOpenPolicy3 is what Windows 11 calls first. Its reply carries a revision
// block ahead of the handle.
func (p *Pipe) lsaOpenPolicy3() ([]byte, uint32) {
	handle := p.newHandle()
	n := newNDR()
	n.u32(1) //Out version
	n.u32(1) //Union arm
	n.u32(1) //Revision
	n.u32(0) //Supported features
	n.Bytes(handle[:])
	n.u32(statusOK)
	return n.B, 0
}

func (p *Pipe) checkHandle(r *wire.Reader) ([20]byte, bool) {
	var h [20]byte
	copy(h[:], r.Bytes(20))
	if r.Bad() {
		return h, false
	}
	_, ok := p.handles[h]
	return h, ok
}

func (p *Pipe) lsaClose(stub []byte) ([]byte, uint32) {
	r := wire.NewReader(stub)
	h, ok := p.checkHandle(r)
	n := newNDR()
	n.Zero(20)
	if !ok {
		n.u32(statusInvalidHandle)
		return n.B, 0
	}
	delete(p.handles, h)
	n.u32(statusOK)
	return n.B, 0
}

// lsaQueryInfo answers the primary domain (3) and the account domain (5).
func (p *Pipe) lsaQueryInfo(stub []byte) ([]byte, uint32) {
	r := wire.NewReader(stub)
	_, ok := p.checkHandle(r)
	level := r.U16()
	n := newNDR()
	if r.Bad() || !ok {
		n.null()
		n.u32(statusInvalidHandle)
		return n.B, 0
	}

	var name string
	var sid *wire.SID
	switch level {
	case 3:
		name = p.env.Workgroup
	case 5:
		name = p.env.ServerName
		sid = &p.env.MachineSID
	default:
		n.null()
		n.u32(statusInvalidInfo)
		return n.B, 0
	}

	n.pointer()
	n.u16(level)
	n.Align(4)
	n.unicodeHeader(name)
	if sid != nil {
		n.pointer()
	} else {
		n.null()
	}
	n.unicodeBody(name)
	if sid != nil {
		n.sid(*sid)
	}
	n.u32(statusOK)
	return n.B, 0
}

type resolvedSID struct {
	use         uint16
	name        string
	domainIndex int32
}

type referencedDomain struct {
	name string
	sid  wire.SID
}

// describe names a SID. Nothing outside these few ever appears in a
// descriptor the server builds.
func (p *Pipe) describe(s wire.SID) (domain referencedDomain, name string, use uint16, ok bool) {
	switch {
	case s.Equal(p.env.UserSID):
		return referencedDomain{p.env.ServerName, p.env.MachineSID}, p.env.Username, useUser, true
	case s.Equal(wire.SIDEveryone):
		return referencedDomain{"", wire.SID{Authority: 1}}, "Everyone", useWellKnownGroup, true
	case s.Equal(wire.SIDUsers):
		return referencedDomain{"BUILTIN", wire.SID{Authority: 5, SubAuth: []uint32{32}}}, "Users", useAlias, true
	}
	return referencedDomain{}, "", useUnknown, false
}

func (p *Pipe) lsaLookupSids(stub []byte, extended bool) ([]byte, uint32) {
	r := wire.NewReader(stub)
	_, ok := p.checkHandle(r)
	count := int(r.U32())
	r.U32() //Array pointer
	r.U32() //Conformance
	if r.Bad() || count > 1024 {
		return nil, faultCantPerform
	}
	for i := 0; i < count; i++ {
		r.U32()
	}
	sids := make([]wire.SID, 0, count)
	for i := 0; i < count; i++ {
		s, valid := readSID(r)
		if !valid {
			return nil, faultCantPerform
		}
		sids = append(sids, s)
	}

	n := newNDR()
	if !ok {
		n.null()
		n.u32(0)
		n.null()
		n.u32(0)
		n.u32(statusInvalidHandle)
		return n.B, 0
	}

	domains := []referencedDomain{}
	results := make([]resolvedSID, 0, len(sids))
	mapped := 0
	for _, s := range sids {
		domain, name, use, known := p.describe(s)
		if !known {
			results = append(results, resolvedSID{use: useUnknown, domainIndex: -1})
			continue
		}
		mapped++
		index := -1
		for i, d := range domains {
			if d.sid.Equal(domain.sid) {
				index = i
			}
		}
		if index < 0 {
			index = len(domains)
			domains = append(domains, domain)
		}
		results = append(results, resolvedSID{use: use, name: name, domainIndex: int32(index)})
	}

	//ReferencedDomains
	n.pointer()
	n.u32(uint32(len(domains)))
	if len(domains) == 0 {
		n.null()
	} else {
		n.pointer()
	}
	n.u32(32) //MaxEntries
	if len(domains) > 0 {
		n.u32(uint32(len(domains)))
		for _, d := range domains {
			n.unicodeHeader(d.name)
			n.pointer()
		}
		for _, d := range domains {
			n.unicodeBody(d.name)
			n.sid(d.sid)
		}
	}

	//TranslatedNames
	n.u32(uint32(len(results)))
	if len(results) == 0 {
		n.null()
	} else {
		n.pointer()
		n.u32(uint32(len(results)))
		for _, res := range results {
			n.u16(res.use)
			n.Align(4)
			n.unicodeHeader(res.name)
			n.u32(uint32(res.domainIndex))
			if extended {
				n.u32(0)
			}
		}
		for _, res := range results {
			n.unicodeBody(res.name)
		}
	}

	n.u32(uint32(mapped))
	switch {
	case mapped == len(results):
		n.u32(statusOK)
	case mapped == 0:
		n.u32(statusNoneMapped)
	default:
		n.u32(statusSomeNotMapped)
	}
	return n.B, 0
}

// ---- dssetup ----

func (p *Pipe) dssetup(opnum uint16, stub []byte) ([]byte, uint32) {
	if opnum != 0 {
		return nil, faultOpRangeError
	}
	r := wire.NewReader(stub)
	level := r.U16()
	if r.Bad() {
		return nil, faultCantPerform
	}
	n := newNDR()
	if level != 1 {
		n.null()
		n.u32(87) //ERROR_INVALID_PARAMETER
		return n.B, 0
	}

	const roleStandaloneServer = 2
	n.pointer()
	n.u16(level)
	n.Align(4)
	n.u16(roleStandaloneServer)
	n.Align(4)
	n.u32(0) //Flags
	n.pointer()
	n.null() //DNS domain
	n.null() //Forest
	n.Zero(16)
	n.wstring(p.env.Workgroup)
	n.u32(0)
	return n.B, 0
}

// ---- wkssvc ----

func (p *Pipe) wkssvc(opnum uint16, stub []byte) ([]byte, uint32) {
	if opnum != 0 {
		return nil, faultOpRangeError
	}
	r := wire.NewReader(stub)
	readOptionalString(r)
	r.Align(4)
	level := r.U32()
	if r.Bad() {
		return nil, faultCantPerform
	}

	const (
		platformNT = 500
		versionMaj = 10
		versionMin = 0
	)
	n := newNDR()
	n.u32(level)
	switch level {
	case 100, 101, 102:
		n.pointer()
		n.u32(platformNT)
		n.pointer() //Computer name
		n.pointer() //Workgroup
		n.u32(versionMaj)
		n.u32(versionMin)
		if level >= 101 {
			n.pointer() //LAN root
		}
		if level == 102 {
			n.u32(1) //Logged on users
		}
		n.wstring(p.env.ServerName)
		n.wstring(p.env.Workgroup)
		if level >= 101 {
			n.wstring("")
		}
		n.u32(0)
	default:
		n.null()
		n.u32(errInvalidLevel)
	}
	return n.B, 0
}
