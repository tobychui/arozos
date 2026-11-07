package smbserver

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// errDrop ends the connection without a reply. It is used whenever the peer
// broke the protocol in a way that a status code would only encourage.
var errDrop = errors.New("smbserver: dropping connection")

// conn is one TCP connection. A reader goroutine takes frames off the socket
// and hands requests to worker goroutines; one writer goroutine owns the
// socket for output, so responses of different requests never interleave.
type conn struct {
	srv    *Server
	nc     net.Conn
	remote string
	id     uint64

	sendq chan []byte
	done  chan struct{}
	once  sync.Once
	work  chan struct{} //Bounds the requests running at once
	wg    sync.WaitGroup

	mu         sync.Mutex
	sawSMB1    bool
	negotiated bool
	dialect    uint16
	signAlgo   uint16
	preauth    [64]byte
	clientGUID [16]byte
	clientCaps uint32
	clientMode uint16
	window     creditWindow
	sessions   map[uint64]*session
	loggedIn   bool

	pendMu       sync.Mutex
	pending      map[uint64]*asyncOp //By async id
	pendingByMsg map[uint64]*asyncOp
	earlyCancels map[uint64]struct{}
	nextAsync    atomic.Uint64
}

func newConn(s *Server, nc net.Conn, remote string) *conn {
	return &conn{
		srv:          s,
		nc:           nc,
		remote:       remote,
		id:           s.nextID.Add(1),
		sendq:        make(chan []byte, 16),
		done:         make(chan struct{}),
		work:         make(chan struct{}, maxInFlight),
		window:       creditWindow{high: 1, used: map[uint64]struct{}{}},
		sessions:     map[uint64]*session{},
		pending:      map[uint64]*asyncOp{},
		pendingByMsg: map[uint64]*asyncOp{},
		earlyCancels: map[uint64]struct{}{},
	}
}

// creditWindow is the set of message ids the client may use next. Every id
// can be used once, so a captured request cannot be replayed on the connection.
type creditWindow struct {
	low, high uint64
	used      map[uint64]struct{}
}

func (w *creditWindow) consume(mid uint64, charge uint16) bool {
	n := uint64(charge)
	if n == 0 {
		n = 1
	}
	if mid < w.low || mid+n < mid || mid+n > w.high {
		return false
	}
	for i := uint64(0); i < n; i++ {
		if _, dup := w.used[mid+i]; dup {
			return false
		}
	}
	for i := uint64(0); i < n; i++ {
		w.used[mid+i] = struct{}{}
	}
	for {
		if _, ok := w.used[w.low]; !ok {
			return true
		}
		delete(w.used, w.low)
		w.low++
	}
}

// grant hands out credits for one response. What the request spent comes back,
// plus what it asked for beyond one, in the same steps Samba and Windows use.
// This is how a client's balance grows: a client that only ever got back what
// it spent could never have more than one large read on the wire at a time,
// and the copy would run at one read per round trip.
func (w *creditWindow) grant(requested, charge uint16, loggedIn bool) uint16 {
	if charge == 0 {
		charge = 1
	}
	if requested == 0 {
		requested = 1
	}
	extra := uint64(requested - 1)
	limit := uint64(maxExtraCredits)
	if loggedIn {
		//A finished login may take its whole request at once
		limit = maxCredits
	}
	if extra > limit {
		extra = limit
	}
	want := uint64(charge) + extra

	outstanding := w.high - w.low - uint64(len(w.used))
	room := uint64(0)
	if outstanding < maxCredits {
		room = maxCredits - outstanding
	}
	if want > room {
		want = room
	}
	if want == 0 && outstanding == 0 {
		want = 1
	}
	w.high += want
	return uint16(want)
}

// part is one request of a compound.
type part struct {
	hdr wire.Header
	raw []byte //From this header to the next one, as the signature covers it
}

