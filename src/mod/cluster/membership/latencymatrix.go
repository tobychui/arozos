package membership

/*
	ArozOS Cluster - pairwise latency

	Every node measures the round trip to its own peers on each heartbeat
	(see noteLatency). Those vectors are deliberately not gossiped, because
	they change constantly and would churn the membership records. Instead
	any node that needs the whole picture - in practice the leader, when it
	decides where a replica should go - asks the members for their vector
	and caches the result for a few minutes.

	The result is a matrix of "how far is B from A", which is what site
	diversity needs: a second copy is worth more on a node that is far from
	the one already holding the file, because that is likely a different
	site.
*/

import (
	"context"
	"net/http"
	"sync"
	"time"

	"imuslab.com/arozos/mod/cluster/acn"
)

var (
	//LatencyMatrixTTL is how long a collected matrix is reused.
	LatencyMatrixTTL = 2 * time.Minute
	//LatencyFetchTimeout bounds one peer's answer.
	LatencyFetchTimeout = 5 * time.Second
)

// LatencyReport is one node's view of the round trip to its peers.
type LatencyReport struct {
	NodeID    string             `json:"nodeId"`
	Latencies map[string]float64 `json:"latencies"` //peer node id to milliseconds
	Measured  int64              `json:"measured"`  //unix time of the answer
}

// handleLatency answers a peer asking for this node's measurements.
func (m *Manager) handleLatency(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	m.markSeen(sender.NodeID)
	acn.WriteJSON(w, LatencyReport{
		NodeID:    m.opt.NodeID,
		Latencies: m.Latencies(),
		Measured:  time.Now().Unix(),
	})
}

// latencyCache holds the last collected matrix.
type latencyCache struct {
	mu        sync.Mutex
	rows      map[string]map[string]float64
	collected time.Time
	busy      bool
}

// LatencyMatrix returns "from node to node" round trips in milliseconds. The
// local row is always current; peer rows are collected at most once every
// LatencyMatrixTTL. It never blocks longer than LatencyFetchTimeout, and it
// returns what it has when a peer does not answer.
func (m *Manager) LatencyMatrix() map[string]map[string]float64 {
	m.latencyMx.mu.Lock()
	fresh := time.Since(m.latencyMx.collected) < LatencyMatrixTTL
	if fresh || m.latencyMx.busy {
		out := copyMatrix(m.latencyMx.rows)
		m.latencyMx.mu.Unlock()
		out[m.opt.NodeID] = m.Latencies()
		return out
	}
	m.latencyMx.busy = true
	m.latencyMx.mu.Unlock()

	rows := map[string]map[string]float64{m.opt.NodeID: m.Latencies()}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, n := range m.NodeViews() {
		if n.Local || !usableForLatency(n.State) {
			continue
		}
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), LatencyFetchTimeout)
			defer cancel()
			var rep LatencyReport
			if err := m.transport.DoJSON(ctx, id, http.MethodGet, acn.BasePath+"/latency", nil, &rep); err != nil {
				return
			}
			mu.Lock()
			rows[id] = rep.Latencies
			mu.Unlock()
		}(n.ID)
	}
	wg.Wait()

	m.latencyMx.mu.Lock()
	m.latencyMx.rows = rows
	m.latencyMx.collected = time.Now()
	m.latencyMx.busy = false
	out := copyMatrix(rows)
	m.latencyMx.mu.Unlock()
	return out
}

// PairLatency returns the round trip between two nodes in milliseconds, taking
// whichever direction has been measured (the mean when both have). Two ids
// that are the same node are zero apart.
func PairLatency(matrix map[string]map[string]float64, a string, b string) (float64, bool) {
	if a == b {
		return 0, true
	}
	ab, okAB := matrix[a][b]
	ba, okBA := matrix[b][a]
	switch {
	case okAB && okBA:
		return (ab + ba) / 2, true
	case okAB:
		return ab, true
	case okBA:
		return ba, true
	}
	return 0, false
}

// ResetLatencyMatrix drops the cached matrix, so the next call collects again.
func (m *Manager) ResetLatencyMatrix() {
	m.latencyMx.reset()
}

func (c *latencyCache) reset() {
	c.mu.Lock()
	c.rows = nil
	c.collected = time.Time{}
	c.mu.Unlock()
}

func usableForLatency(s NodeState) bool {
	return s == StateOnline || s == StateDegraded || s == StateDraining
}

func copyMatrix(in map[string]map[string]float64) map[string]map[string]float64 {
	out := map[string]map[string]float64{}
	for from, row := range in {
		cp := map[string]float64{}
		for to, v := range row {
			cp[to] = v
		}
		out[from] = cp
	}
	return out
}
