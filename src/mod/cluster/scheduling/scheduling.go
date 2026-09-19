package scheduling

/*
	ArozOS Cluster - placement scoring

	One scorer answers "which node should do this?" for every layer that has
	to choose: the job scheduler, write placement and the replication
	planner. It weighs data locality, free CPU, free memory, free disk, how
	much work a node already has, the network distance to the data and, for
	a second copy, how far the node is from the copies that already exist,
	and it explains every number so the choice can be shown to an admin.

	The weights are a cluster-wide replicated setting, so every node scores
	the same way and a new leader keeps the admin's tuning.
*/

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
)

// SettingKey is where the weights live in the replicated setting store.
const SettingKey = "scheduling.weights"

// Weights tune the scorer. They are fractions of one; the defaults are the
// values the cluster shipped with.
type Weights struct {
	Locality  float64 `json:"locality"`
	CPU       float64 `json:"cpu"`
	Memory    float64 `json:"memory"`
	Disk      float64 `json:"disk"`
	Queue     float64 `json:"queue"`
	Latency   float64 `json:"latency"`
	Degraded  float64 `json:"degraded"`
	Preferred float64 `json:"preferred"`
	Diversity float64 `json:"diversity"`
}

// DefaultWeights is the shipped tuning.
func DefaultWeights() Weights {
	return Weights{
		Locality:  0.45,
		CPU:       0.20,
		Memory:    0.10,
		Disk:      0.05,
		Queue:     0.10,
		Latency:   0.05,
		Degraded:  0.05,
		Preferred: 0.10,
		Diversity: 0.05,
	}
}

// Validate rejects nonsense weights.
func (w Weights) Validate() error {
	vals := map[string]float64{
		"locality": w.Locality, "cpu": w.CPU, "memory": w.Memory, "disk": w.Disk,
		"queue": w.Queue, "latency": w.Latency, "degraded": w.Degraded, "preferred": w.Preferred,
		"diversity": w.Diversity,
	}
	for name, v := range vals {
		if v < 0 || v > 1 {
			return errors.New("weight " + name + " must be between 0 and 1")
		}
	}
	return nil
}

// Candidate is one node being considered, with everything the scorer needs.
type Candidate struct {
	Node     membership.NodeView
	Locality float64 //0..1, share of the input bytes already on this node
	Queue    int     //work already assigned to this node
	//LatencyToData is the round trip to where the data sits, in milliseconds
	//(negative when unknown).
	LatencyToData float64
	//Preferred features earn a bonus when the node has them.
	Preferred []string
	//FreeDisk is the largest free space of the node's volumes, 0..1 of capacity
	//(negative when unknown).
	FreeDisk float64
	//Diversity is how far this node is from the copies that already exist,
	//0..1 of one second of round trip (negative when it does not apply, for
	//example for the first copy or a cluster too small to spread over).
	Diversity float64
}

// Factor is one contribution to a score, for the explanation.
type Factor struct {
	Name   string  `json:"name"`
	Value  float64 `json:"value"`  //the raw 0..1 measurement
	Weight float64 `json:"weight"` //the weight applied
	Points float64 `json:"points"` //what it added to (or took from) the score
}

// Result is a scored candidate.
type Result struct {
	NodeID   string   `json:"nodeId"`
	NodeName string   `json:"nodeName"`
	State    string   `json:"state"`
	Score    float64  `json:"score"`
	Eligible bool     `json:"eligible"`
	Reason   string   `json:"reason,omitempty"` //why it is not eligible
	Factors  []Factor `json:"factors"`
}

// Manager holds the replicated weights and does the scoring.
type Manager struct {
	m    *membership.Manager
	meta *metadata.Manager

	mu     sync.RWMutex
	cached Weights
	loaded bool
}

