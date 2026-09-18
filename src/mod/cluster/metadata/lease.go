package metadata

/*
	ACMS leader lease.

	Deterministic and quorum-free so it works with two nodes: the eligible
	member that joined the cluster first (ties broken by ID) is the
	candidate. It claims the lease with a higher term when no valid lease
	exists, renews it while it lives, and every member accepts a lease with a
	higher term. After a partition heals the higher term wins on both sides.
*/

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
)

func eligibleState(s membership.NodeState) bool {
	return s == membership.StateOnline || s == membership.StateDegraded
}

// candidate returns the member that should hold the lease.
func (mgr *Manager) candidate() string {
	var best *membership.NodeView
	for _, n := range mgr.m.NodeViews() {
		if !eligibleState(n.State) {
			continue
		}
		nv := n
		if best == nil || nv.Joined < best.Joined || (nv.Joined == best.Joined && nv.ID < best.ID) {
			best = &nv
		}
	}
	if best == nil {
		return ""
	}
	return best.ID
}

func (mgr *Manager) eligible(nodeID string) bool {
	if nodeID == "" {
		return false
	}
	for _, n := range mgr.m.NodeViews() {
		if n.ID == nodeID {
			return eligibleState(n.State)
		}
	}
	return false
}

// IsLeader reports whether this node holds a live lease.
func (mgr *Manager) IsLeader() bool {
	if !mgr.m.InCluster() {
		return false
	}
	l := mgr.st.getLease()
	return l.Holder == mgr.m.NodeID() && l.Expires > time.Now().Unix()
}

// Leader returns the current lease holder, or "" when there is none.
func (mgr *Manager) Leader() string {
	if !mgr.m.InCluster() {
		return ""
	}
	l := mgr.st.getLease()
	if l.Holder == "" || l.Expires <= time.Now().Unix() {
		return ""
	}
	return l.Holder
}

func (mgr *Manager) leaseLoop() {
	defer mgr.wg.Done()
	ticker := time.NewTicker(mgr.opt.LeaseTick)
	defer ticker.Stop()
	for {
		select {
		case <-mgr.stop:
			return
		case <-ticker.C:
			mgr.leaseTick()
		}
	}
}

// leaseTick is one round of the election / renewal algorithm.
func (mgr *Manager) leaseTick() {
	if !mgr.m.InCluster() {
		return
	}
	now := time.Now().Unix()
	me := mgr.m.NodeID()
	cur := mgr.st.getLease()

	if cur.Holder != "" && cur.Expires > now && mgr.eligible(cur.Holder) {
		if cur.Holder == me && cur.Expires-now < int64(mgr.opt.LeaseRenew.Seconds()) {
			cur.Expires = now + int64(mgr.opt.LeaseDuration.Seconds())
			mgr.st.setLease(cur)
			mgr.pushLease(cur)
		} else if cur.Holder != me {
			//Follower housekeeping: make sure we are caught up with the leader
			applied, _ := mgr.st.getApplied()
			if applied < mgr.st.getLastSeq() {
				mgr.requestCatchup()
			}
		}
		return
	}

	if mgr.candidate() != me {
		return
	}
	claim := Lease{Holder: me, Term: cur.Term + 1, Expires: now + int64(mgr.opt.LeaseDuration.Seconds())}
	mgr.st.setLease(claim)
	mgr.st.setApplied(mgr.st.getLastSeq(), claim.Term)
	mgr.logf("Metadata leadership claimed (term " + uitoa(claim.Term) + ")")
	mgr.pushLease(claim)
	//Anything queued while there was no leader is ours to accept now
	go mgr.flushPending()
}

// pushLease tells every peer about the lease; a peer with a higher term
// makes us step down.
func (mgr *Manager) pushLease(l Lease) {
	req := LeaseRequest{Lease: l, LastSeq: mgr.st.getLastSeq()}
	for _, peer := range mgr.onlinePeers() {
		go func(id string) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			resp, err := mgr.m.Transport().DoJSON2(ctx, id, http.MethodPost, pathLease, req)
			if err != nil || resp == nil {
				return
			}
			if resp.Status == http.StatusConflict {
				var theirs LeaseResponse
				if json.Unmarshal(resp.Body, &theirs) == nil {
					mgr.acceptLease(theirs.Lease, theirs.LastSeq)
				}
			}
		}(peer)
	}
}

// acceptLease adopts a lease when it outranks ours. Returns true if adopted.
func (mgr *Manager) acceptLease(in Lease, leaderLastSeq uint64) bool {
	if in.Holder == "" || in.Term == 0 {
		return false
	}
	cur := mgr.st.getLease()
	switch {
	case in.Term > cur.Term:
		mgr.st.setLease(in)
		if in.Holder != mgr.m.NodeID() {
			mgr.logf("Metadata leader is now " + mgr.m.NodeName(in.Holder) + " (term " + uitoa(in.Term) + ")")
			//New term: numbering restarted on the leader, resync
			mgr.st.setApplied(0, in.Term)
			mgr.requestCatchup()
		}
		return true
	case in.Term == cur.Term && in.Holder == cur.Holder:
		if in.Expires > cur.Expires {
			mgr.st.setLease(in)
		}
		if in.Holder != mgr.m.NodeID() {
			applied, _ := mgr.st.getApplied()
			if applied < leaderLastSeq {
				mgr.st.setLastSeq(leaderLastSeq)
				mgr.requestCatchup()
			}
		}
		return true
	}
	return false
}
