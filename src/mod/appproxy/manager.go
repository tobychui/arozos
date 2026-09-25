package appproxy

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

/*
	manager.go

	The Manager owns the published endpoints (persisted in the system
	database), one reverse proxy per endpoint and the subdomain login sessions.
	It knows nothing about ArozOS users or Docker: the core wires those in
	through Options, which keeps the package testable on its own.
*/

const tableName = "appproxy"

// Identity is the ArozOS user behind a request
type Identity struct {
	Username string
	Groups   []string
	IsAdmin  bool
}

// Store is the subset of the system database the manager needs
type Store interface {
	NewTable(tableName string) error
	Write(tableName string, key string, value interface{}) error
	Delete(tableName string, key string) error
	ListTable(tableName string) ([][][]byte, error)
}

// Options wires the manager into the host application
type Options struct {
	Store Store

	//SelfPort is the port ArozOS listens on, so an endpoint cannot target it
	SelfPort int

	//ResolveUser returns the logged in user of a request on the ArozOS host, or nil
	ResolveUser func(w http.ResponseWriter, r *http.Request) *Identity

	//LookupUser returns a user by name (used to revalidate subdomain sessions), or nil
	LookupUser func(username string) *Identity

	//LoginURL is where an anonymous visitor of a protected app is sent, with
	//the path to come back to
	LoginURL func(returnTo string) string

	//StripCookies are the ArozOS cookie names never forwarded to a container
	StripCookies []string

	//Log receives operational messages
	Log func(message string, err error)
}

// Stats are runtime counters of one endpoint
type Stats struct {
	Requests  uint64
	Leaks     uint64   //Root requests redirected back under /app/<slug>/
	LastLeaks []string //Most recent leaked paths, newest first
}

type endpointRuntime struct {
	ep       *Endpoint
	proxy    *httputil.ReverseProxy
	requests atomic.Uint64
	leaks    atomic.Uint64
	leakMu   sync.Mutex
	lastLeak []string
}

const maxLastLeaks = 10

func (rt *endpointRuntime) recordLeak(path string) {
	rt.leaks.Add(1)
	rt.leakMu.Lock()
	defer rt.leakMu.Unlock()
	rt.lastLeak = append([]string{path}, rt.lastLeak...)
	if len(rt.lastLeak) > maxLastLeaks {
		rt.lastLeak = rt.lastLeak[:maxLastLeaks]
	}
}

func (rt *endpointRuntime) stats() Stats {
	rt.leakMu.Lock()
	defer rt.leakMu.Unlock()
	return Stats{
		Requests:  rt.requests.Load(),
		Leaks:     rt.leaks.Load(),
		LastLeaks: append([]string{}, rt.lastLeak...),
	}
}

// Manager serves and manages the published container apps
type Manager struct {
	opts Options

	mu     sync.RWMutex
	bySlug map[string]*endpointRuntime
	byHost map[string]*endpointRuntime

	transport         *http.Transport
	insecureTransport *http.Transport

	sessions *sessionStore
}

// NewManager loads the saved endpoints and returns a ready manager
func NewManager(opts Options) (*Manager, error) {
	if opts.Store == nil {
		return nil, errors.New("appproxy: a store is required")
	}
	if opts.Log == nil {
		opts.Log = func(string, error) {}
	}
	if opts.ResolveUser == nil {
		opts.ResolveUser = func(http.ResponseWriter, *http.Request) *Identity { return nil }
	}
	if opts.LookupUser == nil {
		opts.LookupUser = func(string) *Identity { return nil }
	}
	if opts.LoginURL == nil {
		opts.LoginURL = func(string) string { return "/login.html" }
	}
	if err := opts.Store.NewTable(tableName); err != nil {
		return nil, err
	}

	m := &Manager{
		opts:              opts,
		bySlug:            map[string]*endpointRuntime{},
		byHost:            map[string]*endpointRuntime{},
		transport:         newTransport(false),
		insecureTransport: newTransport(true),
		sessions:          newSessionStore(),
	}

	rows, err := opts.Store.ListTable(tableName)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if len(row) != 2 {
			continue
		}
		ep := Endpoint{}
		if err := json.Unmarshal(row[1], &ep); err != nil {
			opts.Log("Skipping unreadable endpoint "+string(row[0]), err)
			continue
		}
		m.install(&ep)
	}
	return m, nil
}

