package rpc

import (
	"bytes"
	"encoding/binary"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func testEnv() *Env {
	machine := wire.MachineSID([]byte("test"))
	return &Env{
		ServerName: "AROZ",
		Workgroup:  "WORKGROUP",
		MachineSID: machine,
		Username:   "alice",
		UserSID:    wire.UserSID(machine, "alice"),
		Shares: func() []ShareEntry {
			return []ShareEntry{{"user", "My files", TypeDisk}, {"IPC$", "IPC Service", TypeIPC}}
		},
	}
}

func pdu(ptype, flags uint8, callID uint32, body []byte) []byte {
	w := wire.NewWriter(16 + len(body))
	w.Bytes([]byte{5, 0, ptype, flags, 0x10, 0, 0, 0})
	w.U16(uint16(16 + len(body)))
	w.U16(0)
	w.U32(callID)
	w.Bytes(body)
	return w.B
}

func bindBody(ifaceUUID [16]byte, major uint16) []byte {
	w := wire.NewWriter(128)
	w.U16(4280)
	w.U16(4280)
	w.U32(0)
	w.U8(3)
	w.Zero(3)
	addContext := func(id uint16, syntax []byte, version uint32) {
		w.U16(id)
		w.U8(1)
		w.U8(0)
		w.Bytes(ifaceUUID[:])
		w.U16(major)
		w.U16(0)
		w.Bytes(syntax)
		w.U32(version)
	}
	ndr64 := mustUUID("33057171babe37498319b5dbef9ccc36")
	btfn := append(append([]byte{}, btfnPrefix...), 3, 0, 0, 0, 0, 0, 0, 0)
	addContext(0, ndr32UUID[:], 2)
	addContext(1, ndr64[:], 1)
	addContext(2, btfn, 1)
	return w.B
}

type ackResult struct {
	code, reason uint16
}

func parseAck(t *testing.T, ack []byte) []ackResult {
	t.Helper()
	r := wire.NewReader(ack)
	r.Skip(2)
	ptype := r.U8()
	if ptype != ptBindAck && ptype != ptAlterResp {
		t.Fatalf("packet type %d", ptype)
	}
	r.Skip(13)
	r.Skip(8) //Sizes and association group
	r.Skip(int(r.U16()))
	r.Align(4)
	count := int(r.U8())
	r.Skip(3)
	out := []ackResult{}
	for i := 0; i < count; i++ {
		out = append(out, ackResult{r.U16(), r.U16()})
		r.Skip(20)
	}
	if r.Bad() {
		t.Fatal("short ack")
	}
	return out
}

func call(t *testing.T, p *Pipe, ctxID, opnum uint16, stub []byte) []byte {
	t.Helper()
	w := wire.NewWriter(8 + len(stub))
	w.U32(uint32(len(stub)))
	w.U16(ctxID)
	w.U16(opnum)
	w.Bytes(stub)
	if err := p.Write(pdu(ptRequest, flagFirstFrag|flagLastFrag, 2, w.B)); err != nil {
		t.Fatalf("write: %v", err)
	}
	out, more := p.Read(1 << 20)
	if more {
		t.Fatal("unexpected remainder")
	}
	if out[2] == ptFault {
		t.Fatalf("fault %x", binary.LittleEndian.Uint32(out[24:]))
	}
	if out[2] != ptResponse {
		t.Fatalf("packet type %d", out[2])
	}
	return out[24:]
}

func boundPipe(t *testing.T, name string, target [16]byte, major uint16) *Pipe {
	t.Helper()
	p, ok := NewPipe(name, testEnv())
	if !ok {
		t.Fatalf("no pipe %s", name)
	}
	if err := p.Write(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(target, major))); err != nil {
		t.Fatal(err)
	}
	ack, _ := p.Read(4096)
	results := parseAck(t, ack)
	if len(results) != 3 {
		t.Fatalf("results = %+v", results)
	}
	if results[0].code != 0 {
		t.Errorf("NDR32 must be accepted: %+v", results[0])
	}
	if results[1].code != 2 || results[1].reason != 2 {
		t.Errorf("NDR64 must be refused: %+v", results[1])
	}
	if results[2].code != 3 {
		t.Errorf("feature negotiation must be acknowledged: %+v", results[2])
	}
	return p
}

