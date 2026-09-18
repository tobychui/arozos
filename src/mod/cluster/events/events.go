package events

/*
	ArozOS Cluster Event Bus (AEB)

	In-process publish/subscribe with cluster-wide fan-out: every event
	published on one node is delivered to local subscribers and pushed to
	every online peer (signed ACN, batched, de-duplicated by event ID).
	Web clients follow the stream over a WebSocket; AGI scripts can be
	registered as hooks that run when matching events arrive.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

const (
	pathPublish   = acn.BasePath + "/events/publish"
	tableHooks    = "event_hooks"
	batchInterval = 200 * time.Millisecond
	dedupWindow   = 10 * time.Minute
	maxHookRuns   = 4
)

// Event is one thing that happened somewhere in the cluster.
type Event struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Node   string          `json:"node"`
	Path   string          `json:"path,omitempty"`
	FileID string          `json:"fileId,omitempty"`
	User   string          `json:"user,omitempty"`
	Time   int64           `json:"time"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// Hook is an AGI script that runs for matching events.
type Hook struct {
	ID       string   `json:"id"`
	Owner    string   `json:"owner"`
	Types    []string `json:"types"`
	Script   string   `json:"script"` // vpath of the .agi script
	Created  int64    `json:"created"`
	LastRun  int64    `json:"lastRun"`
	LastErr  string   `json:"lastError,omitempty"`
	RunCount int      `json:"runCount"`
}

// HookRunner executes a hook for an event (provided by the core, uses AGI).
type HookRunner func(hook Hook, ev Event) error

type subscriber struct {
	id    string
	types map[string]bool
	fn    func(Event)
}

// Bus is the event bus of this node.
type Bus struct {
	m      *membership.Manager
	runner HookRunner

	mu    sync.RWMutex
	subs  map[string]*subscriber
	hooks map[string]*Hook
	seen  map[string]int64

	batchMu sync.Mutex
	batch   []Event

	hookSem chan struct{}
	stop    chan struct{}
	once    sync.Once
	wg      sync.WaitGroup

	upgrader websocket.Upgrader
}

// New creates the bus and registers its node endpoint.
func New(m *membership.Manager, runner HookRunner) (*Bus, error) {
	if m == nil {
		return nil, errors.New("membership manager is required")
	}
	membership.RegisterClusterTable(tableHooks)
	m.DB().NewTable(tableHooks)
	b := &Bus{
		m:       m,
		runner:  runner,
		subs:    map[string]*subscriber{},
		hooks:   map[string]*Hook{},
		seen:    map[string]int64{},
		hookSem: make(chan struct{}, maxHookRuns),
		stop:    make(chan struct{}),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
	b.loadHooks()
	m.Server().HandleFunc(pathPublish, b.handlePublish)
	b.wg.Add(2)
	go b.flushLoop()
	go b.nodeWatch()
	return b, nil
}

// Close stops the background loops.
func (b *Bus) Close() {
	b.once.Do(func() { close(b.stop) })
	b.wg.Wait()
}

/*
	Publish / subscribe
*/

// Publish delivers an event locally and to every online peer.
func (b *Bus) Publish(ev Event) {
	if ev.ID == "" {
		ev.ID = uuid.NewV4().String()
	}
	if ev.Node == "" {
		ev.Node = b.m.NodeID()
	}
	if ev.Time == 0 {
		ev.Time = time.Now().Unix()
	}
	if !b.remember(ev.ID) {
		return
	}
	b.deliver(ev)
	if b.m.InCluster() {
		b.batchMu.Lock()
		b.batch = append(b.batch, ev)
		b.batchMu.Unlock()
	}
}

// Subscribe registers a local listener for the given types ("*" = all).
func (b *Bus) Subscribe(types []string, fn func(Event)) func() {
	s := &subscriber{id: uuid.NewV4().String(), types: map[string]bool{}, fn: fn}
	for _, t := range types {
		s.types[strings.ToLower(strings.TrimSpace(t))] = true
	}
	if len(s.types) == 0 {
		s.types["*"] = true
	}
	b.mu.Lock()
	b.subs[s.id] = s
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		delete(b.subs, s.id)
		b.mu.Unlock()
	}
}

func matches(types map[string]bool, t string) bool {
	if types["*"] {
		return true
	}
	t = strings.ToLower(t)
	if types[t] {
		return true
	}
	if i := strings.Index(t, "."); i > 0 && types[t[:i]+".*"] {
		return true
	}
	return false
}

func (b *Bus) remember(id string) bool {
	now := time.Now().Unix()
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.seen[id]; ok {
		return false
	}
	b.seen[id] = now
	if len(b.seen) > 5000 {
		cutoff := now - int64(dedupWindow.Seconds())
		for k, ts := range b.seen {
			if ts < cutoff {
				delete(b.seen, k)
			}
		}
	}
	return true
}

func (b *Bus) deliver(ev Event) {
	b.mu.RLock()
	subs := make([]*subscriber, 0, len(b.subs))
	for _, s := range b.subs {
		if matches(s.types, ev.Type) {
			subs = append(subs, s)
		}
	}
	hooks := []Hook{}
	for _, h := range b.hooks {
		if matches(typeSet(h.Types), ev.Type) {
			hooks = append(hooks, *h)
		}
	}
	b.mu.RUnlock()
	for _, s := range subs {
		func(s *subscriber) {
			defer func() { recover() }()
			s.fn(ev)
		}(s)
	}
	for _, h := range hooks {
		go b.runHook(h, ev)
	}
}

func typeSet(types []string) map[string]bool {
	out := map[string]bool{}
	for _, t := range types {
		out[strings.ToLower(t)] = true
	}
	return out
}

