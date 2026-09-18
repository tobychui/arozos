package metadata

/*
	ACMS replicated log.

	The leader assigns sequence numbers and fans entries out; followers apply
	them and remember the highest contiguous sequence they applied. Changes
	made on a follower go to the leader (or wait in the pending queue until a
	leader is reachable). Applying is idempotent (last-writer-wins per
	record) so duplicates and reordering are harmless; the sequence numbers
	only tell a follower when it has missed something and must catch up.
*/

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/membership"
)

const (
	pathAppend   = acn.BasePath + "/meta/append"
	pathSubmit   = acn.BasePath + "/meta/submit"
	pathLog      = acn.BasePath + "/meta/log"
	pathSnapshot = acn.BasePath + "/meta/snapshot"
	pathLease    = acn.BasePath + "/meta/lease"
	pathStat     = acn.BasePath + "/meta/stat"
	logPageSize  = 500
)

func newEntry(kind string, rec interface{}, version int64, origin string) (Entry, error) {
	js, err := json.Marshal(rec)
	if err != nil {
		return Entry{}, err
	}
	return Entry{Kind: kind, Payload: js, Version: version, Origin: origin}, nil
}

// apply folds one entry into the local store. Returns true when it changed
// anything.
func (mgr *Manager) apply(e Entry) bool {
	changed := false
	switch e.Kind {
	case KindFile:
		var rec FileRecord
		if json.Unmarshal(e.Payload, &rec) == nil {
			changed = mgr.st.putFile(&rec)
		}
	case KindVolume:
		var v Volume
		if json.Unmarshal(e.Payload, &v) == nil {
			changed = mgr.st.putVolume(&v)
		}
	case KindPolicy:
		var p Policy
		if json.Unmarshal(e.Payload, &p) == nil {
			changed = mgr.st.putPolicy(&p)
		}
	}
	if changed && mgr.OnChange != nil {
		mgr.OnChange(e.Kind, e.Payload)
	}
	return changed
}

// dispatch replicates an entry that was already applied locally.
func (mgr *Manager) dispatch(e Entry) {
	if mgr.IsLeader() {
		mgr.leaderAccept(e)
		return
	}
	id := uuid.NewV4().String()
	mgr.st.addPending(id, e)
	go mgr.flushPending()
}

// leaderAccept assigns a sequence number and pushes the entry to every peer.
func (mgr *Manager) leaderAccept(e Entry) Entry {
	lease := mgr.st.getLease()
	assigned := mgr.st.appendLog(e, lease.Term)
	mgr.st.setApplied(assigned.Seq, lease.Term)
	mgr.mu.Lock()
	mgr.appends++
	compact := mgr.appends%1000 == 0
	mgr.mu.Unlock()
	if compact {
		mgr.st.compactLog(mgr.opt.LogKeep)
	}
	go mgr.fanout([]Entry{assigned})
	return assigned
}

func (mgr *Manager) onlinePeers() []string {
	out := []string{}
	for _, n := range mgr.m.NodeViews() {
		if n.Local {
			continue
		}
		if n.State == membership.StateOnline || n.State == membership.StateDegraded {
			out = append(out, n.ID)
		}
	}
	return out
}

func (mgr *Manager) fanout(entries []Entry) {
	for _, peer := range mgr.onlinePeers() {
		go func(id string) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			mgr.m.Transport().DoJSON(ctx, id, http.MethodPost, pathAppend, AppendRequest{Entries: entries}, nil)
		}(peer)
	}
}

// followerReceive handles entries pushed by the leader.
func (mgr *Manager) followerReceive(entries []Entry) {
	applied, term := mgr.st.getApplied()
	for _, e := range entries {
		mgr.apply(e)
		if e.Term != term {
			//New leadership term: the numbering restarted, take a snapshot later
			term = e.Term
			applied = 0
			mgr.st.setApplied(0, term)
			mgr.requestCatchup()
		}
		if e.Seq == applied+1 {
			applied = e.Seq
			mgr.st.setApplied(applied, term)
		} else if e.Seq > applied+1 {
			mgr.requestCatchup()
		}
		mgr.st.setLastSeq(e.Seq)
	}
}

