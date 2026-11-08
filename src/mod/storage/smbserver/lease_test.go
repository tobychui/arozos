package smbserver

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

type createCtx struct {
	name string
	data []byte
}

// createWithContexts is a CREATE with create contexts and an oplock level.
func createWithContexts(name string, o createOpts, oplock uint8, contexts []createCtx) []byte {
	encoded := wire.EncodeUTF16(name)
	if len(encoded) == 0 {
		encoded = []byte{0, 0}
	}
	ctx := wire.NewWriter(64)
	for i, cc := range contexts {
		start := ctx.Len()
		ctx.U32(0)
		ctx.U16(16)
		ctx.U16(uint16(len(cc.name)))
		ctx.U16(0)
		ctx.U16(24)
		ctx.U32(uint32(len(cc.data)))
		ctx.Bytes([]byte(cc.name))
		ctx.Zero(4)
		ctx.Bytes(cc.data)
		if i < len(contexts)-1 {
			ctx.Align(8)
			binary.LittleEndian.PutUint32(ctx.B[start:], uint32(ctx.Len()-start))
		}
	}

	w := wire.NewWriter(56 + len(encoded) + 8 + ctx.Len())
	w.U16(57)
	w.U8(0)
	w.U8(oplock)
	w.U32(2)
	w.Zero(16)
	w.U32(o.access)
	w.U32(0)
	w.U32(o.share)
	w.U32(o.disposition)
	w.U32(o.options)
	w.U16(wire.HeaderSize + 56)
	nameLen := len(wire.EncodeUTF16(name))
	w.U16(uint16(nameLen))
	ctxAt := w.Len()
	w.U32(0)
	w.U32(0)
	w.Bytes(encoded)
	if len(contexts) > 0 {
		for (wire.HeaderSize+w.Len())%8 != 0 {
			w.U8(0)
		}
		binary.LittleEndian.PutUint32(w.B[ctxAt:], uint32(wire.HeaderSize+w.Len()))
		binary.LittleEndian.PutUint32(w.B[ctxAt+4:], uint32(ctx.Len()))
		w.Bytes(ctx.B)
	}
	return w.B
}

func leaseV2(key byte, state uint32, epoch uint16) createCtx {
	w := wire.NewWriter(52)
	k := [16]byte{key}
	w.Bytes(k[:])
	w.U32(state)
	w.U32(0)
	w.U64(0)
	w.Zero(16)
	w.U16(epoch)
	w.U16(0)
	return createCtx{wire.ContextLease, w.B}
}

func durableV2(guid byte, timeoutMs uint32) createCtx {
	w := wire.NewWriter(32)
	w.U32(timeoutMs)
	w.U32(0)
	w.U64(0)
	g := [16]byte{guid}
	w.Bytes(g[:])
	return createCtx{wire.ContextDurableReqV2, w.B}
}

func durableReconnect(id wire.FileID, guid byte) createCtx {
	w := wire.NewWriter(36)
	w.Bytes(id[:])
	g := [16]byte{guid}
	w.Bytes(g[:])
	w.U32(0)
	return createCtx{wire.ContextDurableRecon2, w.B}
}

// createReply is what tests check of a CREATE response.
type createReply struct {
	status  uint32
	id      wire.FileID
	oplock  uint8
	lease   uint32
	epoch   uint16
	durable bool
	hasCtx  map[string]bool
}