func newTransport(skipVerify bool) *http.Transport {
	t := &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if skipVerify {
		t.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return t
}

// install builds the runtime of an endpoint and indexes it (replacing an older one)
func (m *Manager) install(ep *Endpoint) {
	rt := &endpointRuntime{ep: ep}
	rt.proxy = m.newReverseProxy(rt)

	m.mu.Lock()
	defer m.mu.Unlock()
	if old, ok := m.bySlug[ep.Slug]; ok {
		if old.ep.Hostname != "" {
			delete(m.byHost, old.ep.Hostname)
		}
		//Keep the counters across edits
		rt.requests.Store(old.requests.Load())
		rt.leaks.Store(old.leaks.Load())
		rt.lastLeak = old.stats().LastLeaks
	}
	m.bySlug[ep.Slug] = rt
	if ep.Mode == ModeSubdomain && ep.Hostname != "" {
		m.byHost[ep.Hostname] = rt
	}
}

func (m *Manager) runtimeBySlug(slug string) *endpointRuntime {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.bySlug[slug]
}

func (m *Manager) runtimeByHost(host string) *endpointRuntime {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.byHost) == 0 {
		return nil
	}
	return m.byHost[NormalizeHostname(host)]
}

// List returns a copy of every endpoint, sorted by name
func (m *Manager) List() []Endpoint {
	m.mu.RLock()
	results := make([]Endpoint, 0, len(m.bySlug))
	for _, rt := range m.bySlug {
		results = append(results, *rt.ep)
	}
	m.mu.RUnlock()
	sort.Slice(results, func(i, j int) bool {
		if results[i].Name == results[j].Name {
			return results[i].Slug < results[j].Slug
		}
		return results[i].Name < results[j].Name
	})
	return results
}

// Get returns a copy of one endpoint
func (m *Manager) Get(slug string) (Endpoint, bool) {
	rt := m.runtimeBySlug(slug)
	if rt == nil {
		return Endpoint{}, false
	}
	return *rt.ep, true
}

// Stats returns the runtime counters of one endpoint
func (m *Manager) Stats(slug string) Stats {
	rt := m.runtimeBySlug(slug)
	if rt == nil {
		return Stats{}
	}
	return rt.stats()
}

// Count returns the number of published endpoints
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.bySlug)
}

// Save creates (create=true) or updates an endpoint after validating it.
// currentHost is the ArozOS host the admin is using, which an app hostname
// must never take over
func (m *Manager) Save(ep Endpoint, create bool, username string, currentHost string) (Endpoint, error) {
	if err := ep.Normalize(m.opts.SelfPort); err != nil {
		return Endpoint{}, err
	}
	if ep.Mode == ModeSubdomain && currentHost != "" && NormalizeHostname(currentHost) == ep.Hostname {
		return Endpoint{}, errors.New("The app hostname must differ from the ArozOS hostname")
	}

	m.mu.RLock()
	existing, exists := m.bySlug[ep.Slug]
	var hostOwner *endpointRuntime
	if ep.Hostname != "" {
		hostOwner = m.byHost[ep.Hostname]
	}
	m.mu.RUnlock()

	if create && exists {
		return Endpoint{}, errors.New("Slug already in use")
	}
	if !create && !exists {
		return Endpoint{}, errors.New("App not found")
	}
	if hostOwner != nil && hostOwner.ep.Slug != ep.Slug {
		return Endpoint{}, errors.New("Hostname already used by " + hostOwner.ep.Name)
	}

	now := time.Now().Unix()
	if create {
		ep.CreatedBy = username
		ep.CreatedAt = now
	} else {
		ep.CreatedBy = existing.ep.CreatedBy
		ep.CreatedAt = existing.ep.CreatedAt
	}
	ep.UpdatedAt = now

	if err := m.opts.Store.Write(tableName, ep.Slug, ep); err != nil {
		return Endpoint{}, err
	}
	saved := ep
	m.install(&saved)
	if !create {
		//Access rules or the hostname may have changed
		m.sessions.dropEndpoint(ep.Slug)
	}
	return saved, nil
}

// Delete removes an endpoint
func (m *Manager) Delete(slug string) error {
	m.mu.Lock()
	rt, ok := m.bySlug[slug]
	if ok {
		delete(m.bySlug, slug)
		if rt.ep.Hostname != "" {
			delete(m.byHost, rt.ep.Hostname)
		}
	}
	m.mu.Unlock()
	if !ok {
		return errors.New("App not found")
	}
	m.sessions.dropEndpoint(slug)
	return m.opts.Store.Delete(tableName, slug)
}

// AccessibleBy returns the endpoints a user may open
func (m *Manager) AccessibleBy(id *Identity) []Endpoint {
	results := []Endpoint{}
	for _, ep := range m.List() {
		if ep.CanAccess(id) {
			results = append(results, ep)
		}
	}
	return results
}
