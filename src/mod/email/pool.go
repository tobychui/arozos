package email

/*
	pool.go

	IMAP connection pool.

	Every AGI request runs in a fresh JavaScript VM, so without a pool each
	click in the Mail app would pay a TCP + TLS handshake and a login, which is
	easily a second on a remote server. Logged-in connections are kept per
	(user, account) for a few minutes and reused.

	An IMAP connection has one selected mailbox, so a connection is lent to a
	single operation at a time; at most maxConnsPerAccount run in parallel
	(Gmail allows 15 per account, smaller providers far fewer).

	When an account's settings or credential change, its generation is
	bumped: idle connections are dropped at once and busy ones are closed
	instead of returned when their operation finishes.
*/

import (
	"context"
	"sync"
	"time"

	"github.com/emersion/go-imap/v2/imapclient"
)

const (
	maxConnsPerAccount = 3
	idleConnTimeout    = 5 * time.Minute
	healthCheckAfter   = 90 * time.Second
	acquireTimeout     = 45 * time.Second
)

type pooledConn struct {
	client     *imapclient.Client
	lastUsed   time.Time
	generation int
}

type poolSlot struct {
	semaphore  chan struct{}
	idle       []*pooledConn
	generation int
}

type connPool struct {
	mutex sync.Mutex
	slots map[string]*poolSlot
}

func newConnPool() *connPool {
	return &connPool{slots: map[string]*poolSlot{}}
}

func (p *connPool) slot(key string) *poolSlot {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	slot, ok := p.slots[key]
	if !ok {
		slot = &poolSlot{semaphore: make(chan struct{}, maxConnsPerAccount)}
		p.slots[key] = slot
	}
	return slot
}

// acquire lends a connection for key, dialling a new one with dial when no
// healthy idle connection exists. The caller must call release exactly once.
func (p *connPool) acquire(ctx context.Context, key string, dial func() (*imapclient.Client, error)) (*pooledConn, error) {
	slot := p.slot(key)

	waitCtx, cancel := context.WithTimeout(ctx, acquireTimeout)
	defer cancel()
	select {
	case slot.semaphore <- struct{}{}:
	case <-waitCtx.Done():
		return nil, waitCtx.Err()
	}

	for {
		p.mutex.Lock()
		var candidate *pooledConn
		if count := len(slot.idle); count > 0 {
			candidate = slot.idle[count-1]
			slot.idle = slot.idle[:count-1]
		}
		generation := slot.generation
		p.mutex.Unlock()

		if candidate == nil {
			break
		}
		if candidate.generation != generation || isClosed(candidate.client) {
			candidate.client.Close()
			continue
		}
		if time.Since(candidate.lastUsed) > healthCheckAfter {
			if err := candidate.client.Noop().Wait(); err != nil {
				candidate.client.Close()
				continue
			}
		}
		return candidate, nil
	}

	p.mutex.Lock()
	generation := slot.generation
	p.mutex.Unlock()

	client, err := dial()
	if err != nil {
		<-slot.semaphore
		return nil, err
	}
	return &pooledConn{client: client, lastUsed: time.Now(), generation: generation}, nil
}

// release returns a lent connection. broken connections (protocol or network
// errors) are closed rather than reused.
func (p *connPool) release(key string, conn *pooledConn, broken bool) {
	if conn == nil {
		return
	}
	slot := p.slot(key)

	p.mutex.Lock()
	keep := !broken && conn.generation == slot.generation && !isClosed(conn.client)
	if keep {
		conn.lastUsed = time.Now()
		slot.idle = append(slot.idle, conn)
	}
	p.mutex.Unlock()

	if !keep {
		go conn.client.Close()
	}
	<-slot.semaphore
}

// invalidate drops every idle connection of key and marks busy ones stale.
func (p *connPool) invalidate(key string) {
	p.mutex.Lock()
	slot, ok := p.slots[key]
	var dropped []*pooledConn
	if ok {
		slot.generation++
		dropped = slot.idle
		slot.idle = nil
	}
	p.mutex.Unlock()

	for _, conn := range dropped {
		go logoutAndClose(conn.client)
	}
}

// reap closes connections idle for longer than idleConnTimeout.
func (p *connPool) reap() {
	var expired []*pooledConn
	p.mutex.Lock()
	for _, slot := range p.slots {
		kept := slot.idle[:0]
		for _, conn := range slot.idle {
			if time.Since(conn.lastUsed) > idleConnTimeout || isClosed(conn.client) {
				expired = append(expired, conn)
			} else {
				kept = append(kept, conn)
			}
		}
		slot.idle = kept
	}
	p.mutex.Unlock()

	for _, conn := range expired {
		go logoutAndClose(conn.client)
	}
}

// closeAll shuts every idle connection down (used on manager shutdown).
func (p *connPool) closeAll() {
	p.mutex.Lock()
	var all []*pooledConn
	for _, slot := range p.slots {
		slot.generation++
		all = append(all, slot.idle...)
		slot.idle = nil
	}
	p.mutex.Unlock()
	for _, conn := range all {
		conn.client.Close()
	}
}

// idleCount is used by tests.
func (p *connPool) idleCount(key string) int {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if slot, ok := p.slots[key]; ok {
		return len(slot.idle)
	}
	return 0
}

func isClosed(client *imapclient.Client) bool {
	select {
	case <-client.Closed():
		return true
	default:
		return false
	}
}

func logoutAndClose(client *imapclient.Client) {
	done := make(chan struct{})
	go func() {
		client.Logout().Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
	client.Close()
}