func parseCreateReply(r rawReply) createReply {
	out := createReply{status: r.hdr.Status, hasCtx: map[string]bool{}}
	if r.hdr.Status != 0 || len(r.body) < 88 {
		return out
	}
	out.oplock = r.body[2]
	copy(out.id[:], r.body[64:80])
	off := int(binary.LittleEndian.Uint32(r.body[80:]))
	n := int(binary.LittleEndian.Uint32(r.body[84:]))
	if n == 0 {
		return out
	}
	chain := r.body[off-wire.HeaderSize : off-wire.HeaderSize+n]
	for {
		next := binary.LittleEndian.Uint32(chain)
		nameOff := binary.LittleEndian.Uint16(chain[4:])
		nameLen := binary.LittleEndian.Uint16(chain[6:])
		dataOff := binary.LittleEndian.Uint16(chain[10:])
		dataLen := binary.LittleEndian.Uint32(chain[12:])
		name := string(chain[nameOff : nameOff+nameLen])
		data := chain[dataOff : uint32(dataOff)+dataLen]
		out.hasCtx[name] = true
		switch name {
		case wire.ContextLease:
			out.lease = binary.LittleEndian.Uint32(data[16:])
			if len(data) >= 52 {
				out.epoch = binary.LittleEndian.Uint16(data[48:])
			}
		case wire.ContextDurableReqV2:
			out.durable = true
		}
		if next == 0 {
			return out
		}
		chain = chain[next:]
	}
}

// leaseBreak is a Lease Break Notification as a client sees it.
type leaseBreak struct {
	key           byte
	current, next uint32
	ack           bool
	epoch         uint16
}

func isBreak(r rawReply) bool {
	return r.hdr.Command == wire.CmdOplockBreak && r.hdr.MessageID == ^uint64(0)
}

func parseBreak(t *testing.T, r rawReply) leaseBreak {
	t.Helper()
	if len(r.body) < 44 || binary.LittleEndian.Uint16(r.body) != 44 {
		t.Fatalf("not a lease break: %x", r.body)
	}
	if r.hdr.SessionID != 0 || r.hdr.Flags&wire.FlagSigned != 0 {
		t.Error("a lease break has no session and no signature")
	}
	return leaseBreak{
		key:     r.body[8],
		current: binary.LittleEndian.Uint32(r.body[24:]),
		next:    binary.LittleEndian.Uint32(r.body[28:]),
		ack:     binary.LittleEndian.Uint32(r.body[4:])&leaseBreakAckRequired != 0,
		epoch:   binary.LittleEndian.Uint16(r.body[2:]),
	}
}

// send writes a signed request without waiting, and returns its message id.
func (c *rawClient) send(cmd uint16, body []byte) uint64 {
	msg := c.message(cmd, body, 0)
	mid := binary.LittleEndian.Uint64(msg[24:])
	c.signer.Sign(msg)
	c.writeFrame(msg)
	return mid
}

// next reads the next message that is not an interim response.
func (c *rawClient) next() rawReply {
	c.t.Helper()
	for {
		r := parseReplies(c.t, c.readFrame())[0]
		if r.hdr.Status == wire.StatusPending && !isBreak(r) {
			continue
		}
		return r
	}
}

// quiet reports that nothing arrives for a while. What does arrive is lost,
// so it is for the end of a test or the failure path.
func (c *rawClient) quiet(d time.Duration) bool {
	c.nc.SetReadDeadline(time.Now().Add(d))
	head := make([]byte, 1)
	_, err := c.nc.Read(head)
	return err != nil
}

func leaseCreate(t *testing.T, c *rawClient, name string, o createOpts, contexts ...createCtx) createReply {
	t.Helper()
	return parseCreateReply(c.call(wire.CmdCreate, createWithContexts(name, o, oplockLevelLease, contexts)))
}

func leaseAck(key byte, state uint32) []byte {
	w := wire.NewWriter(36)
	w.U16(36)
	w.U16(0)
	w.U32(0)
	k := [16]byte{key}
	w.Bytes(k[:])
	w.U32(state)
	w.U64(0)
	return w.B
}

const rwh = leaseRead | leaseHandle | leaseWrite

func leaseHarness(t *testing.T, tune ...func(*Config)) *harness {
	return newHarness(t, append([]func(*Config){noPoll, func(c *Config) {
		c.PendingAfter = 50 * time.Millisecond
		c.LeasePoll = -1
	}}, tune...)...)
}

var openAllShare = createOpts{access: wire.FileReadData | wire.FileWriteData, share: shareAll, disposition: wire.DispositionOpenIf}

