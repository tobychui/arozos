package smbserver

import (
	"encoding/binary"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	lease.go

	SMB2 leases. A lease lets a client cache what it read (R), keep handles
	open after the program closed them (H) and hold back writes (W). Each
	grant is a promise that the server takes it back, with a break, before
	anything makes the cache wrong:

	- a new open by anyone else breaks W, and H too when the cached handles
	  would refuse the open by their share mode, and everything when the open
	  overwrites the file;
	- a write by anyone else breaks R;
	- renaming or deleting the file breaks H, so cached handles get closed.

	Breaks that take W or H away wait for the holder to answer (it may have
	data to write first, or handles to close), at most leaseBreakTimeout.
	Breaks of R alone do not wait.

	Changes made around the server, through the File Manager or on the
	host, cannot be broken in advance. A validator lists the size and time of
	every file with an R lease every few seconds and breaks the lease when
	they changed without this server doing it. Leases are only granted on
	drives that are cheap to check that way, the local ones.
*/

const (
	leaseRead   uint32 = 0x01
	leaseHandle uint32 = 0x02
	leaseWrite  uint32 = 0x04

	leaseBreakAckRequired    uint32 = 0x01
	leaseFlagBreakInProgress uint32 = 0x02
	leaseFlagParentKeySet    uint32 = 0x04

	oplockLevelLease uint8 = 0xFF

	defaultLeaseBreakTimeout = 35 * time.Second
	defaultLeasePoll         = 3 * time.Second
)

type leaseID struct{ client, key [16]byte }

type leaseRequest struct {
	key       [16]byte
	state     uint32
	flags     uint32
	parent    [16]byte
	epoch     uint16
	v2        bool
	hasParent bool
}

// parseLeaseRequest reads SMB2_CREATE_REQUEST_LEASE, or its V2 form.
func parseLeaseRequest(data []byte, dialect uint16) (*leaseRequest, bool) {
	if len(data) != 32 && len(data) != 52 {
		return nil, false
	}
	q := &leaseRequest{}
	copy(q.key[:], data[:16])
	q.state = binary.LittleEndian.Uint32(data[16:])
	q.flags = binary.LittleEndian.Uint32(data[20:])
	if len(data) == 52 && dialect >= wire.Dialect300 {
		q.v2 = true
		copy(q.parent[:], data[32:48])
		q.epoch = binary.LittleEndian.Uint16(data[48:])
		q.hasParent = q.flags&leaseFlagParentKeySet != 0
	}
	return q, true
}

type lease struct {
	id        leaseID
	file      string //State table key
	share     Share
	path      string
	v2        bool
	parent    [16]byte
	hasParent bool
	state     uint32
	epoch     uint16
	opens     map[*open]struct{}

	breaking bool
	breakTo  uint32
	done     chan struct{} //Closed when the break ends
	again    bool          //Break to none once this break ends

	//What the validator saw last
	size  int64
	mod   time.Time
	own   bool //This server changed the file since
	check bool //The drive can be listed often
}

// leases holds every lease of a server.
type leases struct {
	mu      sync.Mutex
	srv     *Server
	byID    map[leaseID]*lease
	byFile  map[string]map[*lease]struct{}
	started bool
	stop    chan struct{}
}

func (ls *leases) init(srv *Server) {
	ls.srv = srv
	ls.byID = map[leaseID]*lease{}
	ls.byFile = map[string]map[*lease]struct{}{}
	ls.stop = make(chan struct{})
}

func (ls *leases) close() {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	select {
	case <-ls.stop:
	default:
		close(ls.stop)
	}
}

// usedElsewhere reports a lease key the client already uses on another
// file, which the protocol forbids.
func (ls *leases) usedElsewhere(id leaseID, file string) bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	l := ls.byID[id]
	return l != nil && l.file != file
}