// splitCompound cuts a frame into its requests.
func splitCompound(frame []byte) ([]*part, error) {
	out := []*part{}
	for off := 0; ; {
		h, err := wire.ParseHeader(frame[off:])
		if err != nil {
			return nil, err
		}
		end := len(frame)
		if h.NextCommand != 0 {
			next := int(h.NextCommand)
			if next%8 != 0 || next < wire.HeaderSize || next > len(frame)-off-wire.HeaderSize {
				return nil, wire.ErrMalformed
			}
			end = off + next
		}
		out = append(out, &part{hdr: h, raw: frame[off:end]})
		if h.NextCommand == 0 {
			return out, nil
		}
		if len(out) >= maxCompound {
			return nil, wire.ErrMalformed
		}
		off = end
	}
}

// serve runs the connection until it ends.
func (c *conn) serve() {
	go c.writeLoop()
	err := c.readLoop()
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
		c.trace("connection ended: %v", err)
	}
	c.shutdown()
	c.wg.Wait()
	c.closeAll()
}

func (c *conn) shutdown() {
	c.once.Do(func() {
		close(c.done)
		c.nc.Close()
	})
}

func (c *conn) writeLoop() {
	for {
		select {
		case frame := <-c.sendq:
			c.nc.SetWriteDeadline(time.Now().Add(2 * time.Minute))
			if _, err := c.nc.Write(frame); err != nil {
				c.shutdown()
				return
			}
		case <-c.done:
			return
		}
	}
}

func (c *conn) readLoop() error {
	c.nc.SetReadDeadline(time.Now().Add(c.srv.cfg.LoginTimeout))
	head := make([]byte, 4)
	for {
		if _, err := io.ReadFull(c.nc, head); err != nil {
			return err
		}
		if head[0] != 0 {
			return wire.ErrMalformed
		}
		size := int(head[1])<<16 | int(head[2])<<8 | int(head[3])

		limit := maxPreloginSize
		c.mu.Lock()
		if c.loggedIn {
			limit = maxFrameSize
		}
		c.mu.Unlock()
		if size < 4 || size > limit {
			return fmt.Errorf("frame of %d bytes", size)
		}

		frame := make([]byte, size)
		if _, err := io.ReadFull(c.nc, frame); err != nil {
			return err
		}
		if c.srv.capture != nil {
			c.srv.capture.record(c, true, frame)
		}
		if err := c.handleFrame(frame); err != nil {
			return err
		}
	}
}

func (c *conn) handleFrame(frame []byte) error {
	if wire.IsSMB1(frame) {
		return c.handleSMB1(frame)
	}
	parts, err := splitCompound(frame)
	if err != nil {
		return err
	}

	//CANCEL neither uses a credit nor gets a reply
	if len(parts) == 1 && parts[0].hdr.Command == wire.CmdCancel {
		return c.handleCancel(parts[0])
	}

	c.mu.Lock()
	for _, p := range parts {
		if !c.window.consume(p.hdr.MessageID, p.hdr.CreditCharge) {
			c.mu.Unlock()
			return fmt.Errorf("message id %d outside the window", p.hdr.MessageID)
		}
	}
	loggedIn := c.loggedIn
	c.mu.Unlock()

	if !loggedIn || mustRunInOrder(parts) {
		return c.runChain(parts)
	}

	//Requests of one connection run side by side: a slow drive must not hold
	//up the rest, and clients do not depend on the order of completion.
	select {
	case c.work <- struct{}{}:
	case <-c.done:
		return net.ErrClosed
	}
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		defer func() { <-c.work }()
		if err := c.runChain(parts); err != nil {
			c.trace("request failed: %v", err)
			c.shutdown()
		}
	}()
	return nil
}

// mustRunInOrder picks out the commands that change what later requests see.
func mustRunInOrder(parts []*part) bool {
	for _, p := range parts {
		switch p.hdr.Command {
		case wire.CmdNegotiate, wire.CmdSessionSetup, wire.CmdLogoff, wire.CmdTreeConnect, wire.CmdTreeDisconnect:
			return true
		}
	}
	return false
}