func TestLeaseBreaksForAnotherOpen(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), []byte("hello"), 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)

	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	if got.status != 0 || got.oplock != oplockLevelLease || got.lease != rwh {
		t.Fatalf("grant: %+v", got)
	}

	//B opens the file; A must first stop holding back writes
	b.send(wire.CmdCreate, createBody("doc.txt", openAllShare))
	br := parseBreak(t, a.next())
	if br.key != 1 || br.current != rwh || br.next != leaseRead|leaseHandle || !br.ack {
		t.Fatalf("break: %+v", br)
	}
	if br.epoch != got.epoch+1 {
		t.Errorf("epoch %d after %d", br.epoch, got.epoch)
	}
	//B hears only that its open is pending
	if r := parseReplies(t, b.readFrame())[0]; r.hdr.Status != wire.StatusPending {
		t.Fatalf("B got %x before A answered the break", r.hdr.Status)
	}
	if !b.quiet(150 * time.Millisecond) {
		t.Fatal("B's open finished before A answered the break")
	}
	if r := a.call(wire.CmdOplockBreak, leaseAck(1, leaseRead|leaseHandle)); r.hdr.Status != 0 {
		t.Fatalf("ack: %x", r.hdr.Status)
	}
	if r := b.next(); r.hdr.Command != wire.CmdCreate || r.hdr.Status != 0 {
		t.Errorf("B's open: %+v", r.hdr)
	}
}

func TestLeaseBreakTimesOut(t *testing.T) {
	h := leaseHarness(t, func(c *Config) { c.LeaseBreakTimeout = 200 * time.Millisecond })
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), nil, 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))

	started := time.Now()
	if _, st := b.create("doc.txt", openAllShare); st != 0 {
		t.Fatalf("B's open: %x", st)
	}
	if took := time.Since(started); took < 150*time.Millisecond {
		t.Errorf("B's open waited only %v", took)
	}
	parseBreak(t, a.next())
	//The break is over, so a late answer is refused
	if r := a.call(wire.CmdOplockBreak, leaseAck(1, leaseRead|leaseHandle)); r.hdr.Status != wire.StatusUnsuccessful {
		t.Errorf("late ack: %x", r.hdr.Status)
	}
}

func TestLeaseHandleBreakOnShareConflict(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), nil, 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	readOnly := createOpts{access: wire.FileReadData, share: wire.ShareRead, disposition: wire.DispositionOpen}
	got := leaseCreate(t, a, "doc.txt", readOnly, leaseV2(1, leaseRead|leaseHandle, 0))
	if got.lease != leaseRead|leaseHandle {
		t.Fatalf("grant: %+v", got)
	}

	//A shares no writing, so B's writer would be refused by A's cached handle
	b.send(wire.CmdCreate, createBody("doc.txt", openAllShare))
	br := parseBreak(t, a.next())
	if br.next != leaseRead || !br.ack {
		t.Fatalf("break: %+v", br)
	}
	//A answers the way Windows does: it closes the cached handle
	a.send(wire.CmdClose, closeBody(got.id))
	if r := a.next(); r.hdr.Command != wire.CmdClose || r.hdr.Status != 0 {
		t.Fatalf("close: %+v", r.hdr)
	}
	if r := b.next(); r.hdr.Status != 0 {
		t.Errorf("B's open: %x", r.hdr.Status)
	}
}

func TestWriteBreaksReadLeases(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), []byte("abc"), 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	if got := leaseCreate(t, a, "doc.txt", openRead, leaseV2(1, leaseRead, 0)); got.lease != leaseRead {
		t.Fatalf("grant: %+v", got)
	}
	id := mustCreate(t, b, "doc.txt", openAllShare)
	started := time.Now()
	if r := b.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("xyz"))); r.hdr.Status != 0 {
		t.Fatalf("write: %x", r.hdr.Status)
	}
	if time.Since(started) > 100*time.Millisecond {
		t.Error("a write must not wait for read caches")
	}
	br := parseBreak(t, a.next())
	if br.current != leaseRead || br.next != 0 || br.ack {
		t.Errorf("break: %+v", br)
	}
}