func (b *Bus) flushLoop() {
	defer b.wg.Done()
	ticker := time.NewTicker(batchInterval)
	defer ticker.Stop()
	for {
		select {
		case <-b.stop:
			return
		case <-ticker.C:
			b.flush()
		}
	}
}

func (b *Bus) flush() {
	b.batchMu.Lock()
	batch := b.batch
	b.batch = nil
	b.batchMu.Unlock()
	if len(batch) == 0 {
		return
	}
	for _, n := range b.m.NodeViews() {
		if n.Local || (n.State != membership.StateOnline && n.State != membership.StateDegraded) {
			continue
		}
		go func(id string) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := b.m.Transport().DoJSON(ctx, id, http.MethodPost, pathPublish, batch, nil); err != nil {
				time.Sleep(2 * time.Second)
				ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel2()
				b.m.Transport().DoJSON(ctx2, id, http.MethodPost, pathPublish, batch, nil)
			}
		}(n.ID)
	}
}

func (b *Bus) handlePublish(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var batch []Event
	if err := json.Unmarshal(body, &batch); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid batch")
		return
	}
	for _, ev := range batch {
		if ev.ID == "" || ev.Type == "" {
			continue
		}
		if b.remember(ev.ID) {
			b.deliver(ev)
		}
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

// nodeWatch turns membership state changes into node.* events.
func (b *Bus) nodeWatch() {
	defer b.wg.Done()
	prev := map[string]membership.NodeState{}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-b.stop:
			return
		case <-ticker.C:
			if !b.m.InCluster() {
				prev = map[string]membership.NodeState{}
				continue
			}
			cur := map[string]membership.NodeState{}
			for _, n := range b.m.NodeViews() {
				cur[n.ID] = n.State
				old, known := prev[n.ID]
				if !known {
					if len(prev) > 0 {
						b.publishLocal(Event{Type: "node.joined", Node: n.ID})
					}
					continue
				}
				if old != n.State {
					if n.State == membership.StateOnline {
						b.publishLocal(Event{Type: "node.online", Node: n.ID})
					} else if n.State == membership.StateOffline {
						b.publishLocal(Event{Type: "node.offline", Node: n.ID})
					}
				}
			}
			for id := range prev {
				if _, still := cur[id]; !still {
					b.publishLocal(Event{Type: "node.left", Node: id})
				}
			}
			prev = cur
		}
	}
}

// publishLocal delivers node events without fan-out: every node computes the
// same state transitions itself.
func (b *Bus) publishLocal(ev Event) {
	ev.ID = uuid.NewV4().String()
	ev.Time = time.Now().Unix()
	b.deliver(ev)
}

/*
	Hooks
*/

func (b *Bus) loadHooks() {
	entries, err := b.m.DB().ListTable(tableHooks)
	if err != nil {
		return
	}
	for _, kv := range entries {
		var h Hook
		if json.Unmarshal(kv[1], &h) == nil && h.ID != "" {
			b.hooks[h.ID] = &h
		}
	}
}

// AddHook registers a script for event types on behalf of owner.
func (b *Bus) AddHook(owner string, types []string, script string) (*Hook, error) {
	if owner == "" || script == "" || len(types) == 0 {
		return nil, errors.New("owner, script and at least one event type are required")
	}
	h := &Hook{ID: uuid.NewV4().String(), Owner: owner, Types: types, Script: script, Created: time.Now().Unix()}
	b.mu.Lock()
	b.hooks[h.ID] = h
	b.mu.Unlock()
	b.m.DB().Write(tableHooks, h.ID, h)
	return h, nil
}

// RemoveHook deletes a hook; owner "" removes regardless of owner.
func (b *Bus) RemoveHook(id string, owner string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	h, ok := b.hooks[id]
	if !ok || (owner != "" && h.Owner != owner) {
		return errors.New("hook not found")
	}
	delete(b.hooks, id)
	b.m.DB().Delete(tableHooks, id)
	return nil
}

// Hooks lists hooks, filtered by owner when non-empty.
func (b *Bus) Hooks(owner string) []Hook {
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := []Hook{}
	for _, h := range b.hooks {
		if owner == "" || h.Owner == owner {
			out = append(out, *h)
		}
	}
	return out
}

func (b *Bus) runHook(h Hook, ev Event) {
	if b.runner == nil {
		return
	}
	b.hookSem <- struct{}{}
	defer func() { <-b.hookSem }()
	err := b.runner(h, ev)
	b.mu.Lock()
	if cur, ok := b.hooks[h.ID]; ok {
		cur.LastRun = time.Now().Unix()
		cur.RunCount++
		cur.LastErr = ""
		if err != nil {
			cur.LastErr = err.Error()
		}
		b.m.DB().Write(tableHooks, cur.ID, cur)
	}
	b.mu.Unlock()
	if err != nil {
		logger.PrintAndLog("Cluster", "Event hook "+h.Script+" failed: "+err.Error(), nil)
	}
}

/*
	WebSocket feed for web clients
*/

// HandleWebSocket streams events to a browser. Optional ?types=a,b filter.
func (b *Bus) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	types := []string{}
	if q, _ := utils.GetPara(r, "types"); q != "" {
		types = strings.Split(q, ",")
	}
	ws, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	var wmu sync.Mutex
	send := func(ev Event) {
		wmu.Lock()
		defer wmu.Unlock()
		ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		ws.WriteJSON(ev)
	}
	unsub := b.Subscribe(types, send)
	defer unsub()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			ws.Close()
			return
		case <-b.stop:
			ws.Close()
			return
		case <-ticker.C:
			wmu.Lock()
			err := ws.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second))
			wmu.Unlock()
			if err != nil {
				ws.Close()
				return
			}
		}
	}
}