// grant gives an open the lease it asked for, or as much of it as is safe.
func (ls *leases) grant(o *open, client [16]byte, q *leaseRequest, info FileInfo, check bool) {
	id := leaseID{client, q.key}
	want := q.state & (leaseRead | leaseHandle | leaseWrite)
	if want&leaseRead == 0 {
		//Handle or write caching without read caching is no file lease
		want = 0
	}

	ls.mu.Lock()
	l := ls.byID[id]
	mine := map[*open]bool{}
	if l != nil {
		for op := range l.opens {
			mine[op] = true
		}
	}
	others := false
	for _, h := range o.handle.Peers() {
		owner, _ := h.Owner().(*open)
		if owner == nil || !mine[owner] {
			others = true
		}
	}
	if others {
		//Writes can only be held back while nobody else has the file open
		want &^= leaseWrite
	}

	var flags uint32
	switch {
	case l == nil:
		l = &lease{
			id: id, file: o.handle.Key(), share: o.tree.share, path: o.getPath(),
			v2: q.v2, parent: q.parent, hasParent: q.hasParent,
			state: want, epoch: q.epoch + 1, opens: map[*open]struct{}{},
			size: info.Size, mod: info.ModTime, check: check,
		}
		ls.byID[id] = l
		set := ls.byFile[l.file]
		if set == nil {
			set = map[*lease]struct{}{}
			ls.byFile[l.file] = set
		}
		set[l] = struct{}{}
	case l.breaking:
		flags |= leaseFlagBreakInProgress
	default:
		if up := l.state | want; up != l.state {
			l.state = up
			l.epoch++
		}
	}
	l.opens[o] = struct{}{}
	o.lease = l
	o.leaseFlags = flags
	start := check && !ls.started && ls.srv.cfg.LeasePoll > 0
	if start {
		ls.started = true
	}
	ls.mu.Unlock()

	if start {
		ls.srv.wg.Add(1)
		go ls.validate()
	}
}

// grantedState is what a CREATE response reports.
func (ls *leases) grantedState(l *lease) (uint32, uint16) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return l.state, l.epoch
}

// release takes an open off its lease. A lease without opens is gone, and a
// break it was in ends with it.
func (ls *leases) release(o *open) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	l := o.lease
	if l == nil {
		return
	}
	o.lease = nil
	delete(l.opens, o)
	if len(l.opens) > 0 {
		return
	}
	delete(ls.byID, l.id)
	if set := ls.byFile[l.file]; set != nil {
		delete(set, l)
		if len(set) == 0 {
			delete(ls.byFile, l.file)
		}
	}
	if l.breaking {
		l.breaking = false
		close(l.done)
	}
}

// breakNotice is a break to send once the table is unlocked.
type breakNotice struct {
	l             *lease
	current, next uint32
	epoch         uint16
	ack           bool
}

// startBreak begins taking a lease down to next. The caller holds ls.mu.
func (ls *leases) startBreakLocked(l *lease, next uint32) *breakNotice {
	if next == l.state {
		return nil
	}
	n := &breakNotice{l: l, current: l.state, next: next}
	if l.v2 {
		l.epoch++
		n.epoch = l.epoch
	}
	//Only write and handle caching have something to give back first
	if l.state&(leaseWrite|leaseHandle) != 0 {
		n.ack = true
		l.breaking = true
		l.breakTo = next
		done := make(chan struct{})
		l.done = done
		timeout := ls.srv.cfg.LeaseBreakTimeout
		time.AfterFunc(timeout, func() { ls.timedOut(l, done) })
	} else {
		l.state = next
	}
	return n
}

func (ls *leases) timedOut(l *lease, done chan struct{}) {
	ls.mu.Lock()
	if !l.breaking || l.done != done {
		ls.mu.Unlock()
		return
	}
	logger.PrintAndLog(logTitle, "A client did not answer a lease break on "+l.path+" in time, the lease was taken back", nil)
	l.state = l.breakTo
	l.breaking = false
	close(done)
	notices := ls.followUpLocked(l)
	ls.mu.Unlock()
	ls.send(notices)
}

// followUpLocked starts the break to none that a write asked for during
// another break.
func (ls *leases) followUpLocked(l *lease) []*breakNotice {
	if !l.again {
		return nil
	}
	l.again = false
	if n := ls.startBreakLocked(l, 0); n != nil {
		return []*breakNotice{n}
	}
	return nil
}

// breakWhere starts a break on every other lease of a file that target asks
// to lower, and returns what to wait for.
func (ls *leases) breakWhere(file string, mine *leaseID, target func(*lease) uint32) []chan struct{} {
	ls.mu.Lock()
	waits := []chan struct{}{}
	notices := []*breakNotice{}
	for l := range ls.byFile[file] {
		if mine != nil && l.id == *mine {
			continue
		}
		if l.breaking {
			//Let the break running finish, then look again
			waits = append(waits, l.done)
			continue
		}
		if n := ls.startBreakLocked(l, target(l)); n != nil {
			notices = append(notices, n)
			if n.ack {
				waits = append(waits, l.done)
			}
		}
	}
	ls.mu.Unlock()
	ls.send(notices)
	return waits
}

