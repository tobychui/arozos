package smbserver

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// ioctlWithInput is an IOCTL request carrying an input buffer.
func ioctlWithInput(id wire.FileID, code uint32, input []byte, maxOut uint32) []byte {
	w := wire.NewWriter(56 + len(input))
	w.U16(57)
	w.U16(0)
	w.U32(code)
	w.Bytes(id[:])
	w.U32(wire.HeaderSize + 56) //Input offset
	w.U32(uint32(len(input)))
	w.U32(0)
	w.U32(wire.HeaderSize + 56)
	w.U32(0)
	w.U32(maxOut)
	w.U32(wire.IoctlIsFsctl)
	w.U32(0)
	w.Bytes(input)
	return w.B
}

// ioctlOutput is the output buffer of an IOCTL response.
func ioctlOutput(t *testing.T, r rawReply) []byte {
	t.Helper()
	off := binary.LittleEndian.Uint32(r.body[32:]) - wire.HeaderSize
	n := binary.LittleEndian.Uint32(r.body[36:])
	return r.body[off : off+n]
}

func resumeKeyOf(t *testing.T, c *rawClient, id wire.FileID) []byte {
	t.Helper()
	r := c.call(wire.CmdIoctl, ioctlBody(id, wire.FsctlSrvRequestResumeKey, 32))
	if r.hdr.Status != 0 {
		t.Fatalf("resume key: %x", r.hdr.Status)
	}
	out := ioctlOutput(t, r)
	if len(out) != 32 {
		t.Fatalf("resume key response is %d bytes", len(out))
	}
	return out[:24]
}

type chunk struct {
	src, dst uint64
	n        uint32
}

func copyInput(key []byte, chunks []chunk) []byte {
	w := wire.NewWriter(32 + 24*len(chunks))
	w.Bytes(key)
	w.U32(uint32(len(chunks)))
	w.U32(0)
	for _, ch := range chunks {
		w.U64(ch.src)
		w.U64(ch.dst)
		w.U32(ch.n)
		w.U32(0)
	}
	return w.B
}

type copyReply struct {
	status                     uint32
	chunks, chunkBytes, copied uint32
}

func serverCopy(t *testing.T, c *rawClient, target wire.FileID, code uint32, key []byte, chunks []chunk) copyReply {
	t.Helper()
	r := c.call(wire.CmdIoctl, ioctlWithInput(target, code, copyInput(key, chunks), 12))
	out := copyReply{status: r.hdr.Status}
	if r.hdr.Status == 0 || r.hdr.Status == wire.StatusInvalidParameter && len(r.body) >= 48+12 {
		b := ioctlOutput(t, r)
		if len(b) >= 12 {
			out.chunks = binary.LittleEndian.Uint32(b)
			out.chunkBytes = binary.LittleEndian.Uint32(b[4:])
			out.copied = binary.LittleEndian.Uint32(b[8:])
		}
	}
	return out
}

var openRead = createOpts{access: wire.FileReadData | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen}

func TestServerSideCopy(t *testing.T) {
	h := newHarness(t)
	data := make([]byte, 3<<20+12345)
	rand.Read(data)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), data, 0644)
	c := newRawClient(t, h)
	src := mustCreate(t, c, "src.bin", openRead)
	dst := mustCreate(t, c, "dst.bin", openRW)
	key := resumeKeyOf(t, c, src)

	//Explorer copies in 1 MiB chunks, in more than one request
	chunks := []chunk{}
	for off := 0; off < len(data); off += 1 << 20 {
		n := 1 << 20
		if off+n > len(data) {
			n = len(data) - off
		}
		chunks = append(chunks, chunk{uint64(off), uint64(off), uint32(n)})
	}
	got := serverCopy(t, c, dst, wire.FsctlSrvCopyChunkWrite, key, chunks[:2])
	if got.status != 0 || got.chunks != 2 || got.copied != 2<<20 {
		t.Fatalf("first request: %+v", got)
	}
	got = serverCopy(t, c, dst, wire.FsctlSrvCopyChunk, key, chunks[2:])
	if got.status != 0 || got.chunks != uint32(len(chunks)-2) {
		t.Fatalf("second request: %+v", got)
	}
	c.close(dst)
	written, _ := os.ReadFile(filepath.Join(h.share.root, "dst.bin"))
	if !bytes.Equal(written, data) {
		t.Errorf("copied %d bytes, they differ from the source", len(written))
	}
	h.share.mu.Lock()
	changed := len(h.share.changed)
	h.share.mu.Unlock()
	if changed == 0 {
		t.Error("the target must be accounted for like a write")
	}
}

func TestServerSideCopyLimits(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), make([]byte, 100), 0644)
	c := newRawClient(t, h)
	src := mustCreate(t, c, "src.bin", openRead)
	dst := mustCreate(t, c, "dst.bin", openRW)
	key := resumeKeyOf(t, c, src)

	tooMany := make([]chunk, copyMaxChunks+1)
	for i := range tooMany {
		tooMany[i] = chunk{0, 0, 1}
	}
	cases := map[string][]chunk{
		"chunk too big": {{0, 0, copyMaxChunkSize + 1}},
		"too many":      tooMany,
		"empty chunk":   {{0, 0, 0}},
	}
	for name, chunks := range cases {
		got := serverCopy(t, c, dst, wire.FsctlSrvCopyChunkWrite, key, chunks)
		if got.status != wire.StatusInvalidParameter {
			t.Errorf("%s: status %x", name, got.status)
			continue
		}
		if got.chunks != copyMaxChunks || got.chunkBytes != copyMaxChunkSize || got.copied != copyMaxTotal {
			t.Errorf("%s: the refusal must carry the limits: %+v", name, got)
		}
	}
	if got := serverCopy(t, c, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{50, 0, 100}}); got.status != wire.StatusInvalidViewSize {
		t.Errorf("past the end of the source: %x", got.status)
	}
}