func TestOverwriteBreaksEverything(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), []byte("abc"), 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	leaseCreate(t, a, "doc.txt", openRead, leaseV2(1, leaseRead|leaseHandle, 0))
	b.send(wire.CmdCreate, createBody("doc.txt", createOpts{access: wire.FileWriteData, share: shareAll, disposition: wire.DispositionOverwriteIf}))
	br := parseBreak(t, a.next())
	if br.next != 0 || !br.ack {
		t.Fatalf("break: %+v", br)
	}
	a.call(wire.CmdOplockBreak, leaseAck(1, 0))
	if r := b.next(); r.hdr.Status != 0 {
		t.Errorf("overwrite: %x", r.hdr.Status)
	}
}

func TestDeleteBreaksHandleLeases(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), nil, 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	held := leaseCreate(t, a, "doc.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}, leaseV2(1, leaseRead|leaseHandle, 0))

	id := mustCreate(t, b, "doc.txt", createOpts{access: wire.AccessDelete | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})
	b.send(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1}))
	br := parseBreak(t, a.next())
	if br.next != leaseRead || !br.ack {
		t.Fatalf("break: %+v", br)
	}
	a.send(wire.CmdClose, closeBody(held.id))
	a.next()
	if r := b.next(); r.hdr.Status != 0 {
		t.Fatalf("delete: %x", r.hdr.Status)
	}
	b.close(id)
	if _, err := os.Stat(filepath.Join(h.share.root, "doc.txt")); !os.IsNotExist(err) {
		t.Error("the file must be gone once the cached handle closed")
	}
}

func TestOwnLeaseDoesNotBreak(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	first := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	second := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	if first.lease != rwh || second.lease != rwh {
		t.Errorf("grants %x %x: two opens of one lease share it", first.lease, second.lease)
	}
	if !a.quiet(150 * time.Millisecond) {
		t.Error("a lease must not break for its own opens")
	}
}

func TestWriteCachingNeedsTheFileAlone(t *testing.T) {
	h := leaseHarness(t)
	b := newRawClient(t, h)
	a := newRawClient(t, h)
	mustCreate(t, b, "doc.txt", openAllShare)
	if got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0)); got.lease != leaseRead|leaseHandle {
		t.Errorf("grant %x: writes cannot be held back while B has the file open", got.lease)
	}
}

func TestLeaseKeyOnAnotherFileIsRefused(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	leaseCreate(t, a, "one.txt", openAllShare, leaseV2(1, leaseRead, 0))
	if got := leaseCreate(t, a, "two.txt", openAllShare, leaseV2(1, leaseRead, 0)); got.status != wire.StatusInvalidParameter {
		t.Errorf("status %x", got.status)
	}
}

func TestLeaseAckChecks(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), nil, 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	if r := a.call(wire.CmdOplockBreak, leaseAck(9, 0)); r.hdr.Status != wire.StatusObjectNameNotFound {
		t.Errorf("unknown lease: %x", r.hdr.Status)
	}
	leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	if r := a.call(wire.CmdOplockBreak, leaseAck(1, 0)); r.hdr.Status != wire.StatusUnsuccessful {
		t.Errorf("no break running: %x", r.hdr.Status)
	}
	b.send(wire.CmdCreate, createBody("doc.txt", openAllShare))
	parseBreak(t, a.next())
	if r := a.call(wire.CmdOplockBreak, leaseAck(1, rwh)); r.hdr.Status != wire.StatusRequestNotAccepted {
		t.Errorf("keeping write caching: %x", r.hdr.Status)
	}
	if r := a.call(wire.CmdOplockBreak, leaseAck(1, leaseRead)); r.hdr.Status != 0 {
		t.Errorf("giving back more than asked: %x", r.hdr.Status)
	}
	b.next()
}