func TestWkstaGetInfo(t *testing.T) {
	cases := []struct {
		level uint32
		want  uint32
	}{{100, 0}, {101, 0}, {102, 0}, {502, errInvalidLevel}}
	for _, c := range cases {
		p := boundPipe(t, "wkssvc", wkssvcUUID, 1)
		n := serverNameStub()
		n.u32(c.level)
		out := call(t, p, 0, 0, n.B)
		if got := binary.LittleEndian.Uint32(out[len(out)-4:]); got != c.want {
			t.Errorf("level %d: WERROR %d", c.level, got)
		}
		if c.want == 0 {
			if !bytes.Contains(out, wire.EncodeUTF16("AROZ")) || !bytes.Contains(out, wire.EncodeUTF16("WORKGROUP")) {
				t.Errorf("level %d: names missing", c.level)
			}
		}
	}
}

func TestUnknownPipe(t *testing.T) {
	if _, ok := NewPipe("spoolss", testEnv()); ok {
		t.Error("only implemented pipes may open")
	}
}

func TestBindRefusesForeignInterface(t *testing.T) {
	p, _ := NewPipe("srvsvc", testEnv())
	p.Write(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(lsarpcUUID, 0)))
	ack, _ := p.Read(4096)
	if results := parseAck(t, ack); results[0].code == 0 {
		t.Error("lsarpc must not bind on the srvsvc pipe")
	}
}

func TestPDUSplitAcrossWrites(t *testing.T) {
	p, _ := NewPipe("srvsvc", testEnv())
	whole := pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(srvsvcUUID, 3))
	if err := p.Write(whole[:20]); err != nil {
		t.Fatal(err)
	}
	if p.Available() != 0 {
		t.Fatal("no reply before the PDU is complete")
	}
	if err := p.Write(whole[20:]); err != nil {
		t.Fatal(err)
	}
	if p.Available() == 0 {
		t.Error("the completed PDU must get a reply")
	}
}

func stringStub(s string) []byte {
	n := newNDR()
	n.wstring(s)
	return n.B
}

func serverNameStub() *ndrWriter {
	n := newNDR()
	n.pointer()
	n.wstring(`\\aroz`)
	return n
}

func TestNetShareEnumAll(t *testing.T) {
	p := boundPipe(t, "srvsvc", srvsvcUUID, 3)
	n := serverNameStub()
	n.u32(1)
	n.u32(1)
	n.pointer()
	n.u32(0)
	n.null()
	n.u32(0xFFFFFFFF)
	n.null()
	out := call(t, p, 0, 15, n.B)

	r := wire.NewReader(out)
	if r.U32() != 1 || r.U32() != 1 {
		t.Fatal("level echo")
	}
	r.U32() //Container
	count := r.U32()
	if count != 2 {
		t.Fatalf("entries = %d", count)
	}
	r.U32() //Array
	if r.U32() != 2 {
		t.Fatal("conformance")
	}
	r.U32() //Name 1
	if got := r.U32(); got != TypeDisk {
		t.Errorf("type 1 = %x", got)
	}
	r.U32()
	r.U32() //Name 2
	if got := r.U32(); got != TypeIPC {
		t.Errorf("type 2 = %x", got)
	}
	r.U32()
	if got := readString(r); got != "user" {
		t.Errorf("name 1 = %q", got)
	}
	if got := readString(r); got != "My files" {
		t.Errorf("comment 1 = %q", got)
	}
	if got := readString(r); got != "IPC$" {
		t.Errorf("name 2 = %q", got)
	}
	readString(r)
	r.Align(4)
	if r.U32() != 2 {
		t.Error("total entries")
	}
	r.U32()
	r.U32()
	if r.U32() != 0 {
		t.Error("WERROR")
	}
	if r.Bad() || r.Left() != 0 {
		t.Errorf("layout off, %d bytes left", r.Left())
	}
}

func TestNetShareGetInfo(t *testing.T) {
	cases := []struct {
		name     string
		share    string
		level    uint32
		wantWErr uint32
	}{
		{"found", "USER", 1, 0},
		{"missing", "nope", 1, nerrNetNameNotFnd},
		{"bad level", "user", 502, errInvalidLevel},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := boundPipe(t, "srvsvc", srvsvcUUID, 3)
			n := serverNameStub()
			n.Align(4)
			n.Bytes(stringStub(c.share))
			n.u32(c.level)
			out := call(t, p, 0, 16, n.B)
			if got := binary.LittleEndian.Uint32(out[len(out)-4:]); got != c.wantWErr {
				t.Errorf("WERROR = %d", got)
			}
		})
	}
}