// request is one command being handled.
type request struct {
	hdr       wire.Header
	raw       []byte
	sess      *session
	tree      *tree
	chain     *chainState
	traceInfo string
	detail    string //Control code or info class, for the trace
}

// chainState carries the values related requests inherit.
type chainState struct {
	sessionID uint64
	treeID    uint32
	fileID    wire.FileID
	hasFile   bool
	createErr uint32
}

// response is what a handler returns.
type response struct {
	status  uint32
	body    []byte
	errData []byte
	async   *asyncOp
	after   func(raw []byte) //Sees the finished unsigned message
	signAs  *session         //Overrides r.sess, for the end of a login
}

func errorResponse(status uint32) *response { return &response{status: status} }

// runChain handles a compound in order and sends its responses as one frame.
func (c *conn) runChain(parts []*part) error {
	chain := &chainState{}
	out := make([]*builtPart, 0, len(parts))
	asyncs := []*asyncOp{}
	for i, p := range parts {
		r := &request{hdr: p.hdr, raw: p.raw, chain: chain}
		started := time.Now()

		var res *response
		related := p.hdr.Flags&wire.FlagRelated != 0
		switch {
		case related && i == 0:
			res = errorResponse(wire.StatusInvalidParameter)
		default:
			if related {
				r.hdr.SessionID = chain.sessionID
				r.hdr.TreeID = chain.treeID
			}
			var err error
			res, err = c.dispatch(r)
			if err != nil {
				return err
			}
		}

		chain.sessionID = r.hdr.SessionID
		chain.treeID = r.hdr.TreeID
		if p.hdr.Command == wire.CmdCreate && wire.IsError(res.status) {
			chain.createErr = res.status
		}
		c.traceRequest(r, res, time.Since(started))
		out = append(out, c.buildPart(r, res))
		if res.async != nil {
			asyncs = append(asyncs, res.async)
		}
	}
	err := c.sendParts(out)

	//Only now may the final responses go out, after their interim ones
	for _, op := range asyncs {
		close(op.ready)
		if op.cancelled {
			go c.finishAsync(op, wire.StatusCancelled, nil)
		}
	}
	return err
}

// dispatch finds the session and tree of a request, proves it came from the
// signed in client, and runs the handler.
func (c *conn) dispatch(r *request) (*response, error) {
	cmd := r.hdr.Command
	switch cmd {
	case wire.CmdNegotiate:
		return c.handleNegotiate(r)
	case wire.CmdSessionSetup:
		return c.handleSessionSetup(r)
	}

	c.mu.Lock()
	negotiated := c.negotiated
	sess := c.sessions[r.hdr.SessionID]
	c.mu.Unlock()
	if !negotiated {
		return nil, errDrop
	}

	if cmd == wire.CmdEcho && r.hdr.SessionID == 0 {
		return &response{body: []byte{4, 0, 0, 0}}, nil
	}
	if sess == nil || !sess.isValid() {
		return errorResponse(wire.StatusUserSessionDeleted), nil
	}

	//Signing cannot be skipped: an unsigned or forged request on a signed
	//session means someone is in the middle, so the connection goes
	if r.hdr.Flags&wire.FlagSigned == 0 || !sess.signer.Verify(r.raw) {
		logger.PrintAndLog(logTitle, "Bad signature from "+c.remote+", closing the connection", nil)
		return nil, errDrop
	}
	r.sess = sess

	switch cmd {
	case wire.CmdEcho:
		return &response{body: []byte{4, 0, 0, 0}}, nil
	case wire.CmdLogoff:
		return c.handleLogoff(r), nil
	case wire.CmdTreeConnect:
		return c.handleTreeConnect(r), nil
	}

	t := sess.tree(r.hdr.TreeID)
	if t == nil {
		return errorResponse(wire.StatusNetworkNameDeleted), nil
	}
	r.tree = t

	switch cmd {
	case wire.CmdTreeDisconnect:
		return c.handleTreeDisconnect(r), nil
	case wire.CmdCreate:
		return c.handleCreate(r), nil
	case wire.CmdClose:
		return c.handleClose(r), nil
	case wire.CmdFlush:
		return c.handleFlush(r), nil
	case wire.CmdRead:
		return c.handleRead(r), nil
	case wire.CmdWrite:
		return c.handleWrite(r), nil
	case wire.CmdLock:
		return c.handleLock(r), nil
	case wire.CmdIoctl:
		return c.handleIoctl(r), nil
	case wire.CmdQueryDirectory:
		return c.handleQueryDirectory(r), nil
	case wire.CmdChangeNotify:
		return c.handleChangeNotify(r), nil
	case wire.CmdQueryInfo:
		return c.handleQueryInfo(r), nil
	case wire.CmdSetInfo:
		return c.handleSetInfo(r), nil
	case wire.CmdOplockBreak:
		//No oplock or lease is ever granted, so nothing can break
		return errorResponse(wire.StatusInvalidOplockProtocol), nil
	}
	return errorResponse(wire.StatusNotImplemented), nil
}