func TestNoLeasesOnDrivesThatCannotBeWatched(t *testing.T) {
	h := leaseHarness(t)
	h.share.mu.Lock()
	h.share.noPoll = true
	h.share.mu.Unlock()
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	if got.status != 0 || got.oplock != 0 || got.hasCtx[wire.ContextLease] {
		t.Errorf("reply %+v", got)
	}
}

func TestNoLeasesWhenTurnedOff(t *testing.T) {
	h := leaseHarness(t, func(c *Config) { c.NoLeases = true })
	a := newRawClient(t, h)
	if got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0)); got.oplock != 0 || got.hasCtx[wire.ContextLease] {
		t.Errorf("reply %+v", got)
	}
}

func TestLeaseValidatorSeesOutsideChanges(t *testing.T) {
	h := leaseHarness(t, func(c *Config) { c.LeasePoll = 50 * time.Millisecond })
	p := filepath.Join(h.share.root, "doc.txt")
	os.WriteFile(p, []byte("one"), 0644)
	a := newRawClient(t, h)
	leaseCreate(t, a, "doc.txt", openRead, leaseV2(1, leaseRead, 0))
	if !a.quiet(200 * time.Millisecond) {
		t.Fatal("an unchanged file must keep its lease")
	}
	//The File Manager writes the file
	os.WriteFile(p, []byte("changed from the browser"), 0644)
	br := parseBreak(t, a.next())
	if br.next != 0 {
		t.Errorf("break: %+v", br)
	}
}

func TestOwnWritesDoNotLookLikeOutsideChanges(t *testing.T) {
	h := leaseHarness(t, func(c *Config) { c.LeasePoll = 50 * time.Millisecond })
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0))
	for i := 0; i < 5; i++ {
		a.call(wire.CmdWrite, writeBodyOf(got.id, uint64(i*10), []byte("0123456789")))
		time.Sleep(30 * time.Millisecond)
	}
	if !a.quiet(200 * time.Millisecond) {
		t.Error("the lease holder's own writes broke its lease")
	}
}

func TestDurableHandleSurvivesALostConnection(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 0))
	if got.status != 0 || !got.durable {
		t.Fatalf("durable grant: %+v", got)
	}
	a.call(wire.CmdWrite, writeBodyOf(got.id, 0, []byte("unsaved work")))
	a.nc.Close() //Wi-Fi drops

	time.Sleep(100 * time.Millisecond)
	if n := h.srv.files.Count(fileKey(h.share, "doc.txt")); n != 1 {
		t.Fatalf("%d handles: the durable open must be kept", n)
	}
	back := newRawClient(t, h)
	again := leaseCreate(t, back, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7))
	if again.status != 0 || again.id != got.id || again.lease != rwh {
		t.Fatalf("reconnect: %+v", again)
	}
	r := back.call(wire.CmdRead, readBodyOf(again.id, 0, 12))
	if r.hdr.Status != 0 || string(r.body[16:28]) != "unsaved work" {
		t.Errorf("read after reconnect: %x %q", r.hdr.Status, r.body)
	}
	if st := back.close(again.id); st != 0 {
		t.Errorf("close: %x", st)
	}
	if n := h.srv.files.Count(fileKey(h.share, "doc.txt")); n != 0 {
		t.Errorf("%d handles left", n)
	}
}

func TestDurableReconnectChecks(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 0))
	other := newRawClient(t, h)
	//Still connected: not available
	if r := leaseCreate(t, other, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7)); r.status != wire.StatusFileNotAvailable {
		t.Errorf("attached: %x", r.status)
	}
	a.nc.Close()
	time.Sleep(100 * time.Millisecond)
	if r := leaseCreate(t, other, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 8)); r.status != wire.StatusObjectNameNotFound {
		t.Errorf("wrong create guid: %x", r.status)
	}
	if r := leaseCreate(t, other, "doc.txt", openAllShare, leaseV2(2, rwh, 0), durableReconnect(got.id, 7)); r.status != wire.StatusObjectNameNotFound {
		t.Errorf("wrong lease key: %x", r.status)
	}
}

