package smbserver

import (
	"encoding/binary"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	durable.go

	Durable handles (version 2). When Wi-Fi drops or a laptop sleeps, the
	TCP connection dies with files still open. A durable handle outlives
	that: the server keeps the open, its share mode and its lease for a while,
	and the client takes it back on a new connection with the same FileId, so
	Word keeps its document open instead of reporting it lost.

	Only an open with a handle caching lease is made durable, as Windows
	servers do: the lease break is how the server learns that someone else
	wants the file while its client is away, and such an open is then closed
	rather than kept in someone's way. A handle nobody comes back for is
	closed after its timeout.
*/

const (
	defaultDurableTimeout = 60 * time.Second
	maxDurableTimeout     = 5 * time.Minute
)

type durableTable struct {
	mu    sync.Mutex
	opens map[uint64]*open //By the persistent half of the FileId
}

func persistentID(id wire.FileID) uint64 { return binary.LittleEndian.Uint64(id[:8]) }

// durableRequest is SMB2_CREATE_DURABLE_HANDLE_REQUEST_V2.
type durableRequest struct {
	timeout    time.Duration
	createGUID [16]byte
}

func parseDurableRequest(data []byte) (*durableRequest, bool) {
	if len(data) != 32 {
		return nil, false
	}
	q := &durableRequest{timeout: time.Duration(binary.LittleEndian.Uint32(data)) * time.Millisecond}
	copy(q.createGUID[:], data[16:32])
	if q.timeout == 0 {
		q.timeout = defaultDurableTimeout
	}
	if q.timeout > maxDurableTimeout {
		q.timeout = maxDurableTimeout
	}
	return q, true
}

// makeDurable marks an open durable, if its lease lets the server notice
// anyone else wanting the file.
func (s *Server) makeDurable(o *open, q *durableRequest) bool {
	if o.lease == nil {
		return false
	}
	if state, _ := s.leases.grantedState(o.lease); state&leaseHandle == 0 {
		return false
	}
	o.durable = true
	o.durableTimeout = q.timeout
	o.createGUID = q.createGUID
	o.owner = o.sess.username
	s.durables.mu.Lock()
	if s.durables.opens == nil {
		s.durables.opens = map[uint64]*open{}
	}
	s.durables.opens[persistentID(o.id)] = o
	s.durables.mu.Unlock()
	return true
}

// durableContext is the DH2Q reply.
func durableContext(o *open) []byte {
	w := wire.NewWriter(8)
	w.U32(uint32(o.durableTimeout / time.Millisecond))
	w.U32(0)
	return w.B
}

// detach keeps a durable open after its connection died.
func (s *Server) detach(o *open) {
	s.durables.mu.Lock()
	o.conn = nil
	o.sess = nil //Both under this lock, read together by connOf
	o.detachCount++
	detach := o.detachCount
	o.detachTimer = time.AfterFunc(o.durableTimeout, func() {
		if !s.expireDetached(o, detach) {
			return
		}
		logger.PrintAndLog(logTitle, "Nobody came back for "+o.getPath()+", the durable handle was closed", nil)
		s.closeOpen(o)
	})
	s.durables.mu.Unlock()
}

// expireDetached removes a durable open whose time ran out from the table,
// so that no reconnect can find it any more. Stopping a timer does not stop a
// callback that has already started, so the callback asks here first: false
// means the client took the handle back in time, or it was detached again
// since and that later timer decides.
func (s *Server) expireDetached(o *open, detach uint64) bool {
	s.durables.mu.Lock()
	defer s.durables.mu.Unlock()
	if o.conn != nil || o.detachCount != detach {
		return false
	}
	if s.durables.opens[persistentID(o.id)] == o {
		delete(s.durables.opens, persistentID(o.id))
	}
	o.detachTimer = nil
	return true
}

// closeDetached closes the durable opens still waiting for their clients, as
// the server stops: nothing may stay open once Close returns. A timer that
// already fired gives up, because the detach count no longer matches.
func (s *Server) closeDetached() {
	s.durables.mu.Lock()
	list := []*open{}
	for id, o := range s.durables.opens {
		if o.conn != nil {
			continue
		}
		delete(s.durables.opens, id)
		if o.detachTimer != nil {
			o.detachTimer.Stop()
			o.detachTimer = nil
		}
		o.detachCount++
		list = append(list, o)
	}
	s.durables.mu.Unlock()
	for _, o := range list {
		s.closeOpen(o)
	}
}

// forgetDurable drops an open from the table as it closes.
func (s *Server) forgetDurable(o *open) {
	if !o.durable {
		return
	}
	s.durables.mu.Lock()
	defer s.durables.mu.Unlock()
	if s.durables.opens[persistentID(o.id)] == o {
		delete(s.durables.opens, persistentID(o.id))
	}
	if o.detachTimer != nil {
		o.detachTimer.Stop()
	}
}

// purgeDurable closes a durable open whose client is away, because someone
// else needs what its lease holds.
func (s *Server) purgeDurable(o *open) {
	if o.durable {
		logger.PrintAndLog(logTitle, "Closed the durable handle of "+o.getPath()+" while its client was away: another client needs the file", nil)
		//Out of the table now, not when the close gets to it, so a client
		//coming back meanwhile is refused instead of handed a closing file
		s.forgetDurable(o)
	}
	go s.closeOpen(o)
}

// reconnectDurable is a CREATE with DH2C: a client taking back a durable
// handle on a new connection.
func (c *conn) reconnectDurable(r *request, q *wire.CreateRequest, data []byte) *response {
	if len(data) != 36 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	var id wire.FileID
	var guid [16]byte
	copy(id[:], data[:16])
	copy(guid[:], data[16:32])

	var lq *leaseRequest
	for _, ctx := range q.Contexts {
		if ctx.Name == wire.ContextLease {
			lq, _ = parseLeaseRequest(ctx.Data, c.dialectNow())
		}
	}

	s := c.srv
	s.durables.mu.Lock()
	o := s.durables.opens[persistentID(id)]
	status := wire.StatusOK
	switch {
	case o == nil || o.id != id || o.createGUID != guid:
		status = wire.StatusObjectNameNotFound
	case o.conn != nil:
		//Still attached: the old connection has not been noticed as dead
		status = wire.StatusFileNotAvailable
	case o.owner != r.sess.username:
		status = wire.StatusAccessDenied
	case o.tree.share.Key() != r.tree.share.Key():
		status = wire.StatusObjectNameNotFound
	case o.lease != nil && (lq == nil || lq.key != o.lease.id.key || c.clientGUIDNow() != o.lease.id.client):
		status = wire.StatusObjectNameNotFound
	}
	if status != wire.StatusOK {
		s.durables.mu.Unlock()
		return errorResponse(status)
	}
	if o.detachTimer != nil {
		//A callback that already started finds the handle attached in
		//expireDetached and leaves it alone
		o.detachTimer.Stop()
		o.detachTimer = nil
	}
	o.conn = c
	o.sess = r.sess
	o.tree = r.tree
	o.encrypted = r.encrypted
	s.durables.mu.Unlock()

	sess := r.sess
	sess.mu.Lock()
	sess.opens[o.id] = o
	sess.mu.Unlock()
	r.chain.fileID = o.id
	r.chain.hasFile = true

	p := o.getPath()
	info, err := o.tree.share.Stat(p)
	if err != nil {
		return errorResponse(statusOf(err))
	}
	logger.PrintAndLog(logTitle, r.sess.username+" took back "+p+" after a lost connection", nil)
	r.traceInfo = p
	return &response{body: c.createBody(o, p, info, wire.ActionOpened, q)}
}

// dropPreviousSession ends a session the client left behind on a connection
// the server still thinks is alive, so its durable handles can be taken back.
func (c *conn) dropPreviousSession(previous uint64, username string) {
	if previous == 0 {
		return
	}
	c.srv.mu.Lock()
	conns := make([]*conn, 0, len(c.srv.conns))
	for other := range c.srv.conns {
		conns = append(conns, other)
	}
	c.srv.mu.Unlock()
	for _, other := range conns {
		other.mu.Lock()
		sess := other.sessions[previous]
		if sess != nil && sess.username == username {
			delete(other.sessions, previous)
		} else {
			sess = nil
		}
		other.mu.Unlock()
		if sess != nil {
			sess.closeAllTrees(other, true)
			return
		}
	}
}

// connOf returns the connection an open is reached through, nil while a
// durable handle waits for its client.
func (s *Server) connOf(o *open) (*conn, *session) {
	s.durables.mu.Lock()
	defer s.durables.mu.Unlock()
	return o.conn, o.sess
}

func (c *conn) dialectNow() uint16 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dialect
}

func (c *conn) clientGUIDNow() [16]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.clientGUID
}
