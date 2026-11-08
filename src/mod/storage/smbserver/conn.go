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
	"imuslab.com/arozos/mod/storage/smbserver/crypt"
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
	serverCaps uint32 //What NEGOTIATE answered, which VALIDATE_NEGOTIATE repeats
	cipher     uint16 //Negotiated encryption, zero for none
	window     creditWindow
	sessions   map[uint64]*session
	loggedIn   bool

	pendMu       sync.Mutex
	pending      map[uint64]*asyncOp //By async id
	pendingByMsg map[uint64]*asyncOp
	earlyCancels map[uint64]struct{}
	nextAsync    atomic.Uint64
	revoked      atomic.Bool //Closed by an admin: durable handles go too
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
	hdr       wire.Header
	raw       []byte //From this header to the next one, as the signature covers it
	encrypted bool   //It came in a transform, which replaces the signature
	sessionID uint64 //Of the transform
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
		//The capture gets the plain message, after any decryption
		if err := c.handleFrame(frame); err != nil {
			return err
		}
	}
}

func (c *conn) handleFrame(frame []byte) error {
	if wire.IsSMB1(frame) {
		return c.handleSMB1(frame)
	}
	encrypted := false
	var transformSession uint64
	if sid, ok := crypt.TransformSession(frame); ok {
		plain, err := c.decrypt(sid, frame)
		if err != nil {
			return err
		}
		frame, encrypted, transformSession = plain, true, sid
	}
	if c.srv.capture != nil {
		c.srv.capture.record(c, true, frame)
	}
	parts, err := splitCompound(frame)
	if err != nil {
		return err
	}
	for _, p := range parts {
		p.encrypted, p.sessionID = encrypted, transformSession
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
	encrypted bool
	sessionID uint64 //Of the transform the request came in
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
	plain   bool             //Never sealed, even on an encrypted session
}

func errorResponse(status uint32) *response { return &response{status: status} }

// mayGoAsync lists the commands that can outlast a client's patience on a slow
// drive: a staged download, an upload at close, a listing of a remote folder.
var mayGoAsync = map[uint16]bool{
	wire.CmdCreate: true, wire.CmdClose: true, wire.CmdFlush: true, wire.CmdRead: true,
	wire.CmdWrite: true, wire.CmdIoctl: true, wire.CmdQueryDirectory: true,
	wire.CmdQueryInfo: true, wire.CmdSetInfo: true,
}

// runSingle handles one request that is not part of a compound. If it takes
// longer than PendingAfter, the client gets STATUS_PENDING now and the real
// response when it is ready, so a slow drive does not trip its timeout.
func (c *conn) runSingle(p *part) error {
	r := &request{hdr: p.hdr, raw: p.raw, chain: &chainState{}, encrypted: p.encrypted, sessionID: p.sessionID}
	started := time.Now()
	res, err := c.authorize(r)
	if err != nil {
		return err
	}
	if res == nil {
		done := make(chan *response, 1)
		go func() { done <- c.route(r) }()
		timer := time.NewTimer(c.srv.cfg.PendingAfter)
		select {
		case res = <-done:
			timer.Stop()
		case <-timer.C:
			op := c.newAsync(r)
			interim := c.buildPart(r, &response{status: wire.StatusPending, async: op})
			if err := c.sendParts([]*builtPart{interim}); err != nil {
				return err
			}
			close(op.ready)
			c.wg.Add(1)
			go func() {
				defer c.wg.Done()
				final := <-done
				c.traceRequest(r, final, time.Since(started))
				if !c.finishAsyncResponse(op, final) {
					c.dropUnseenOpen(r, final)
				}
			}()
			if op.cancelled {
				go c.finishAsync(op, wire.StatusCancelled, nil)
			}
			return nil
		case <-c.done:
			return net.ErrClosed
		}
	}
	c.traceRequest(r, res, time.Since(started))
	return c.sendParts([]*builtPart{c.buildPart(r, res)})
}

// dropUnseenOpen closes the file a cancelled CREATE opened anyway. The client
// was told the open failed, so it would never close the handle itself.
func (c *conn) dropUnseenOpen(r *request, res *response) {
	if r.hdr.Command != wire.CmdCreate || res.status != wire.StatusOK || !r.chain.hasFile || r.sess == nil {
		return
	}
	r.sess.mu.Lock()
	o := r.sess.opens[r.chain.fileID]
	delete(r.sess.opens, r.chain.fileID)
	r.sess.mu.Unlock()
	if o != nil {
		c.closeOpen(o)
	}
}

// runChain handles a compound in order and sends its responses as one frame.
func (c *conn) runChain(parts []*part) error {
	c.mu.Lock()
	loggedIn := c.loggedIn
	c.mu.Unlock()
	if len(parts) == 1 && loggedIn && mayGoAsync[parts[0].hdr.Command] && parts[0].hdr.Flags&wire.FlagRelated == 0 {
		return c.runSingle(parts[0])
	}

	chain := &chainState{}
	out := make([]*builtPart, 0, len(parts))
	asyncs := []*asyncOp{}
	for i, p := range parts {
		r := &request{hdr: p.hdr, raw: p.raw, chain: chain, encrypted: p.encrypted, sessionID: p.sessionID}
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
	if res, err := c.authorize(r); res != nil || err != nil {
		return res, err
	}
	return c.route(r), nil
}

// authorize does everything up to the handler of a request on a tree. A nil
// response and error mean r.sess and r.tree are set and route can run.
func (c *conn) authorize(r *request) (*response, error) {
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

	if r.encrypted {
		//Encryption authenticates the message, as a signature would. The
		//header inside must belong to the session that sealed it.
		if r.hdr.SessionID != r.sessionID {
			return nil, errDrop
		}
	} else {
		//Signing cannot be skipped: an unsigned or forged request on a
		//signed session means someone is in the middle, so the connection goes
		if r.hdr.Flags&wire.FlagSigned == 0 || !sess.signer.Verify(r.raw) {
			logger.PrintAndLog(logTitle, "Bad signature from "+c.remote+", closing the connection", nil)
			return nil, errDrop
		}
		if sess.mustEncrypt() {
			//Answered signed and in the clear, the only form the sender reads
			r.sess = sess
			return &response{status: wire.StatusAccessDenied, plain: true}, nil
		}
	}
	r.sess = sess

	switch cmd {
	case wire.CmdEcho:
		return &response{body: []byte{4, 0, 0, 0}}, nil
	case wire.CmdLogoff:
		return c.handleLogoff(r), nil
	case wire.CmdTreeConnect:
		return c.handleTreeConnect(r), nil
	case wire.CmdOplockBreak:
		//A lease is the client's, not a tree's
		return c.handleLeaseAck(r), nil
	}

	t := sess.tree(r.hdr.TreeID)
	if t == nil {
		return errorResponse(wire.StatusNetworkNameDeleted), nil
	}
	r.tree = t
	return nil, nil
}

// route runs the handler of an authorized request on a tree.
func (c *conn) route(r *request) *response {
	switch r.hdr.Command {
	case wire.CmdTreeDisconnect:
		return c.handleTreeDisconnect(r)
	case wire.CmdCreate:
		return c.handleCreate(r)
	case wire.CmdClose:
		return c.handleClose(r)
	case wire.CmdFlush:
		return c.handleFlush(r)
	case wire.CmdRead:
		return c.handleRead(r)
	case wire.CmdWrite:
		return c.handleWrite(r)
	case wire.CmdLock:
		return c.handleLock(r)
	case wire.CmdIoctl:
		return c.handleIoctl(r)
	case wire.CmdQueryDirectory:
		return c.handleQueryDirectory(r)
	case wire.CmdChangeNotify:
		return c.handleChangeNotify(r)
	case wire.CmdQueryInfo:
		return c.handleQueryInfo(r)
	case wire.CmdSetInfo:
		return c.handleSetInfo(r)
	}
	return errorResponse(wire.StatusNotImplemented)
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
	buf     []byte //msg with room for the frame header in front
	msg     []byte
	sess    *session
	after   func([]byte)
	unsign  bool
	encrypt bool
}

// responseBody returns the body to send. A response without one gets the
// error body, also used for interim responses. A status of the error class can
// still carry a real body: the NTLM challenge travels under
// STATUS_MORE_PROCESSING_REQUIRED.
func responseBody(res *response) []byte {
	if res.body != nil {
		return res.body
	}
	w := wire.NewWriter(9 + len(res.errData))
	w.U16(9)
	w.U16(0)
	w.U32(uint32(len(res.errData)))
	if len(res.errData) == 0 {
		w.U8(0)
	} else {
		w.Bytes(res.errData)
	}
	return w.B
}

func (c *conn) buildPart(r *request, res *response) *builtPart {
	body := responseBody(res)

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
	//A login that just finished is answered signed: the client only starts
	//encrypting once it has the response
	encrypt := res.signAs == nil && !res.plain && sess != nil && (r.encrypted || sess.mustEncrypt())
	return &builtPart{buf: buf, msg: msg, sess: sess, after: res.after, unsign: res.status == wire.StatusPending, encrypt: encrypt}
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

	//A compound is sealed whole, so one encrypted part encrypts them all
	var sealer *session
	for _, p := range parts {
		if p.encrypt {
			sealer = p.sess
		}
	}
	for _, p := range parts {
		if p.after != nil {
			p.after(p.msg)
		}
		if sealer == nil && p.sess != nil && p.sess.signer != nil && !p.unsign {
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
	if sealer != nil {
		return c.sendSealed(sealer, frame[4:])
	}
	return c.send(frame)
}

// sendSealed encrypts a message for a session and queues it. The capture
// keeps the plain message, which is what debugging needs.
func (c *conn) sendSealed(sess *session, plain []byte) error {
	if c.srv.capture != nil {
		c.srv.capture.record(c, false, plain)
	}
	enc, _ := sess.ciphers()
	if enc == nil {
		return errDrop
	}
	sealed := enc.Seal(sess.id, plain)
	frame := make([]byte, 4+len(sealed))
	frame[1], frame[2], frame[3] = byte(len(sealed)>>16), byte(len(sealed)>>8), byte(len(sealed))
	copy(frame[4:], sealed)
	return c.queue(frame)
}

// decrypt opens a transform message of one of this connection's sessions.
func (c *conn) decrypt(sessionID uint64, frame []byte) ([]byte, error) {
	c.mu.Lock()
	sess := c.sessions[sessionID]
	c.mu.Unlock()
	if sess == nil {
		return nil, errors.New("an encrypted message for no session")
	}
	_, dec := sess.ciphers()
	if dec == nil {
		return nil, errors.New("an encrypted message on a session without encryption")
	}
	plain, err := dec.Open(frame)
	if err != nil {
		logger.PrintAndLog(logTitle, "A message from "+c.remote+" did not decrypt, closing the connection", nil)
		return nil, err
	}
	return plain, nil
}

func (c *conn) send(frame []byte) error {
	if c.srv.capture != nil {
		c.srv.capture.record(c, false, frame[4:])
	}
	return c.queue(frame)
}

// queue hands a finished frame to the writer.
func (c *conn) queue(frame []byte) error {
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
		//The connection died: durable handles wait for their client
		s.closeAllTrees(c, !c.revoked.Load())
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
