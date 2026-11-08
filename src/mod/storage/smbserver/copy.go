package smbserver

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"strconv"
	"sync"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	copy.go

	Server side copy. File Explorer asks for a resume key on the source file,
	then sends FSCTL_SRV_COPYCHUNK on the target with the ranges to copy, so
	a copy within this server never sends the data over the network.

	Each chunk is a read and a write that go through the same checks as
	READ and WRITE: access on both opens, byte range locks, the drive's
	access list and the target's quota.
*/

// Limits of one request, the ones Windows servers use. A request over them
// is refused with the limits, and the client splits its copy to fit.
const (
	copyMaxChunks    = 256
	copyMaxChunkSize = 1 << 20
	copyMaxTotal     = 16 << 20
)

type resumeKey [24]byte

// resumeKeys finds the source open of a copy. Keys are random, so knowing a
// file is open does not let anyone copy from it.
type resumeKeys struct {
	mu    sync.Mutex
	opens map[resumeKey]*open
}

func (k *resumeKeys) keyFor(o *open) resumeKey {
	k.mu.Lock()
	defer k.mu.Unlock()
	if o.hasResumeKey {
		return o.resumeKey
	}
	if k.opens == nil {
		k.opens = map[resumeKey]*open{}
	}
	var key resumeKey
	for {
		rand.Read(key[:])
		if _, taken := k.opens[key]; !taken {
			break
		}
	}
	k.opens[key] = o
	o.resumeKey, o.hasResumeKey = key, true
	return key
}

func (k *resumeKeys) find(key resumeKey) *open {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.opens[key]
}

func (k *resumeKeys) drop(o *open) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if o.hasResumeKey {
		delete(k.opens, o.resumeKey)
		o.hasResumeKey = false
	}
}

func (c *conn) requestResumeKey(r *request, q *wire.IoctlRequest) *response {
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	//Any handle gets a key: macOS asks on the share root to learn whether
	//the server copies at all. Copying from a folder fails later.
	if o.pipe != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if q.MaxOutputResponse < 32 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	key := c.srv.resume.keyFor(o)
	w := wire.NewWriter(32)
	w.Bytes(key[:])
	w.U32(0) //No context
	w.Zero(4)
	return ioctlResponse(q, w.B, wire.StatusOK)
}

type copyChunk struct {
	source, target uint64
	length         uint32
}

// copyResult is SRV_COPYCHUNK_RESPONSE. On a refusal for size it carries
// the limits instead.
func copyResult(q *wire.IoctlRequest, status uint32, chunks, chunkBytes, total uint32) *response {
	w := wire.NewWriter(12)
	w.U32(chunks)
	w.U32(chunkBytes)
	w.U32(total)
	return ioctlResponse(q, w.B, status)
}

func parseCopyChunks(input []byte) (resumeKey, []copyChunk, bool) {
	var key resumeKey
	in := wire.NewReader(input)
	copy(key[:], in.Bytes(24))
	count := in.U32()
	in.Skip(4)
	if in.Bad() || uint64(count)*24 > uint64(len(input)) {
		return key, nil, false
	}
	chunks := make([]copyChunk, 0, count)
	for i := uint32(0); i < count; i++ {
		ch := copyChunk{source: in.U64(), target: in.U64(), length: in.U32()}
		in.Skip(4)
		chunks = append(chunks, ch)
	}
	return key, chunks, !in.Bad()
}

// copyChunks is FSCTL_SRV_COPYCHUNK, and with needRead false the _WRITE
// form, which lets a target opened for writing alone receive the copy.
func (c *conn) copyChunks(r *request, q *wire.IoctlRequest, needRead bool) *response {
	target, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if target.pipe != nil || target.isDir || target.file == nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if q.MaxOutputResponse < 12 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if target.access&(wire.FileWriteData|wire.FileAppendData) == 0 || needRead && target.access&wire.FileReadData == 0 {
		return errorResponse(wire.StatusAccessDenied)
	}

	key, chunks, ok := parseCopyChunks(q.Input)
	if !ok {
		return errorResponse(wire.StatusInvalidParameter)
	}
	var total uint64
	tooBig := len(chunks) > copyMaxChunks
	for _, ch := range chunks {
		if ch.length == 0 || ch.length > copyMaxChunkSize {
			tooBig = true
		}
		total += uint64(ch.length)
	}
	if tooBig || total > copyMaxTotal {
		return copyResult(q, wire.StatusInvalidParameter, copyMaxChunks, copyMaxChunkSize, copyMaxTotal)
	}

	source := c.srv.resume.find(key)
	if source == nil || source.sess.username != r.sess.username {
		//Another user's key is treated as no key at all
		return errorResponse(wire.StatusObjectNameNotFound)
	}
	if source.access&wire.FileReadData == 0 {
		return errorResponse(wire.StatusAccessDenied)
	}
	if source.isDir || source.file == nil {
		return errorResponse(wire.StatusInvalidDeviceRequest)
	}

	var written, copied uint32
	buf := make([]byte, copyMaxChunkSize)
	for _, ch := range chunks {
		if st := c.copyOne(source, target, ch, buf); st != wire.StatusOK {
			return copyResult(q, st, written, 0, copied)
		}
		written++
		copied += ch.length
	}
	r.detail += "copied=" + strconv.FormatUint(uint64(copied), 10) + " "
	return copyResult(q, wire.StatusOK, written, 0, copied)
}

// lockPair takes the I/O side of both opens in one fixed order, so that two
// copies running opposite ways cannot hold one each while a close waits.
func lockPair(a, b *open) func() {
	if a == b {
		a.io.RLock()
		return a.io.RUnlock
	}
	if bytes.Compare(a.id[:], b.id[:]) > 0 {
		a, b = b, a
	}
	a.io.RLock()
	b.io.RLock()
	return func() {
		b.io.RUnlock()
		a.io.RUnlock()
	}
}

func (c *conn) copyOne(source, target *open, ch copyChunk, buf []byte) uint32 {
	unlock := lockPair(source, target)
	defer unlock()
	if source.closed || target.closed {
		return wire.StatusFileClosed
	}
	sourceShare, targetShare := source.tree.share, target.tree.share
	sp, tp := source.getPath(), target.getPath()
	if !sourceShare.CanRead(sp) || !writable(targetShare, tp) {
		return wire.StatusAccessDenied
	}
	length := uint64(ch.length)
	if st := source.handle.CheckIO(ch.source, length, false); st != wire.StatusOK {
		return st
	}
	if st := target.handle.CheckIO(ch.target, length, true); st != wire.StatusOK {
		return st
	}

	end := int64(ch.target) + int64(length)
	target.metaMu.Lock()
	growth := end - target.size
	target.metaMu.Unlock()
	if growth > 0 && !targetShare.HaveSpace(growth) {
		return wire.StatusDiskFull
	}

	data := buf[:ch.length]
	n, err := source.file.ReadAt(data, int64(ch.source))
	if err != nil && !errors.Is(err, io.EOF) {
		return statusOf(err)
	}
	if n < len(data) {
		//The range runs past the end of the source
		return wire.StatusInvalidViewSize
	}
	c.srv.leases.breakForWrite(target.handle.Key(), target.lease)
	if _, err := target.file.WriteAt(data, int64(ch.target)); err != nil {
		return statusOf(err)
	}

	target.metaMu.Lock()
	if end > target.size {
		target.size = end
	}
	target.dirty = true
	target.metaMu.Unlock()
	return wire.StatusOK
}