func TestDurableHandleGivesWayToAnotherClient(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", createOpts{access: wire.FileReadData | wire.FileWriteData, share: 0, disposition: wire.DispositionOpenIf}, leaseV2(1, rwh, 0), durableV2(7, 0))
	a.nc.Close()
	time.Sleep(100 * time.Millisecond)

	b := newRawClient(t, h)
	started := time.Now()
	if _, st := b.create("doc.txt", openAllShare); st != 0 {
		t.Fatalf("B's open: %x", st)
	}
	if took := time.Since(started); took > 2*time.Second {
		t.Errorf("B waited %v for a client that is not there", took)
	}
	back := newRawClient(t, h)
	if r := leaseCreate(t, back, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7)); r.status != wire.StatusObjectNameNotFound {
		t.Errorf("the closed durable handle came back: %x", r.status)
	}
}

func TestDurableHandleTimesOut(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 100))
	a.nc.Close()
	time.Sleep(400 * time.Millisecond)
	if n := h.srv.files.Count(fileKey(h.share, "doc.txt")); n != 0 {
		t.Errorf("%d handles after the timeout", n)
	}
	back := newRawClient(t, h)
	if r := leaseCreate(t, back, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7)); r.status != wire.StatusObjectNameNotFound {
		t.Errorf("reconnect after the timeout: %x", r.status)
	}
}

// The timeout fires while a reconnect holds the table: Stop cannot cancel the
// callback, which then runs after the handle was taken back.
func TestExpiryThatLosesToAReconnect(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 0))
	a.call(wire.CmdWrite, writeBodyOf(got.id, 0, []byte("unsaved work")))
	a.nc.Close()
	time.Sleep(100 * time.Millisecond)

	h.srv.durables.mu.Lock()
	o := h.srv.durables.opens[persistentID(got.id)]
	var detach uint64
	if o != nil {
		detach = o.detachCount
	}
	h.srv.durables.mu.Unlock()
	if o == nil {
		t.Fatal("the durable open is not in the table")
	}

	back := newRawClient(t, h)
	again := leaseCreate(t, back, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7))
	if again.status != 0 {
		t.Fatalf("reconnect: %+v", again)
	}
	//The late callback
	if h.srv.expireDetached(o, detach) {
		t.Fatal("an expiry must not take a handle its client took back")
	}
	r := back.call(wire.CmdRead, readBodyOf(again.id, 0, 12))
	if r.hdr.Status != 0 || string(r.body[16:28]) != "unsaved work" {
		t.Errorf("read after the late expiry: %x", r.hdr.Status)
	}

	//A timer of an earlier detach must not close a later one early
	back.nc.Close()
	time.Sleep(100 * time.Millisecond)
	if h.srv.expireDetached(o, detach) {
		t.Error("a stale timer expired the handle")
	}
	if !h.srv.expireDetached(o, detach+1) {
		t.Error("the current timer must expire the handle")
	}
	late := newRawClient(t, h)
	if r := leaseCreate(t, late, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableReconnect(got.id, 7)); r.status != wire.StatusObjectNameNotFound {
		t.Errorf("reconnect to an expired handle: %x", r.status)
	}
	h.srv.closeOpen(o)
}

func TestLogoffClosesDurableHandles(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 0))
	if r := a.call(wire.CmdLogoff, []byte{4, 0, 0, 0}); r.hdr.Status != 0 {
		t.Fatalf("logoff: %x", r.hdr.Status)
	}
	if n := h.srv.files.Count(fileKey(h.share, "doc.txt")); n != 0 {
		t.Errorf("%d handles: a logoff closes durable handles", n)
	}
}

func TestNoDurableHandleWithoutHandleCaching(t *testing.T) {
	h := leaseHarness(t)
	a := newRawClient(t, h)
	if got := leaseCreate(t, a, "doc.txt", openAllShare, leaseV2(1, leaseRead, 0), durableV2(7, 0)); got.durable {
		t.Error("a durable handle needs a handle caching lease")
	}
}
