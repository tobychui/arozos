package smbserver

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/auth"
	"imuslab.com/arozos/mod/storage/smbserver/crypt"
	"imuslab.com/arozos/mod/storage/smbserver/rpc"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// baseCapabilities is what every connection is offered. Leasing stays off
// until breaks exist, because a cache grant nobody can recall is silent data
// corruption. Encryption is added per connection, when the client has it.
const baseCapabilities = wire.CapLargeMTU

// session is one login on a connection.
type session struct {
	id       uint64
	exchange *auth.Exchange
	preauth  [64]byte

	mu       sync.Mutex
	valid    bool
	since    time.Time
	signer   *crypt.Signer
	enc, dec *crypt.Cipher //Set when encryption was negotiated
	encrypt  bool          //Every message must be encrypted
	username string
	view     UserView
	trees    map[uint32]*tree
	nextTree uint32
	opens    map[wire.FileID]*open
}

// ciphers returns what the session encrypts and decrypts with, if anything.
func (s *session) ciphers() (enc, dec *crypt.Cipher) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enc, s.dec
}

// mustEncrypt reports whether unencrypted requests are refused.
func (s *session) mustEncrypt() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.encrypt
}

func (s *session) isValid() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.valid
}

func (s *session) tree(id uint32) *tree {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.trees[id]
}

func (s *session) open(id wire.FileID) *open {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opens[id]
}

// tree is one connected share.
type tree struct {
	id      uint32
	share   Share //Nil on IPC$
	maximal uint32
}

func (t *tree) isIPC() bool { return t.share == nil }

// handleSMB1 answers the SMB1 opening with an SMB2 response, which moves the
// client to SMB2. It is the only SMB1 message that does not end the connection.
func (c *conn) handleSMB1(frame []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sawSMB1 || c.negotiated {
		return errDrop
	}
	dialects, err := wire.ParseMultiProtocol(frame)
	if err != nil {
		return err
	}
	offered := false
	for _, d := range dialects {
		if d == "SMB 2.???" {
			offered = true
		}
	}
	if !offered {
		return errDrop
	}
	c.sawSMB1 = true

	//The reply used message id 0, so the client continues from 1
	c.window.low, c.window.high = 1, 2

	h := wire.Header{Command: wire.CmdNegotiate, Flags: wire.FlagResponse, Credits: 1}
	msg := make([]byte, wire.HeaderSize)
	h.Put(msg)
	msg = append(msg, c.negotiateBody(wire.DialectWildcard, baseCapabilities, nil)...)
	return c.sendLocked(msg)
}

func (c *conn) sendLocked(msg []byte) error {
	frame := make([]byte, 4+len(msg))
	frame[1], frame[2], frame[3] = byte(len(msg)>>16), byte(len(msg)>>8), byte(len(msg))
	copy(frame[4:], msg)
	return c.send(frame)
}

func (c *conn) negotiateBody(dialect uint16, caps uint32, contexts [][]byte) []byte {
	token := auth.NegotiateToken()
	cfg := &c.srv.cfg

	const fixed = 64
	w := wire.NewWriter(fixed + len(token) + 128)
	w.U16(65)
	w.U16(wire.SigningEnabled | wire.SigningRequired)
	w.U16(dialect)
	w.U16(uint16(len(contexts)))
	w.Bytes(cfg.GUID[:])
	w.U32(caps)
	w.U32(maxTransact)
	w.U32(maxTransact)
	w.U32(maxTransact)
	w.U64(wire.Filetime(time.Now()))
	w.U64(0) //Server start time, not reported
	w.U16(wire.HeaderSize + fixed)
	w.U16(uint16(len(token)))
	ctxOffsetAt := w.Len()
	w.U32(0)
	w.Bytes(token)

	if len(contexts) > 0 {
		//Offsets count from the start of the header, which is 8 byte aligned
		for (wire.HeaderSize+w.Len())%8 != 0 {
			w.U8(0)
		}
		binary.LittleEndian.PutUint32(w.B[ctxOffsetAt:], uint32(wire.HeaderSize+w.Len()))
		for i, ctx := range contexts {
			if i > 0 {
				w.Align(8)
			}
			w.Bytes(ctx)
		}
	}
	return w.B
}