func (mgr *Manager) requestCatchup() {
	select {
	case mgr.catchupCh <- struct{}{}:
	default:
	}
}

func (mgr *Manager) catchupLoop() {
	defer mgr.wg.Done()
	for {
		select {
		case <-mgr.stop:
			return
		case <-mgr.catchupCh:
			mgr.catchup()
		}
	}
}

// catchup pulls missing log entries (or a snapshot) from the leader.
func (mgr *Manager) catchup() {
	if mgr.IsLeader() {
		return
	}
	leader := mgr.Leader()
	if leader == "" {
		return
	}
	for i := 0; i < 100; i++ {
		applied, term := mgr.st.getApplied()
		if applied == 0 {
			//Fresh node or fresh term: the log may have been compacted below
			//what we need, a snapshot is the only safe starting point
			mgr.snapshotFromLeader(leader)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		resp, err := mgr.m.Transport().Do(ctx, leader, http.MethodGet, pathLog+"?after="+uitoa(applied), nil)
		cancel()
		if err != nil {
			return
		}
		if resp.Status == http.StatusGone {
			mgr.snapshotFromLeader(leader)
			return
		}
		if err := resp.Error(); err != nil {
			return
		}
		var page LogResponse
		if json.Unmarshal(resp.Body, &page) != nil {
			return
		}
		if page.Term != term {
			mgr.snapshotFromLeader(leader)
			return
		}
		for _, e := range page.Entries {
			mgr.apply(e)
			applied = e.Seq
		}
		mgr.st.setApplied(applied, page.Term)
		mgr.st.setLastSeq(page.LastSeq)
		if len(page.Entries) < logPageSize || applied >= page.LastSeq {
			return
		}
	}
}

func (mgr *Manager) snapshotFromLeader(leader string) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var snap Snapshot
	if err := mgr.m.Transport().DoJSON(ctx, leader, http.MethodGet, pathSnapshot, nil, &snap); err != nil {
		return
	}
	mgr.applySnapshot(snap)
}

func (mgr *Manager) applySnapshot(snap Snapshot) {
	for i := range snap.Files {
		if mgr.st.putFile(&snap.Files[i]) && mgr.OnChange != nil {
			js, _ := json.Marshal(snap.Files[i])
			mgr.OnChange(KindFile, js)
		}
	}
	for i := range snap.Volumes {
		mgr.st.putVolume(&snap.Volumes[i])
	}
	for i := range snap.Policies {
		mgr.st.putPolicy(&snap.Policies[i])
	}
	mgr.st.setApplied(snap.LastSeq, snap.Term)
	mgr.st.setLastSeq(snap.LastSeq)
}

// pendingLoop retries follower changes that no leader has accepted yet.
func (mgr *Manager) pendingLoop() {
	defer mgr.wg.Done()
	ticker := time.NewTicker(mgr.opt.PendingRetry)
	defer ticker.Stop()
	for {
		select {
		case <-mgr.stop:
			return
		case <-ticker.C:
			mgr.flushPending()
		}
	}
}

// flushPending hands queued entries to the leader (or accepts them locally
// when this node became the leader meanwhile).
func (mgr *Manager) flushPending() {
	pending := mgr.st.pendingEntries()
	if len(pending) == 0 {
		return
	}
	if mgr.IsLeader() {
		for id, e := range pending {
			mgr.leaderAccept(e)
			mgr.st.removePending(id)
		}
		return
	}
	leader := mgr.Leader()
	if leader == "" {
		return
	}
	for id, e := range pending {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err := mgr.m.Transport().DoJSON(ctx, leader, http.MethodPost, pathSubmit, e, nil)
		cancel()
		if err != nil {
			return
		}
		mgr.st.removePending(id)
	}
}

func uitoa(v uint64) string {
	if v == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