// open finds the handle a request names, following "the previous file".
func (r *request) open(id wire.FileID) (*open, uint32) {
	if id.IsPrevious() {
		if r.chain.createErr != 0 {
			return nil, r.chain.createErr
		}
		if !r.chain.hasFile {
			return nil, wire.StatusInvalidParameter
		}
		id = r.chain.fileID
	}
	o := r.sess.open(id)
	if o == nil || o.tree != r.tree {
		return nil, wire.StatusFileClosed
	}
	r.chain.fileID = id
	r.chain.hasFile = true
	r.traceInfo = o.tracePath()
	return o, wire.StatusOK
}

// checkCharge enforces multi credit rules: a big payload must be paid for.
func (r *request) checkCharge(size uint64) bool {
	if size == 0 {
		return true
	}
	need := (size-1)/65536 + 1
	charge := uint64(r.hdr.CreditCharge)
	if charge == 0 {
		charge = 1
	}
	return charge >= need
}

// builtPart is a finished response, not yet signed.
type builtPart struct {
	buf    []byte //msg with room for the frame header in front
	msg    []byte
	sess   *session
	after  func([]byte)
	unsign bool
}

func (c *conn) buildPart(r *request, res *response) *builtPart {
	body := res.body
	if body == nil {
		//The error body, also used for interim responses. A status of the
		//error class can still carry a real body: the NTLM challenge travels
		//under STATUS_MORE_PROCESSING_REQUIRED.
		w := wire.NewWriter(9 + len(res.errData))
		w.U16(9)
		w.U16(0)
		w.U32(uint32(len(res.errData)))
		if len(res.errData) == 0 {
			w.U8(0)
		} else {
			w.Bytes(res.errData)
		}
		body = w.B
	}

	loginDone := r.hdr.Command == wire.CmdSessionSetup && res.status == wire.StatusOK
	c.mu.Lock()
	granted := c.window.grant(r.hdr.Credits, r.hdr.CreditCharge, loginDone)
	c.mu.Unlock()

	h := wire.Header{
		CreditCharge: r.hdr.CreditCharge,
		Status:       res.status,
		Command:      r.hdr.Command,
		Credits:      granted,
		Flags:        wire.FlagResponse | r.hdr.Flags&wire.FlagRelated,
		MessageID:    r.hdr.MessageID,
		TreeID:       r.hdr.TreeID,
		SessionID:    r.hdr.SessionID,
	}
	if res.async != nil {
		h.Flags |= wire.FlagAsync
		h.AsyncID = res.async.asyncID
	}

	//Four bytes of room in front, so that a response on its own can become
	//the frame without another copy
	buf := make([]byte, 4+wire.HeaderSize+len(body))
	msg := buf[4:]
	h.Put(msg)
	copy(msg[wire.HeaderSize:], body)

	sess := r.sess
	if res.signAs != nil {
		sess = res.signAs
	}
	return &builtPart{buf: buf, msg: msg, sess: sess, after: res.after, unsign: res.status == wire.StatusPending}
}