func negotiateContext(kind uint16, data []byte) []byte {
	w := wire.NewWriter(8 + len(data))
	w.U16(kind)
	w.U16(uint16(len(data)))
	w.U32(0)
	w.Bytes(data)
	return w.B
}

func pickDialect(offered []uint16) uint16 {
	best := uint16(0)
	for _, d := range offered {
		switch d {
		case wire.Dialect210, wire.Dialect300, wire.Dialect302, wire.Dialect311:
			if d > best {
				best = d
			}
		}
	}
	return best
}

func (c *conn) handleNegotiate(r *request) (*response, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.negotiated {
		return nil, errDrop
	}
	q, err := wire.ParseNegotiate(r.raw)
	if err != nil {
		return nil, err
	}
	dialect := pickDialect(q.Dialects)
	if dialect == 0 {
		return errorResponse(wire.StatusNotSupported), nil
	}

	c.clientGUID = q.ClientGUID
	c.clientCaps = q.Capabilities
	c.clientMode = q.SecurityMode
	c.signAlgo = wire.SigningHMACSHA256
	if dialect >= wire.Dialect300 {
		c.signAlgo = wire.SigningAESCMAC
	}

	var contexts [][]byte
	var after func(raw []byte)
	caps := baseCapabilities
	if !c.srv.cfg.NoLeases {
		caps |= wire.CapLeasing
	}
	c.cipher = 0
	if (dialect == wire.Dialect300 || dialect == wire.Dialect302) && q.Capabilities&wire.CapEncryption != 0 {
		//3.0 has one cipher, and says so with a capability
		caps |= wire.CapEncryption
		c.cipher = crypt.CipherAES128CCM
	}
	if dialect == wire.Dialect311 {
		sawSHA512 := false
		for _, ctx := range q.Contexts {
			switch ctx.Type {
			case wire.CtxPreauthIntegrity:
				hashes, ok := wire.PreauthHashes(ctx.Data)
				if !ok {
					return errorResponse(wire.StatusInvalidParameter), nil
				}
				for _, h := range hashes {
					sawSHA512 = sawSHA512 || h == wire.HashSHA512
				}
			}
		}
		if !sawSHA512 {
			return errorResponse(wire.StatusInvalidParameter), nil
		}

		salt := make([]byte, 32)
		if _, err := rand.Read(salt); err != nil {
			return nil, err
		}
		preauth := wire.NewWriter(38)
		preauth.U16(1)
		preauth.U16(uint16(len(salt)))
		preauth.U16(wire.HashSHA512)
		preauth.Bytes(salt)
		contexts = append(contexts, negotiateContext(wire.CtxPreauthIntegrity, preauth.B))

		for _, ctx := range q.Contexts {
			if ctx.Type != wire.CtxSigning {
				continue
			}
			algorithms, ok := wire.SigningAlgorithms(ctx.Data)
			if !ok {
				return errorResponse(wire.StatusInvalidParameter), nil
			}
			c.signAlgo = pickSigning(algorithms)
			w := wire.NewWriter(4)
			w.U16(1)
			w.U16(c.signAlgo)
			contexts = append(contexts, negotiateContext(wire.CtxSigning, w.B))
		}

		for _, ctx := range q.Contexts {
			if ctx.Type != wire.CtxEncryption {
				continue
			}
			ciphers, ok := wire.SigningAlgorithms(ctx.Data) //The same list layout
			if !ok {
				return errorResponse(wire.StatusInvalidParameter), nil
			}
			//Zero answers "none in common", and the session stays plain
			c.cipher = pickCipher(ciphers)
			w := wire.NewWriter(4)
			w.U16(1)
			w.U16(c.cipher)
			contexts = append(contexts, negotiateContext(wire.CtxEncryption, w.B))
		}

		c.preauth = crypt.PreauthHash([64]byte{}, r.raw)
		after = func(raw []byte) {
			c.mu.Lock()
			c.preauth = crypt.PreauthHash(c.preauth, raw)
			c.mu.Unlock()
		}
	}

	c.dialect = dialect
	c.negotiated = true
	c.serverCaps = caps
	return &response{body: c.negotiateBody(dialect, caps, contexts), after: after}, nil
}