// wait blocks until the breaks ended, the deadline passed or the connection
// went away.
func (c *conn) waitBreaks(waits []chan struct{}, deadline time.Time) {
	for _, w := range waits {
		left := time.Until(deadline)
		if left <= 0 {
			return
		}
		timer := time.NewTimer(left)
		select {
		case <-w:
		case <-timer.C:
		case <-c.done:
		}
		timer.Stop()
	}
}

// breakForOpen makes room for a new open of a file: other clients stop
// holding back writes, close cached handles that would refuse the open, and
// drop everything if the open overwrites the file.
func (c *conn) breakForOpen(file string, mine *leaseID, access, share uint32, overwrite bool) {
	ls := &c.srv.leases
	deadline := time.Now().Add(c.srv.cfg.LeaseBreakTimeout + time.Second)
	for round := 0; round < 4; round++ {
		waits := ls.breakWhere(file, mine, func(l *lease) uint32 {
			if overwrite {
				return 0
			}
			next := l.state &^ leaseWrite
			if l.state&leaseHandle != 0 {
				for op := range l.opens {
					if op.handle.WouldConflict(access, share) {
						next &^= leaseHandle
						break
					}
				}
			}
			return next
		})
		if len(waits) == 0 {
			return
		}
		c.waitBreaks(waits, deadline)
	}
}

// breakHandles closes cached handles before a rename or delete.
func (c *conn) breakHandles(file string, mine *lease) {
	var id *leaseID
	if mine != nil {
		id = &mine.id
	}
	waits := c.srv.leases.breakWhere(file, id, func(l *lease) uint32 { return l.state &^ leaseHandle })
	c.waitBreaks(waits, time.Now().Add(c.srv.cfg.LeaseBreakTimeout+time.Second))
}

// breakForWrite takes read caching away from everyone else. It does not
// wait: the data in their caches is simply out of date now.
func (ls *leases) breakForWrite(file string, writer *lease) {
	ls.mu.Lock()
	notices := []*breakNotice{}
	for l := range ls.byFile[file] {
		l.own = true
		if l == writer || l.state&leaseRead == 0 {
			continue
		}
		if l.breaking {
			l.again = true
			continue
		}
		if n := ls.startBreakLocked(l, 0); n != nil {
			notices = append(notices, n)
		}
	}
	ls.mu.Unlock()
	ls.send(notices)
}

// touched notes a change this server made, so the validator does not take
// it for one made around it.
func (ls *leases) touched(file string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	for l := range ls.byFile[file] {
		l.own = true
	}
}

// renamed moves the leases of a file to its new name.
func (ls *leases) renamed(oldFile, newFile, newPath string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	set := ls.byFile[oldFile]
	if set == nil || oldFile == newFile {
		for l := range set {
			l.path = newPath
		}
		return
	}
	delete(ls.byFile, oldFile)
	target := ls.byFile[newFile]
	if target == nil {
		target = map[*lease]struct{}{}
		ls.byFile[newFile] = target
	}
	for l := range set {
		l.file, l.path, l.own = newFile, newPath, true
		target[l] = struct{}{}
	}
}

// ack is a client giving a lease back.
func (ls *leases) ack(id leaseID, state uint32) (*lease, uint32) {
	ls.mu.Lock()
	l := ls.byID[id]
	if l == nil {
		ls.mu.Unlock()
		return nil, wire.StatusObjectNameNotFound
	}
	if !l.breaking {
		ls.mu.Unlock()
		return nil, wire.StatusUnsuccessful
	}
	if state&^l.breakTo != 0 {
		ls.mu.Unlock()
		return nil, wire.StatusRequestNotAccepted
	}
	l.state = state
	l.breaking = false
	close(l.done)
	notices := ls.followUpLocked(l)
	ls.mu.Unlock()
	//The answer to the ack goes first, then any further break
	go func() {
		time.Sleep(10 * time.Millisecond)
		ls.send(notices)
	}()
	return l, wire.StatusOK
}

// send delivers break notifications. A lease nobody is connected to any more,
// a durable handle waiting for its client, is closed instead.
func (ls *leases) send(notices []*breakNotice) {
	for _, n := range notices {
		var target *open
		var via *conn
		var sess *session
		ls.mu.Lock()
		for op := range n.l.opens {
			if c, s := ls.srv.connOf(op); c != nil {
				target, via, sess = op, c, s
				break
			}
		}
		orphans := []*open{}
		if target == nil {
			for op := range n.l.opens {
				orphans = append(orphans, op)
			}
		}
		ls.mu.Unlock()

		if target == nil {
			for _, op := range orphans {
				ls.srv.purgeDurable(op)
			}
			continue
		}
		if err := via.sendLeaseBreak(target, sess, n); err != nil {
			logger.PrintAndLog(logTitle, "Could not send a lease break for "+n.l.path, err)
		}
	}
}