// New creates the scorer.
func New(m *membership.Manager, meta *metadata.Manager) (*Manager, error) {
	if m == nil || meta == nil {
		return nil, errors.New("membership and metadata are required")
	}
	return &Manager{m: m, meta: meta, cached: DefaultWeights()}, nil
}

// Weights returns the cluster-wide weights (defaults until an admin sets them).
func (s *Manager) Weights() Weights {
	if st, ok := s.meta.Setting(SettingKey); ok {
		//Start from the defaults so a record written by an older version,
		//which did not know a weight yet, keeps that weight's default
		w := DefaultWeights()
		if json.Unmarshal(st.Value, &w) == nil {
			s.mu.Lock()
			s.cached, s.loaded = w, true
			s.mu.Unlock()
			return w
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cached
}

// SetWeights replicates new weights to the whole cluster.
func (s *Manager) SetWeights(w Weights) error {
	if err := w.Validate(); err != nil {
		return err
	}
	js, err := json.Marshal(w)
	if err != nil {
		return err
	}
	if err := s.meta.Submit(metadata.KindSetting, &metadata.Setting{Key: SettingKey, Value: js}); err != nil {
		return err
	}
	s.mu.Lock()
	s.cached, s.loaded = w, true
	s.mu.Unlock()
	return nil
}

// ResetWeights restores the shipped tuning.
func (s *Manager) ResetWeights() error { return s.SetWeights(DefaultWeights()) }

/*
	Scoring
*/

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// cpuFree is the share of the node's processor that is idle. A node that has
// not reported health yet counts as idle so a fresh node is not punished.
func cpuFree(n membership.NodeView) float64 {
	if n.Health.Timestamp == 0 {
		return 1
	}
	return 1 - n.Health.CPUUsage/100
}

// Score rates one candidate and explains the result.
func (s *Manager) Score(c Candidate) (float64, []Factor) {
	w := s.Weights()
	factors := []Factor{}
	add := func(name string, value float64, weight float64) {
		value = clamp01(value)
		points := value * weight
		factors = append(factors, Factor{Name: name, Value: value, Weight: weight, Points: points})
	}
	sub := func(name string, value float64, weight float64) {
		value = clamp01(value)
		points := -value * weight
		factors = append(factors, Factor{Name: name, Value: value, Weight: weight, Points: points})
	}

	add("locality", c.Locality, w.Locality)

	add("cpu free", cpuFree(c.Node), w.CPU)

	memFree := 0.5
	if c.Node.Health.RAMTotal > 0 {
		memFree = 1 - float64(c.Node.Health.RAMUsed)/float64(c.Node.Health.RAMTotal)
	}
	add("memory free", memFree, w.Memory)

	diskFree := c.FreeDisk
	if diskFree < 0 {
		if c.Node.Health.DiskTotal > 0 {
			diskFree = float64(c.Node.Health.DiskFree) / float64(c.Node.Health.DiskTotal)
		} else {
			diskFree = 0.5
		}
	}
	add("disk free", diskFree, w.Disk)

	if len(c.Preferred) > 0 {
		have := 0
		for _, f := range c.Preferred {
			if c.Node.Capabilities.Has(f) {
				have++
			}
		}
		add("preferred features", float64(have)/float64(len(c.Preferred)), w.Preferred)
	}

	if c.Diversity >= 0 {
		//A copy is worth more on a node far from the ones that already hold
		//the file, because distance usually means a different site
		add("site diversity", c.Diversity, w.Diversity)
	}

	//Penalties
	queue := float64(c.Queue) / 8 //eight queued items saturate the penalty
	sub("queue depth", queue, w.Queue)

	lat := c.LatencyToData
	if lat < 0 {
		lat = c.Node.LatencyMs
	}
	if lat > 0 {
		//One second of round trip saturates the penalty
		sub("network distance", lat/1000, w.Latency)
	}
	if c.Node.State == membership.StateDegraded {
		sub("degraded", 1, w.Degraded)
	}

	score := 0.0
	for _, f := range factors {
		score += f.Points
	}
	return score, factors
}

// Rank scores every candidate and returns them best first. Candidates that
// are not eligible keep their reason and sort last.
func (s *Manager) Rank(candidates []Candidate, eligible func(Candidate) (bool, string)) []Result {
	out := []Result{}
	anyOnline := false
	for _, c := range candidates {
		if c.Node.State == membership.StateOnline {
			if ok, _ := eligible(c); ok {
				anyOnline = true
			}
		}
	}
	for _, c := range candidates {
		res := Result{NodeID: c.Node.ID, NodeName: c.Node.Name, State: string(c.Node.State), Eligible: true}
		if ok, why := eligible(c); !ok {
			res.Eligible, res.Reason = false, why
		} else if c.Node.State == membership.StateDegraded && anyOnline {
			//A struggling node only gets work when nothing healthy qualifies
			res.Eligible, res.Reason = false, "node is degraded and a healthy node is available"
		}
		res.Score, res.Factors = s.Score(c)
		out = append(out, res)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Eligible != out[j].Eligible {
			return out[i].Eligible
		}
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].NodeID < out[j].NodeID
	})
	return out
}