func TestServerSideCopyChecksAccess(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), make([]byte, 100), 0644)
	os.WriteFile(filepath.Join(h.share.root, "ro.bin"), make([]byte, 100), 0644)
	c := newRawClient(t, h)
	src := mustCreate(t, c, "src.bin", openRead)
	key := resumeKeyOf(t, c, src)
	one := []chunk{{0, 0, 10}}

	readOnly := mustCreate(t, c, "ro.bin", openRead)
	if got := serverCopy(t, c, readOnly, wire.FsctlSrvCopyChunkWrite, key, one); got.status != wire.StatusAccessDenied {
		t.Errorf("target without write access: %x", got.status)
	}
	writeOnly := mustCreate(t, c, "wo.bin", createOpts{access: wire.FileWriteData, share: shareAll, disposition: wire.DispositionOpenIf})
	if got := serverCopy(t, c, writeOnly, wire.FsctlSrvCopyChunk, key, one); got.status != wire.StatusAccessDenied {
		t.Errorf("COPYCHUNK needs read access on the target too: %x", got.status)
	}
	if got := serverCopy(t, c, writeOnly, wire.FsctlSrvCopyChunkWrite, key, one); got.status != 0 {
		t.Errorf("COPYCHUNK_WRITE needs write access alone: %x", got.status)
	}

	bogus := make([]byte, 24)
	if got := serverCopy(t, c, writeOnly, wire.FsctlSrvCopyChunkWrite, bogus, one); got.status != wire.StatusObjectNameNotFound {
		t.Errorf("unknown key: %x", got.status)
	}
	c.close(src)
	if got := serverCopy(t, c, writeOnly, wire.FsctlSrvCopyChunkWrite, key, one); got.status != wire.StatusObjectNameNotFound {
		t.Errorf("the key of a closed file must stop working: %x", got.status)
	}

	h.share.mu.Lock()
	h.share.denyWrite["wo.bin"] = true
	h.share.mu.Unlock()
	src = mustCreate(t, c, "src.bin", openRead)
	key = resumeKeyOf(t, c, src)
	if got := serverCopy(t, c, writeOnly, wire.FsctlSrvCopyChunkWrite, key, one); got.status != wire.StatusAccessDenied {
		t.Errorf("a drive that stopped allowing writes: %x", got.status)
	}
}

func TestServerSideCopyQuota(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), make([]byte, 4096), 0644)
	c := newRawClient(t, h)
	src := mustCreate(t, c, "src.bin", openRead)
	dst := mustCreate(t, c, "dst.bin", openRW)
	key := resumeKeyOf(t, c, src)
	h.share.mu.Lock()
	h.share.spaceLeft = 1000
	h.share.mu.Unlock()
	if got := serverCopy(t, c, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{0, 0, 4096}}); got.status != wire.StatusDiskFull {
		t.Errorf("status %x", got.status)
	}
}

func TestServerSideCopyAcrossSessions(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), []byte("0123456789"), 0644)
	a := newRawClient(t, h)
	src := mustCreate(t, a, "src.bin", openRead)
	key := resumeKeyOf(t, a, src)

	//Explorer may copy on another connection of the same user
	b := newRawClient(t, h)
	dst := mustCreate(t, b, "dst.bin", openRW)
	if got := serverCopy(t, b, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{0, 0, 10}}); got.status != 0 {
		t.Fatalf("status %x", got.status)
	}
	b.close(dst)
	if got, _ := os.ReadFile(filepath.Join(h.share.root, "dst.bin")); string(got) != "0123456789" {
		t.Errorf("content %q", got)
	}
}

// A copy on one connection can find its source just before the source's own
// connection dies and detaches it, which leaves it without a session.
func TestServerSideCopyFromADetachedSource(t *testing.T) {
	h := leaseHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "src.bin"), []byte("0123456789"), 0644)
	a := newRawClient(t, h)
	src := leaseCreate(t, a, "src.bin", openAllShare, leaseV2(1, rwh, 0), durableV2(7, 0))
	if src.status != 0 || !src.durable {
		t.Fatalf("durable grant: %+v", src)
	}
	key := resumeKeyOf(t, a, src.id)
	var k resumeKey
	copy(k[:], key)
	o := h.srv.resume.find(k)
	if o == nil {
		t.Fatal("no open behind the key")
	}

	//The moment between the lookup of the key and its drop by the detach
	h.srv.durables.mu.Lock()
	conn, sess := o.conn, o.sess
	o.conn, o.sess = nil, nil
	h.srv.durables.mu.Unlock()

	b := newRawClient(t, h)
	dst := mustCreate(t, b, "dst.bin", openRW)
	if got := serverCopy(t, b, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{0, 0, 10}}); got.status != wire.StatusObjectNameNotFound {
		t.Errorf("copy from a detached source: %x", got.status)
	}

	h.srv.durables.mu.Lock()
	o.conn, o.sess = conn, sess
	h.srv.durables.mu.Unlock()
	if got := serverCopy(t, b, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{0, 0, 10}}); got.status != 0 {
		t.Errorf("copy from the attached source: %x", got.status)
	}
}

func TestResumeKeyOnAFolder(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	root := openFolder(t, c, "")
	//macOS asks this to learn whether server side copy exists
	key := resumeKeyOf(t, c, root)
	dst := mustCreate(t, c, "dst.bin", openRW)
	if got := serverCopy(t, c, dst, wire.FsctlSrvCopyChunkWrite, key, []chunk{{0, 0, 10}}); got.status != wire.StatusInvalidDeviceRequest {
		t.Errorf("copying from a folder: %x", got.status)
	}
}
