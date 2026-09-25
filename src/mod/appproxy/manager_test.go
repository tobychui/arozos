package appproxy

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"sync"
	"testing"
)

// memStore is an in-memory Store for tests
type memStore struct {
	mu     sync.Mutex
	tables map[string]map[string][]byte
}

func newMemStore() *memStore {
	return &memStore{tables: map[string]map[string][]byte{}}
}

func (s *memStore) NewTable(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tables[name]; !ok {
		s.tables[name] = map[string][]byte{}
	}
	return nil
}

func (s *memStore) Write(table string, key string, value interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tables[table]
	if !ok {
		return errors.New("no table")
	}
	js, err := json.Marshal(value)
	if err != nil {
		return err
	}
	t[key] = js
	return nil
}

func (s *memStore) Delete(table string, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tables[table], key)
	return nil
}

func (s *memStore) ListTable(table string) ([][][]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := []string{}
	for k := range s.tables[table] {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	rows := [][][]byte{}
	for _, k := range keys {
		rows = append(rows, [][]byte{[]byte(k), s.tables[table][k]})
	}
	return rows, nil
}

// testUsers backs ResolveUser / LookupUser in tests. A request picks its user
// with the X-Test-User header
var testUsers = map[string]*Identity{
	"admin": {Username: "admin", Groups: []string{"administrator"}, IsAdmin: true},
	"alice": {Username: "alice", Groups: []string{"users"}},
	"bob":   {Username: "bob", Groups: []string{"guests"}},
}

func newTestManager(t *testing.T, store *memStore) *Manager {
	t.Helper()
	if store == nil {
		store = newMemStore()
	}
	m, err := NewManager(Options{
		Store:    store,
		SelfPort: 8080,
		ResolveUser: func(w http.ResponseWriter, r *http.Request) *Identity {
			return testUsers[r.Header.Get("X-Test-User")]
		},
		LookupUser: func(username string) *Identity {
			return testUsers[username]
		},
		LoginURL: func(returnTo string) string {
			return "/login.html?redirect=" + returnTo
		},
		StripCookies: []string{"ao_auth", "ao_acc"},
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m
}

func pathEndpoint(slug string, target string) Endpoint {
	return Endpoint{
		Slug:         slug,
		Name:         slug,
		Target:       target,
		Mode:         ModePath,
		Trusted:      true,
		RootRedirect: true,
		RequireLogin: true,
	}
}

func TestManagerSaveAndReload(t *testing.T) {
	store := newMemStore()
	m := newTestManager(t, store)

	if _, err := m.Save(pathEndpoint("grafana", "127.0.0.1:3000"), true, "admin", "nas.local"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := m.Save(pathEndpoint("grafana", "127.0.0.1:3000"), true, "admin", "nas.local"); err == nil {
		t.Errorf("creating a duplicate slug should fail")
	}
	if _, err := m.Save(pathEndpoint("missing", "127.0.0.1:3000"), false, "admin", "nas.local"); err == nil {
		t.Errorf("updating a missing app should fail")
	}

	updated := pathEndpoint("grafana", "127.0.0.1:3001")
	saved, err := m.Save(updated, false, "someone-else", "nas.local")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if saved.CreatedBy != "admin" {
		t.Errorf("CreatedBy = %q, want it kept as admin", saved.CreatedBy)
	}

	reloaded := newTestManager(t, store)
	ep, ok := reloaded.Get("grafana")
	if !ok {
		t.Fatalf("endpoint not reloaded from the store")
	}
	if ep.Target != "127.0.0.1:3001" {
		t.Errorf("reloaded target = %q", ep.Target)
	}

	if err := reloaded.Delete("grafana"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if reloaded.Count() != 0 {
		t.Errorf("Count after delete = %d", reloaded.Count())
	}
	if rows, _ := store.ListTable(tableName); len(rows) != 0 {
		t.Errorf("store still has %d rows", len(rows))
	}
	if err := reloaded.Delete("grafana"); err == nil {
		t.Errorf("deleting twice should fail")
	}
}

func TestManagerHostnameRules(t *testing.T) {
	m := newTestManager(t, nil)
	sub := func(slug string, host string) Endpoint {
		return Endpoint{Slug: slug, Target: "127.0.0.1:9000", Mode: ModeSubdomain, Hostname: host, PortalOrigin: "https://nas.example.com", RequireLogin: true}
	}
	tests := []struct {
		name    string
		ep      Endpoint
		create  bool
		host    string
		wantErr bool
	}{
		{"first app", sub("one", "one.example.com"), true, "nas.example.com", false},
		{"hostname taken", sub("two", "one.example.com"), true, "nas.example.com", true},
		{"hostname is the portal", sub("three", "nas.example.com"), true, "other.example.com", true},
		{"hostname is the admin's host", sub("four", "four.example.com"), true, "four.example.com:8080", true},
		{"same app keeps its hostname", sub("one", "one.example.com"), false, "nas.example.com", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := m.Save(tt.ep, tt.create, "admin", tt.host)
			if (err != nil) != tt.wantErr {
				t.Errorf("Save err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
	if rt := m.runtimeByHost("ONE.example.com:443"); rt == nil || rt.ep.Slug != "one" {
		t.Errorf("host lookup should ignore case and port")
	}
}

func TestManagerAccessibleBy(t *testing.T) {
	m := newTestManager(t, nil)
	open := pathEndpoint("open", "127.0.0.1:1001")
	staff := pathEndpoint("staff", "127.0.0.1:1002")
	staff.AllowedGroups = []string{"users"}
	public := pathEndpoint("public", "127.0.0.1:1003")
	public.RequireLogin = false
	for _, ep := range []Endpoint{open, staff, public} {
		if _, err := m.Save(ep, true, "admin", "nas.local"); err != nil {
			t.Fatalf("save %s: %v", ep.Slug, err)
		}
	}
	tests := []struct {
		user string
		want int
	}{
		{"admin", 3},
		{"alice", 3},
		{"bob", 2},
		{"", 1},
	}
	for _, tt := range tests {
		t.Run(tt.user, func(t *testing.T) {
			if got := len(m.AccessibleBy(testUsers[tt.user])); got != tt.want {
				t.Errorf("AccessibleBy(%q) = %d apps, want %d", tt.user, got, tt.want)
			}
		})
	}
}

func TestManagerStatsSurviveEdit(t *testing.T) {
	m := newTestManager(t, nil)
	if _, err := m.Save(pathEndpoint("app", "127.0.0.1:1001"), true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}
	m.runtimeBySlug("app").recordLeak("/x")
	if _, err := m.Save(pathEndpoint("app", "127.0.0.1:1002"), false, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}
	s := m.Stats("app")
	if s.Leaks != 1 || len(s.LastLeaks) != 1 || s.LastLeaks[0] != "/x" {
		t.Errorf("stats after edit = %+v", s)
	}
}