// pickCipher takes GCM over CCM, as it is much faster, and 128 bit keys over
// 256, as Windows and Samba do by default.
func pickCipher(offered []uint16) uint16 {
	for _, want := range []uint16{crypt.CipherAES128GCM, crypt.CipherAES256GCM, crypt.CipherAES128CCM, crypt.CipherAES256CCM} {
		for _, o := range offered {
			if o == want {
				return want
			}
		}
	}
	return 0
}

// pickSigning prefers GMAC, by far the fastest of the three.
func pickSigning(offered []uint16) uint16 {
	best := wire.SigningAESCMAC
	for _, a := range offered {
		if a == wire.SigningAESGMAC {
			return a
		}
	}
	return best
}

func randomSessionID() (uint64, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, err
	}
	id := binary.LittleEndian.Uint64(b[:]) &^ (1 << 63)
	if id == 0 {
		id = 1
	}
	return id, nil
}

func (c *conn) handleSessionSetup(r *request) (*response, error) {
	c.mu.Lock()
	negotiated := c.negotiated
	dialect := c.dialect
	c.mu.Unlock()
	if !negotiated {
		return nil, errDrop
	}

	q, err := wire.ParseSessionSetup(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter), nil
	}
	if q.Flags&0x01 != 0 {
		//Binding a session to a second channel is multichannel, not offered
		return errorResponse(wire.StatusRequestNotAccepted), nil
	}

	sess, res, err := c.sessionFor(r)
	if sess == nil {
		return res, err
	}
	r.hdr.SessionID = sess.id

	if dialect == wire.Dialect311 {
		sess.preauth = crypt.PreauthHash(sess.preauth, r.raw)
	}

	token, done, err := sess.exchange.Step(q.Token)
	if err != nil {
		return c.loginFailed(sess, err), nil
	}
	if !done {
		return &response{
			status: wire.StatusMoreProcessingRequired,
			body:   sessionSetupBody(token, 0),
			after: func(raw []byte) {
				if dialect == wire.Dialect311 {
					sess.preauth = crypt.PreauthHash(sess.preauth, raw)
				}
			},
		}, nil
	}

	username := sess.exchange.Username()
	sessionKey := sess.exchange.SessionKey()
	view, err := c.srv.cfg.Backend.Login(username)
	if err != nil {
		return c.loginFailed(sess, err), nil
	}
	c.mu.Lock()
	algorithm := c.signAlgo
	cipherID := c.cipher
	c.mu.Unlock()
	signer, err := crypt.NewSigner(algorithm, crypt.SigningKey(dialect, sessionKey, sess.preauth))
	if err != nil {
		return nil, err
	}
	var enc, dec *crypt.Cipher
	if cipherID != 0 {
		out, in := crypt.EncryptionKeys(dialect, cipherID, sessionKey, sess.preauth)
		if enc, err = crypt.NewCipher(cipherID, out); err != nil {
			return nil, err
		}
		if dec, err = crypt.NewCipher(cipherID, in); err != nil {
			return nil, err
		}
	}
	var flags uint16
	if c.srv.cfg.RequireEncryption {
		if enc == nil {
			//SMB 2.1, or a client with encryption turned off
			logger.PrintAndLog(logTitle, username+" from "+c.remote+" was refused: this server requires encryption, which the client does not offer", nil)
			c.mu.Lock()
			delete(c.sessions, sess.id)
			c.mu.Unlock()
			return errorResponse(wire.StatusAccessDenied), nil
		}
		flags |= wire.SessionFlagEncryptData
	}

	sess.mu.Lock()
	sess.valid = true
	sess.since = time.Now()
	sess.signer = signer
	sess.enc, sess.dec = enc, dec
	sess.encrypt = flags&wire.SessionFlagEncryptData != 0
	sess.username = username
	sess.view = view
	sess.mu.Unlock()

	c.mu.Lock()
	first := !c.loggedIn
	c.loggedIn = true
	c.mu.Unlock()
	if first {
		//No idle limit once logged in: Explorer holds a quiet connection for
		//as long as a window is open
		c.nc.SetReadDeadline(time.Time{})
	}

	c.srv.cfg.Backend.AuthLog(username, c.nc.RemoteAddr().String(), true)
	logger.PrintAndLog(logTitle, username+" logged in from "+c.remote, nil)
	//A client back after a lost connection names the session it had, which
	//this server may not have noticed is dead
	c.dropPreviousSession(q.PreviousSessionID, username)
	return &response{body: sessionSetupBody(token, flags), signAs: sess}, nil
}

