package smbserver

import (
	"errors"
	"io"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func (c *conn) handleRead(r *request) *response {
	q, err := wire.ParseRead(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if q.Length > maxTransact || !r.checkCharge(uint64(q.Length)) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe != nil {
		return c.readPipe(o, q)
	}
	if o.isDir {
		return errorResponse(wire.StatusInvalidDeviceRequest)
	}
	if o.access&(wire.FileReadData|wire.FileExecute) == 0 || o.file == nil {
		return errorResponse(wire.StatusAccessDenied)
	}

	o.io.RLock()
	defer o.io.RUnlock()
	if o.closed {
		return errorResponse(wire.StatusFileClosed)
	}
	if !o.tree.share.CanRead(o.getPath()) {
		return errorResponse(wire.StatusAccessDenied)
	}
	if st := o.handle.CheckIO(q.Offset, uint64(q.Length), false); st != wire.StatusOK {
		return errorResponse(st)
	}

	const fixed = 16
	body := make([]byte, fixed+int(q.Length))
	n, err := o.file.ReadAt(body[fixed:], int64(q.Offset))
	if err != nil && !errors.Is(err, io.EOF) {
		return errorResponse(statusOf(err))
	}
	if n == 0 && q.Length > 0 || uint32(n) < q.MinCount {
		return errorResponse(wire.StatusEndOfFile)
	}
	return &response{body: readBody(body[:fixed+n], n)}
}

func readBody(body []byte, n int) []byte {
	w := wire.Writer{B: body[:0]}
	w.U16(17)
	w.U8(wire.HeaderSize + 16)
	w.U8(0)
	w.U32(uint32(n))
	w.U32(0)
	w.U32(0)
	return body
}

func (c *conn) readPipe(o *open, q *wire.ReadRequest) *response {
	o.pipeMu.Lock()
	data, more := o.pipe.Read(int(q.Length))
	o.pipeMu.Unlock()
	if len(data) == 0 {
		return errorResponse(wire.StatusEndOfFile)
	}
	body := make([]byte, 16+len(data))
	copy(body[16:], data)
	res := &response{body: readBody(body, len(data))}
	if more {
		res.status = wire.StatusBufferOverflow
	}
	return res
}

func (c *conn) handleWrite(r *request) *response {
	q, err := wire.ParseWrite(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if len(q.Data) > maxTransact || !r.checkCharge(uint64(len(q.Data))) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe != nil {
		return c.writePipe(o, q)
	}
	if o.isDir {
		return errorResponse(wire.StatusInvalidDeviceRequest)
	}
	if o.access&(wire.FileWriteData|wire.FileAppendData) == 0 || o.file == nil {
		return errorResponse(wire.StatusAccessDenied)
	}

	o.io.RLock()
	defer o.io.RUnlock()
	if o.closed {
		return errorResponse(wire.StatusFileClosed)
	}
	share := o.tree.share
	p := o.getPath()
	if !writable(share, p) {
		return errorResponse(wire.StatusAccessDenied)
	}
	length := uint64(len(q.Data))
	if st := o.handle.CheckIO(q.Offset, length, true); st != wire.StatusOK {
		return errorResponse(st)
	}

	//Quota is checked as a file grows, which is when space is really used
	end := int64(q.Offset) + int64(length)
	o.metaMu.Lock()
	growth := end - o.size
	o.metaMu.Unlock()
	if growth > 0 && !share.HaveSpace(growth) {
		return errorResponse(wire.StatusDiskFull)
	}

	n, err := o.file.WriteAt(q.Data, int64(q.Offset))
	if err != nil {
		return errorResponse(statusOf(err))
	}

	o.metaMu.Lock()
	if end > o.size {
		o.size = end
	}
	o.dirty = true
	o.metaMu.Unlock()

	return &response{body: writeBody(n)}
}

func writeBody(n int) []byte {
	w := wire.NewWriter(16)
	w.U16(17)
	w.U16(0)
	w.U32(uint32(n))
	w.U32(0)
	w.U16(0)
	w.U16(0)
	return w.B
}

func (c *conn) writePipe(o *open, q *wire.WriteRequest) *response {
	o.pipeMu.Lock()
	err := o.pipe.Write(q.Data)
	o.pipeMu.Unlock()
	if err != nil {
		c.trace("pipe %s: %v", o.pipeName, err)
		return errorResponse(wire.StatusPipeDisconnected)
	}
	return &response{body: writeBody(len(q.Data))}
}

func (c *conn) handleFlush(r *request) *response {
	id, err := wire.ParseFlush(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(id)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe == nil && o.file != nil && o.access&(wire.FileWriteData|wire.FileAppendData) != 0 {
		o.io.RLock()
		defer o.io.RUnlock()
		if o.closed {
			return errorResponse(wire.StatusFileClosed)
		}
		if err := o.file.Sync(); err != nil {
			return errorResponse(statusOf(err))
		}
	}
	return &response{body: []byte{4, 0, 0, 0}}
}

func (c *conn) handleLock(r *request) *response {
	q, err := wire.ParseLock(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe != nil || o.isDir {
		return errorResponse(wire.StatusInvalidParameter)
	}

	done := &response{body: []byte{4, 0, 0, 0}}

	//A request either unlocks or locks, never both
	if q.Locks[0].Flags&wire.LockUnlock != 0 {
		for _, l := range q.Locks {
			if l.Flags != wire.LockUnlock {
				return errorResponse(wire.StatusInvalidParameter)
			}
		}
		if st := o.handle.Unlock(q.Locks); st != wire.StatusOK {
			return errorResponse(st)
		}
		return done
	}

	wait := false
	for _, l := range q.Locks {
		kind := l.Flags &^ wire.LockFailImmediately
		if kind != wire.LockShared && kind != wire.LockExclusive {
			return errorResponse(wire.StatusInvalidParameter)
		}
		if l.Flags&wire.LockFailImmediately == 0 {
			wait = true
		}
	}
	if wait && len(q.Locks) > 1 {
		return errorResponse(wire.StatusInvalidParameter)
	}

	status = o.handle.LockSet(q.Locks)
	if status == wire.StatusOK {
		return done
	}
	if status != wire.StatusLockNotGranted || !wait {
		return errorResponse(status)
	}

	op := c.newAsync(r)
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		c.waitForLock(op, o, q)
	}()
	return &response{status: wire.StatusPending, async: op}
}

// waitForLock retries a blocking lock whenever the file's locks change.
func (c *conn) waitForLock(op *asyncOp, o *open, q *wire.LockRequest) {
	for {
		changed := o.handle.Changed()
		if st := o.handle.LockSet(q.Locks); st != wire.StatusLockNotGranted {
			body := []byte{4, 0, 0, 0}
			if st != wire.StatusOK {
				body = nil
			}
			c.finishAsync(op, st, body)
			return
		}
		select {
		case <-changed:
		case <-op.finished:
			return
		case <-c.done:
			return
		}
	}
}

func (c *conn) handleChangeNotify(r *request) *response {
	q, err := wire.ParseChangeNotify(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if !r.checkCharge(uint64(q.MaxOutput)) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if !o.isDir {
		return errorResponse(wire.StatusInvalidParameter)
	}

	//The request stays open until the folder closes or the client cancels it.
	//Reporting changes comes later, Explorer refreshes what it does itself.
	op := c.newAsync(r)
	o.metaMu.Lock()
	o.notifies = append(o.notifies, op)
	o.metaMu.Unlock()
	return &response{status: wire.StatusPending, async: op}
}

// asyncOp is a request answered in two steps: an interim STATUS_PENDING now,
// and the real response later.
type asyncOp struct {
	asyncID   uint64
	hdr       wire.Header
	sess      *session
	ready     chan struct{} //Closed once the interim response is queued
	finished  chan struct{}
	once      sync.Once
	cancelled bool
}

func (c *conn) newAsync(r *request) *asyncOp {
	op := &asyncOp{
		asyncID:  c.nextAsync.Add(1),
		hdr:      r.hdr,
		sess:     r.sess,
		ready:    make(chan struct{}),
		finished: make(chan struct{}),
	}
	c.pendMu.Lock()
	c.pending[op.asyncID] = op
	c.pendingByMsg[op.hdr.MessageID] = op
	if _, early := c.earlyCancels[op.hdr.MessageID]; early {
		delete(c.earlyCancels, op.hdr.MessageID)
		op.cancelled = true
	}
	c.pendMu.Unlock()
	return op
}

// finishAsync sends the final response of an operation, once.
func (c *conn) finishAsync(op *asyncOp, status uint32, body []byte) {
	op.once.Do(func() {
		close(op.finished)
		c.pendMu.Lock()
		delete(c.pending, op.asyncID)
		delete(c.pendingByMsg, op.hdr.MessageID)
		c.pendMu.Unlock()

		//The client must see the interim response first
		select {
		case <-op.ready:
		case <-c.done:
			return
		}

		if body == nil {
			body = []byte{9, 0, 0, 0, 0, 0, 0, 0, 0}
		}
		h := wire.Header{
			CreditCharge: op.hdr.CreditCharge,
			Status:       status,
			Command:      op.hdr.Command,
			Flags:        wire.FlagResponse | wire.FlagAsync,
			MessageID:    op.hdr.MessageID,
			AsyncID:      op.asyncID,
			SessionID:    op.hdr.SessionID,
		}
		msg := make([]byte, wire.HeaderSize+len(body))
		h.Put(msg)
		copy(msg[wire.HeaderSize:], body)
		if op.sess.signer != nil {
			op.sess.signer.Sign(msg)
		}
		frame := make([]byte, 4+len(msg))
		frame[1], frame[2], frame[3] = byte(len(msg)>>16), byte(len(msg)>>8), byte(len(msg))
		copy(frame[4:], msg)
		if err := c.send(frame); err != nil {
			logger.PrintAndLog(logTitle, "Could not finish a pending request", err)
		}
	})
}

func (c *conn) handleCancel(p *part) error {
	c.mu.Lock()
	sess := c.sessions[p.hdr.SessionID]
	c.mu.Unlock()
	if sess == nil || !sess.isValid() {
		return nil
	}
	if p.hdr.Flags&wire.FlagSigned == 0 || !sess.signer.Verify(p.raw) {
		return errDrop
	}

	c.pendMu.Lock()
	var op *asyncOp
	if p.hdr.Flags&wire.FlagAsync != 0 {
		op = c.pending[p.hdr.AsyncID]
	} else {
		op = c.pendingByMsg[p.hdr.MessageID]
		if op == nil && len(c.earlyCancels) < 256 {
			//It may still be on its way to a worker
			c.earlyCancels[p.hdr.MessageID] = struct{}{}
		}
	}
	c.pendMu.Unlock()

	if op != nil && op.sess == sess {
		go c.finishAsync(op, wire.StatusCancelled, nil)
	}
	return nil
}