// sendParts links the parts of a compound, signs each one over its final
// bytes, and queues the frame.
func (c *conn) sendParts(parts []*builtPart) error {
	total := 0
	for i, p := range parts {
		if i < len(parts)-1 {
			if rem := len(p.msg) % 8; rem != 0 {
				p.msg = append(p.msg, make([]byte, 8-rem)...)
			}
			binary.LittleEndian.PutUint32(p.msg[20:], uint32(len(p.msg)))
		}
		total += len(p.msg)
	}

	for _, p := range parts {
		if p.after != nil {
			p.after(p.msg)
		}
		if p.sess != nil && p.sess.signer != nil && !p.unsign {
			p.sess.signer.Sign(p.msg)
		}
	}

	var frame []byte
	if len(parts) == 1 {
		frame = parts[0].buf
	} else {
		frame = make([]byte, 4, 4+total)
		for _, p := range parts {
			frame = append(frame, p.msg...)
		}
	}
	frame[1], frame[2], frame[3] = byte(total>>16), byte(total>>8), byte(total)
	return c.send(frame)
}

func (c *conn) send(frame []byte) error {
	if c.srv.capture != nil {
		c.srv.capture.record(c, false, frame[4:])
	}
	select {
	case c.sendq <- frame:
		return nil
	case <-c.done:
		return net.ErrClosed
	}
}

// hasUser reports whether a user is logged in on this connection.
func (c *conn) hasUser(username string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, sess := range c.sessions {
		sess.mu.Lock()
		match := sess.valid && strings.EqualFold(sess.username, username)
		sess.mu.Unlock()
		if match {
			return true
		}
	}
	return false
}

// closeAll runs when the connection is gone, and frees what the client held.
func (c *conn) closeAll() {
	c.mu.Lock()
	list := make([]*session, 0, len(c.sessions))
	for _, s := range c.sessions {
		list = append(list, s)
	}
	c.sessions = map[uint64]*session{}
	c.mu.Unlock()
	for _, s := range list {
		s.closeAllTrees(c)
	}
}

func (c *conn) trace(format string, args ...any) {
	if c.srv.capture != nil {
		c.srv.capture.tracef(c.id, format, args...)
	}
}

var commandNames = map[uint16]string{
	wire.CmdNegotiate: "NEGOTIATE", wire.CmdSessionSetup: "SESSION_SETUP", wire.CmdLogoff: "LOGOFF",
	wire.CmdTreeConnect: "TREE_CONNECT", wire.CmdTreeDisconnect: "TREE_DISCONNECT", wire.CmdCreate: "CREATE",
	wire.CmdClose: "CLOSE", wire.CmdFlush: "FLUSH", wire.CmdRead: "READ", wire.CmdWrite: "WRITE",
	wire.CmdLock: "LOCK", wire.CmdIoctl: "IOCTL", wire.CmdCancel: "CANCEL", wire.CmdEcho: "ECHO",
	wire.CmdQueryDirectory: "QUERY_DIRECTORY", wire.CmdChangeNotify: "CHANGE_NOTIFY",
	wire.CmdQueryInfo: "QUERY_INFO", wire.CmdSetInfo: "SET_INFO", wire.CmdOplockBreak: "OPLOCK_BREAK",
}

func (c *conn) traceRequest(r *request, res *response, took time.Duration) {
	if c.srv.capture == nil {
		return
	}
	c.srv.capture.tracef(c.id, "mid=%d %s %q %sstatus=0x%08x took=%s", r.hdr.MessageID, commandNames[r.hdr.Command], r.traceInfo, r.detail, res.status, took.Round(time.Microsecond))
}