// sessionFor finds or starts the session of a SESSION_SETUP. A nil session
// means the response is already decided.
func (c *conn) sessionFor(r *request) (*session, *response, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if r.hdr.SessionID != 0 {
		sess := c.sessions[r.hdr.SessionID]
		if sess == nil {
			return nil, errorResponse(wire.StatusUserSessionDeleted), nil
		}
		if sess.isValid() {
			//Re-authentication is not needed for NTLM, and a client asking
			//for it just logs in on a new session
			return nil, errorResponse(wire.StatusRequestNotAccepted), nil
		}
		return sess, nil, nil
	}

	if len(c.sessions) >= maxSessions {
		return nil, errorResponse(wire.StatusInsufficientResources), nil
	}
	id, err := randomSessionID()
	if err != nil {
		return nil, nil, err
	}
	cfg := &c.srv.cfg
	exchange, err := auth.NewExchange(auth.Identity{
		NetbiosName: cfg.ServerName,
		NetbiosDom:  cfg.ServerName,
		DNSName:     cfg.DNSName,
		DNSDomain:   cfg.DNSDomain,
	}, cfg.Backend.LookupHash)
	if err != nil {
		return nil, nil, err
	}
	sess := &session{
		id:       id,
		exchange: exchange,
		preauth:  c.preauth,
		trees:    map[uint32]*tree{},
		opens:    map[wire.FileID]*open{},
		nextTree: 1,
	}
	c.sessions[id] = sess
	return sess, nil, nil
}

func (c *conn) loginFailed(sess *session, err error) *response {
	c.mu.Lock()
	delete(c.sessions, sess.id)
	c.mu.Unlock()

	//Only a token that could not be read is the client's fault. Anything else,
	//such as an account that no longer exists, is a failed login.
	status := uint32(wire.StatusLogonFailure)
	if errors.Is(err, auth.ErrBadToken) {
		status = wire.StatusInvalidParameter
	}
	attempted := sess.exchange.AttemptedUser()
	delay := c.srv.cfg.Backend.AuthLog(attempted, c.nc.RemoteAddr().String(), false)
	if delay < c.srv.cfg.LoginDelay {
		delay = c.srv.cfg.LoginDelay
	}
	logger.PrintAndLog(logTitle, "Failed login for "+strconv.Quote(attempted)+" from "+c.remote, nil)

	//The delay runs on this connection only, and slows password guessing
	select {
	case <-time.After(delay):
	case <-c.done:
	}
	return errorResponse(status)
}

func sessionSetupBody(token []byte, flags uint16) []byte {
	w := wire.NewWriter(8 + len(token))
	w.U16(9)
	w.U16(flags)
	w.U16(wire.HeaderSize + 8)
	w.U16(uint16(len(token)))
	w.Bytes(token)
	return w.B
}