func TestOpenPolicy3Layout(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	out := call(t, p, 0, 130, nil)
	r := wire.NewReader(out)
	if r.U32() != 1 || r.U32() != 1 || r.U32() != 1 || r.U32() != 0 {
		t.Fatal("revision block")
	}
	handle := r.Bytes(20)
	if r.U32() != 0 || r.Bad() || r.Left() != 0 {
		t.Fatalf("layout off, %d left", r.Left())
	}
	if out := call(t, p, 0, 0, handle); binary.LittleEndian.Uint32(out[20:]) != 0 {
		t.Error("the handle must be a real one")
	}
}

func TestUnimplementedOpIsARangeFault(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	w := wire.NewWriter(8)
	w.U32(0)
	w.U16(0)
	w.U16(77) //LsarLookupNames4, not implemented
	p.Write(pdu(ptRequest, flagFirstFrag|flagLastFrag, 2, w.B))
	out, _ := p.Read(4096)
	if out[2] != ptFault {
		t.Fatalf("packet type %d", out[2])
	}
	if got := binary.LittleEndian.Uint32(out[24:]); got != faultOpRangeError {
		t.Errorf("status %x", got)
	}
}

func openPolicy(t *testing.T, p *Pipe) []byte {
	t.Helper()
	out := call(t, p, 0, 44, nil)
	if binary.LittleEndian.Uint32(out[20:]) != 0 {
		t.Fatal("open failed")
	}
	return append([]byte{}, out[:20]...)
}

func lookupStub(handle []byte, sids ...wire.SID) []byte {
	n := newNDR()
	n.Bytes(handle)
	n.u32(uint32(len(sids)))
	n.pointer()
	n.u32(uint32(len(sids)))
	for range sids {
		n.pointer()
	}
	for _, s := range sids {
		n.sid(s)
	}
	return n.B
}

func TestLookupSids(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	handle := openPolicy(t, p)
	unknown := wire.SID{Authority: 5, SubAuth: []uint32{99}}

	out := call(t, p, 0, 57, lookupStub(handle, p.env.UserSID, wire.SIDEveryone, unknown))
	if got := binary.LittleEndian.Uint32(out[len(out)-4:]); got != statusSomeNotMapped {
		t.Errorf("status = %x", got)
	}
	if got := binary.LittleEndian.Uint32(out[len(out)-8:]); got != 2 {
		t.Errorf("mapped = %d", got)
	}
	if !bytes.Contains(out, wire.EncodeUTF16("alice")) || !bytes.Contains(out, wire.EncodeUTF16("Everyone")) {
		t.Error("the names must be in the reply")
	}
}

func TestLookupSidsNeedsAnOpenHandle(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	out := call(t, p, 0, 57, lookupStub(make([]byte, 20), wire.SIDEveryone))
	if got := binary.LittleEndian.Uint32(out[len(out)-4:]); got != statusInvalidHandle {
		t.Errorf("status = %x", got)
	}
}

func TestCloseInvalidatesTheHandle(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	handle := openPolicy(t, p)
	if out := call(t, p, 0, 0, handle); binary.LittleEndian.Uint32(out[20:]) != 0 {
		t.Fatal("close failed")
	}
	if out := call(t, p, 0, 0, handle); binary.LittleEndian.Uint32(out[20:]) != statusInvalidHandle {
		t.Error("a closed handle must be refused")
	}
}

func TestQueryInfoPolicy(t *testing.T) {
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	handle := openPolicy(t, p)
	stub := append(append([]byte{}, handle...), 5, 0)
	out := call(t, p, 0, 7, stub)
	if got := binary.LittleEndian.Uint32(out[len(out)-4:]); got != 0 {
		t.Fatalf("status %x", got)
	}
	if !bytes.Contains(out, wire.EncodeUTF16("AROZ")) {
		t.Error("the account domain must be named")
	}
	if !bytes.Contains(out, p.env.MachineSID.Bytes()) {
		t.Error("the account domain must carry the machine SID")
	}
}