// Best returns the winning node of a ranking, or "" with the first reason.
func Best(results []Result) (string, string) {
	for _, r := range results {
		if r.Eligible {
			return r.NodeID, ""
		}
	}
	if len(results) > 0 {
		return "", results[0].Reason
	}
	return "", "no node is available"
}

/*
	Status for the settings page
*/

// NodeStatus is one row of the scheduling overview.
type NodeStatus struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	State     string  `json:"state"`
	Local     bool    `json:"local"`
	LatencyMs float64 `json:"latencyMs"`
	CPUFree   float64 `json:"cpuFree"`
	MemFree   float64 `json:"memFree"`
	DiskFree  float64 `json:"diskFree"`
	Score     float64 `json:"score"`
	Features  int     `json:"features"`
}

// Status is the scheduling picture.
type Status struct {
	InCluster bool                          `json:"inCluster"`
	Weights   Weights                       `json:"weights"`
	Defaults  Weights                       `json:"defaults"`
	Nodes     []NodeStatus                  `json:"nodes"`
	Matrix    map[string]map[string]float64 `json:"matrix"` //from node to node, milliseconds
	Updated   int64                         `json:"updated"`
}

// Status builds a preview: every node scored with no locality and no queue,
// which is what an admin wants to see when tuning the weights.
func (s *Manager) Status() Status {
	st := Status{InCluster: s.m.InCluster(), Weights: s.Weights(), Defaults: DefaultWeights(), Nodes: []NodeStatus{}, Updated: time.Now().Unix()}
	for _, n := range s.m.NodeViews() {
		c := Candidate{Node: n, FreeDisk: -1, LatencyToData: -1, Diversity: -1}
		score, _ := s.Score(c)
		row := NodeStatus{
			ID: n.ID, Name: n.Name, State: string(n.State), Local: n.Local,
			LatencyMs: n.LatencyMs, Score: score, CPUFree: cpuFree(n),
			Features: len(n.Capabilities.EnabledFeatures()),
		}
		if n.Health.RAMTotal > 0 {
			row.MemFree = 1 - float64(n.Health.RAMUsed)/float64(n.Health.RAMTotal)
		}
		if n.Health.DiskTotal > 0 {
			row.DiskFree = float64(n.Health.DiskFree) / float64(n.Health.DiskTotal)
		}
		st.Nodes = append(st.Nodes, row)
	}
	sort.Slice(st.Nodes, func(i, j int) bool { return st.Nodes[i].Score > st.Nodes[j].Score })
	if st.InCluster {
		//What the replication planner sees when it spreads copies over sites
		st.Matrix = s.m.LatencyMatrix()
	}
	return st
}

// ParseFeatures splits a comma separated feature list.
func ParseFeatures(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