func (c *conn) handleLogoff(r *request) *response {
	sess := r.sess
	c.mu.Lock()
	delete(c.sessions, sess.id)
	c.mu.Unlock()
	sess.closeAllTrees(c, false)
	return &response{body: []byte{4, 0, 0, 0}}
}

func (c *conn) handleTreeConnect(r *request) *response {
	path, err := wire.ParseTreeConnect(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	name := path
	if i := strings.LastIndexByte(path, '\\'); i >= 0 {
		name = path[i+1:]
	}
	r.traceInfo = name

	t := &tree{}
	shareType := wire.ShareTypeDisk
	if strings.EqualFold(name, "IPC$") {
		shareType = wire.ShareTypePipe
		t.maximal = 0x001F00A9
	} else {
		for _, s := range r.sess.view.Shares() {
			if strings.EqualFold(s.Name(), name) {
				t.share = s
				break
			}
		}
		if t.share == nil {
			return errorResponse(wire.StatusBadNetworkName)
		}
		if !t.share.CanRead("") {
			return errorResponse(wire.StatusAccessDenied)
		}
		t.maximal = maximalAccess(t.share, "")
	}

	sess := r.sess
	sess.mu.Lock()
	t.id = sess.nextTree
	sess.nextTree++
	sess.trees[t.id] = t
	sess.mu.Unlock()
	r.hdr.TreeID = t.id

	w := wire.NewWriter(16)
	w.U16(16)
	w.U8(shareType)
	w.U8(0)
	w.U32(0) //Share flags: clients may cache by hand only
	w.U32(0) //Share capabilities
	w.U32(t.maximal)
	return &response{body: w.B}
}

func (c *conn) handleTreeDisconnect(r *request) *response {
	sess := r.sess
	sess.mu.Lock()
	delete(sess.trees, r.tree.id)
	sess.mu.Unlock()
	sess.closeOpensOf(c, r.tree)
	return &response{body: []byte{4, 0, 0, 0}}
}

// closeAllTrees ends a session. keepDurable is for a connection that died:
// its durable handles are kept for their client to take back.
func (s *session) closeAllTrees(c *conn, keepDurable bool) {
	s.mu.Lock()
	list := make([]*open, 0, len(s.opens))
	for _, o := range s.opens {
		list = append(list, o)
	}
	s.opens = map[wire.FileID]*open{}
	s.trees = map[uint32]*tree{}
	s.valid = false
	s.mu.Unlock()
	for _, o := range list {
		if keepDurable && o.durable {
			c.srv.resume.drop(o)
			c.srv.detach(o)
			continue
		}
		c.closeOpen(o)
	}
}

func (s *session) closeOpensOf(c *conn, t *tree) {
	s.mu.Lock()
	list := []*open{}
	for id, o := range s.opens {
		if o.tree == t {
			list = append(list, o)
			delete(s.opens, id)
		}
	}
	s.mu.Unlock()
	for _, o := range list {
		c.closeOpen(o)
	}
}

// rpcEnv describes this server and user to a named pipe.
func (c *conn) rpcEnv(sess *session) *rpc.Env {
	cfg := &c.srv.cfg
	return &rpc.Env{
		ServerName: cfg.ServerName,
		Workgroup:  cfg.Workgroup,
		MachineSID: c.srv.machineSID,
		Username:   sess.username,
		UserSID:    wire.UserSID(c.srv.machineSID, sess.username),
		Shares: func() []rpc.ShareEntry {
			out := []rpc.ShareEntry{}
			for _, s := range sess.view.Shares() {
				out = append(out, rpc.ShareEntry{Name: s.Name(), Comment: s.Comment(), Type: rpc.TypeDisk})
			}
			return append(out, rpc.ShareEntry{Name: "IPC$", Comment: "IPC Service", Type: rpc.TypeIPC})
		},
	}
}