func TestDsRoleOnLsarpcPipe(t *testing.T) {
	//Windows binds lsarpc, then adds dssetup with an alter context
	p := boundPipe(t, "lsarpc", lsarpcUUID, 0)
	p.Write(pdu(ptAlter, flagFirstFrag|flagLastFrag, 2, func() []byte {
		w := wire.NewWriter(64)
		w.U16(4280)
		w.U16(4280)
		w.U32(1)
		w.U8(1)
		w.Zero(3)
		w.U16(1) //Context id
		w.U8(1)
		w.U8(0)
		w.Bytes(dssetupUUID[:])
		w.U32(0)
		w.Bytes(ndr32UUID[:])
		w.U32(2)
		return w.B
	}()))
	ack, _ := p.Read(4096)
	if results := parseAck(t, ack); results[0].code != 0 {
		t.Fatalf("alter context refused: %+v", results)
	}

	out := call(t, p, 1, 0, []byte{1, 0})
	r := wire.NewReader(out)
	r.U32() //Pointer
	if r.U16() != 1 {
		t.Fatal("level echo")
	}
	r.Align(4)
	if r.U16() != 2 {
		t.Error("role must be a standalone server")
	}
	r.Align(4)
	r.U32()
	r.U32()
	if r.U32() != 0 || r.U32() != 0 {
		t.Error("no DNS domain or forest")
	}
	r.Skip(16)
	if got := readString(r); got != "WORKGROUP" {
		t.Errorf("domain = %q", got)
	}
	r.Align(4)
	if r.U32() != 0 || r.Bad() || r.Left() != 0 {
		t.Errorf("layout off, %d left", r.Left())
	}
}

func TestLargeReplyIsFragmented(t *testing.T) {
	env := testEnv()
	env.Shares = func() []ShareEntry {
		out := []ShareEntry{}
		for i := 0; i < 400; i++ {
			out = append(out, ShareEntry{Name: "a-share-with-a-long-enough-name", Comment: "comment", Type: TypeDisk})
		}
		return out
	}
	p, _ := NewPipe("srvsvc", env)
	p.Write(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(srvsvcUUID, 3)))
	p.Read(4096)

	n := serverNameStub()
	n.u32(1)
	n.u32(1)
	n.pointer()
	n.u32(0)
	n.null()
	n.u32(0)
	n.null()
	w := wire.NewWriter(64)
	w.U32(0)
	w.U16(0)
	w.U16(15)
	w.Bytes(n.B)
	p.Write(pdu(ptRequest, flagFirstFrag|flagLastFrag, 2, w.B))

	first := true
	sawLast := false
	for p.Available() > 0 {
		head, _ := p.Read(headerSize)
		length := int(binary.LittleEndian.Uint16(head[8:]))
		if length > 4280 {
			t.Fatalf("fragment of %d bytes", length)
		}
		if first != (head[3]&flagFirstFrag != 0) {
			t.Error("first fragment flag")
		}
		first = false
		sawLast = head[3]&flagLastFrag != 0
		p.Read(length - headerSize)
	}
	if !sawLast {
		t.Error("no last fragment")
	}
}

// The pipe is reachable by any logged in user, so a bad PDU must never panic.
func FuzzPipe(f *testing.F) {
	f.Add(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(srvsvcUUID, 3)))
	f.Add(pdu(ptRequest, flagFirstFrag|flagLastFrag, 2, []byte{0, 0, 0, 0, 0, 0, 15, 0}))
	f.Fuzz(func(t *testing.T, b []byte) {
		for _, name := range []string{"srvsvc", "lsarpc"} {
			p, _ := NewPipe(name, testEnv())
			p.Write(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(srvsvcUUID, 3)))
			p.Write(pdu(ptBind, flagFirstFrag|flagLastFrag, 1, bindBody(lsarpcUUID, 0)))
			p.Read(1 << 20)
			p.Write(b)
			p.Read(1 << 20)
			if len(b) >= 2 {
				opnum := uint16(b[0]) | uint16(b[1])<<8
				w := wire.NewWriter(len(b) + 8)
				w.U32(0)
				w.U16(0)
				w.U16(opnum % 64)
				w.Bytes(b)
				p.Write(pdu(ptRequest, flagFirstFrag|flagLastFrag, 2, w.B))
			}
		}
	})
}