// sendLeaseBreak writes an SMB2 Lease Break Notification. It has no session
// in its header, so it is not signed; on an encrypted session it is sealed.
func (c *conn) sendLeaseBreak(o *open, sess *session, n *breakNotice) error {
	h := wire.Header{
		Command:   wire.CmdOplockBreak,
		Flags:     wire.FlagResponse,
		MessageID: ^uint64(0),
	}
	w := wire.NewWriter(44)
	w.U16(44)
	w.U16(n.epoch)
	if n.ack {
		w.U32(leaseBreakAckRequired)
	} else {
		w.U32(0)
	}
	w.Bytes(n.l.id.key[:])
	w.U32(n.current)
	w.U32(n.next)
	w.U32(0) //Reason
	w.U32(0) //Access mask hint
	w.U32(0) //Share mask hint
	msg := make([]byte, wire.HeaderSize+len(w.B))
	h.Put(msg)
	copy(msg[wire.HeaderSize:], w.B)
	c.trace("lease break %s %x -> %x ack=%v", n.l.path, n.current, n.next, n.ack)

	if sess != nil {
		if enc, _ := sess.ciphers(); enc != nil && (sess.mustEncrypt() || o.encrypted) {
			return c.sendSealed(sess, msg)
		}
	}
	frame := make([]byte, 4+len(msg))
	frame[1], frame[2], frame[3] = byte(len(msg)>>16), byte(len(msg)>>8), byte(len(msg))
	copy(frame[4:], msg)
	return c.send(frame)
}

// handleLeaseAck is OPLOCK_BREAK from the client: the answer to a break.
func (c *conn) handleLeaseAck(r *request) *response {
	b := r.raw[wire.HeaderSize:]
	if len(b) < 2 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if binary.LittleEndian.Uint16(b) != 36 || len(b) < 36 {
		//An oplock acknowledgment: no oplock is ever granted
		return errorResponse(wire.StatusInvalidOplockProtocol)
	}
	var id leaseID
	c.mu.Lock()
	id.client = c.clientGUID
	c.mu.Unlock()
	copy(id.key[:], b[8:24])
	state := binary.LittleEndian.Uint32(b[24:])
	if _, st := c.srv.leases.ack(id, state); st != wire.StatusOK {
		return errorResponse(st)
	}
	w := wire.NewWriter(36)
	w.U16(36)
	w.U16(0)
	w.U32(0)
	w.Bytes(id.key[:])
	w.U32(state)
	w.U64(0)
	return &response{body: w.B}
}

// leaseContext is the RqLs reply of a CREATE.
func (c *conn) leaseContext(o *open) []byte {
	l := o.lease
	state, epoch := c.srv.leases.grantedState(l)
	size := 32
	if l.v2 {
		size = 52
	}
	w := wire.NewWriter(size)
	w.Bytes(l.id.key[:])
	w.U32(state)
	flags := o.leaseFlags
	if l.v2 && l.hasParent {
		flags |= leaseFlagParentKeySet
	}
	w.U32(flags)
	w.U64(0)
	if l.v2 {
		w.Bytes(l.parent[:])
		w.U16(epoch)
		w.U16(0)
	}
	return w.B
}

// validate breaks leases of files that changed around the server.
func (ls *leases) validate() {
	defer ls.srv.wg.Done()
	ticker := time.NewTicker(ls.srv.cfg.LeasePoll)
	defer ticker.Stop()
	for {
		select {
		case <-ls.stop:
			return
		case <-ticker.C:
		}
		type probe struct {
			l     *lease
			share Share
			path  string
		}
		ls.mu.Lock()
		probes := []probe{}
		for _, l := range ls.byID {
			if l.check && l.state&leaseRead != 0 {
				probes = append(probes, probe{l, l.share, l.path})
			}
		}
		ls.mu.Unlock()

		notices := []*breakNotice{}
		for _, p := range probes {
			info, err := p.share.Stat(p.path)
			ls.mu.Lock()
			l := p.l
			if ls.byID[l.id] != l {
				ls.mu.Unlock()
				continue
			}
			changed := err != nil || info.Size != l.size || !info.ModTime.Equal(l.mod)
			if err == nil {
				l.size, l.mod = info.Size, info.ModTime
			}
			if l.own {
				l.own = false
			} else if changed && !l.breaking {
				if n := ls.startBreakLocked(l, 0); n != nil {
					notices = append(notices, n)
				}
			}
			ls.mu.Unlock()
		}
		ls.send(notices)
	}
}
