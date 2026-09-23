package metadata

/*
	Write-behind persistence for the metadata store.

	The store keeps everything it serves in memory; the disk copy exists so
	a node can restart without a full resync. Writing that copy inline, one
	synced transaction per change while holding the store lock, made every
	reader and writer queue behind the disk. Under a burst the lease renewal
	waited long enough for the leader to lose its lease, and the node never
	caught up.

	So a change now updates memory and queues its disk write here. Queued
	writes are coalesced per key (only the newest value of a key is written)
	and a background writer commits the whole queue in one transaction every
	FlushInterval. Close flushes what is left.

	A crash can lose the last FlushInterval of changes from this node's disk
	copy. That copy is not authoritative: the replicated log and snapshots
	bring a restarted node back up to date, exactly as they do for a node
	that was offline.
*/

import (
	"encoding/json"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

// FlushInterval is how often queued writes reach the disk.
var FlushInterval = 50 * time.Millisecond

type opKey struct{ table, key string }

type persister struct {
	db       *database.Database
	interval time.Duration //FlushInterval when the persister was made

	mu      sync.Mutex
	queue   map[opKey]database.BatchOp
	stopped bool

	flushMu sync.Mutex //one commit at a time, so older values never land last
	once    sync.Once  //close or discard, whichever comes first
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
}

func newPersister(db *database.Database) *persister {
	p := &persister{
		db:       db,
		interval: FlushInterval,
		queue:    map[opKey]database.BatchOp{},
		wake:     make(chan struct{}, 1),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
	go p.loop()
	return p
}

// put queues a write. The value is marshalled now, so the caller may keep
// changing its own copy after put returns.
func (p *persister) put(table string, key string, value interface{}) {
	js, err := json.Marshal(value)
	if err != nil {
		logger.PrintAndLog("Cluster", "Metadata "+table+"/"+key+" could not be encoded", err)
		return
	}
	p.enqueue(database.BatchOp{Table: table, Key: key, Value: json.RawMessage(js)})
}

// del queues a removal.
func (p *persister) del(table string, key string) {
	p.enqueue(database.BatchOp{Table: table, Key: key, Delete: true})
}

func (p *persister) enqueue(op database.BatchOp) {
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return
	}
	p.queue[opKey{op.Table, op.Key}] = op //newest change of a key wins
	p.mu.Unlock()
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (p *persister) loop() {
	defer close(p.done)
	for {
		select {
		case <-p.stop:
			return
		case <-p.wake:
		}
		//Let a burst gather so it shares one transaction
		select {
		case <-p.stop:
			return
		case <-time.After(p.interval):
		}
		p.flush()
	}
}

// flush commits everything queued so far and returns once it is on disk.
func (p *persister) flush() {
	p.flushMu.Lock()
	defer p.flushMu.Unlock()

	p.mu.Lock()
	if len(p.queue) == 0 {
		p.mu.Unlock()
		return
	}
	batch := p.queue
	p.queue = map[opKey]database.BatchOp{}
	p.mu.Unlock()

	ops := make([]database.BatchOp, 0, len(batch))
	for _, op := range batch {
		ops = append(ops, op)
	}
	if err := p.db.WriteBatch(ops); err != nil {
		logger.PrintAndLog("Cluster", "Metadata could not be written to disk; retrying", err)
		//Put the batch back unless a newer change of the same key arrived
		p.mu.Lock()
		if !p.stopped {
			for k, op := range batch {
				if _, newer := p.queue[k]; !newer {
					p.queue[k] = op
				}
			}
		}
		p.mu.Unlock()
		select {
		case p.wake <- struct{}{}:
		default:
		}
	}
}

// pending reports how many keys wait to be written (for tests and status).
func (p *persister) pending() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.queue)
}

// close stops the writer and commits what is left.
func (p *persister) close() {
	p.once.Do(func() {
		close(p.stop)
		<-p.done
		p.mu.Lock()
		p.stopped = true
		p.mu.Unlock()
		p.flush()
	})
}

// discard stops the writer and drops what is queued, for a store whose
// tables were wiped: writing its leftovers would bring the old data back.
func (p *persister) discard() {
	p.once.Do(func() {
		p.mu.Lock()
		p.stopped = true
		p.queue = map[opKey]database.BatchOp{}
		p.mu.Unlock()
		close(p.stop)
		<-p.done
		//Wait out a commit another caller had already started
		p.flushMu.Lock()
		p.flushMu.Unlock()
	})
}
