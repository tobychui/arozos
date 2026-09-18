package identity

import (
	"net/http/httptest"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/cluster/membership"
)

/*
	Fake account store
*/

type fakeAccounts struct {
	mu     sync.Mutex
	hashes map[string]string
	groups map[string][]string
	known  map[string]bool //groups that exist on this node
}

func newFakeAccounts(groups ...string) *fakeAccounts {
	f := &fakeAccounts{hashes: map[string]string{}, groups: map[string][]string{}, known: map[string]bool{}}
	for _, g := range groups {
		f.known[g] = true
	}
	return f
}

func (f *fakeAccounts) add(user, password string, groups ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hashes[user] = auth.Hash(password)
	f.groups[user] = groups
}

func (f *fakeAccounts) UserExists(u string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hashes[u] != ""
}
func (f *fakeAccounts) PasswordHash(u string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hashes[u], nil
}
func (f *fakeAccounts) SetPasswordHash(u, h string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hashes[u] = h
	return nil
}
func (f *fakeAccounts) Groups(u string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.groups[u]...), nil
}
func (f *fakeAccounts) SetGroups(u string, g []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.groups[u] = append([]string{}, g...)
	return nil
}
func (f *fakeAccounts) ListUsers() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for u := range f.hashes {
		out = append(out, u)
	}
	sort.Strings(out)
	return out
}
func (f *fakeAccounts) DeleteUser(u string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.hashes, u)
	delete(f.groups, u)
	return nil
}
func (f *fakeAccounts) GroupExists(g string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.known[g]
}

/*
	Node helper: membership manager + identity service + HTTP server
*/

type testNode struct {
	m   *membership.Manager
	id  *Manager
	acc *fakeAccounts
	srv *httptest.Server
}

func newTestNode(t *testing.T, nodeID string, reachable bool, groups ...string) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID:      nodeID,
		DBFile:      filepath.Join(dir, "cluster.db"),
		KeyFile:     filepath.Join(dir, "node.key"),
		Version:     "test",
		DefaultName: "Node " + nodeID,
	})
	if err != nil {
		t.Fatalf("NewManager(%s): %v", nodeID, err)
	}
	acc := newFakeAccounts(groups...)
	id, err := New(Option{Membership: m, Accounts: acc, SyncInterval: time.Hour})
	if err != nil {
		t.Fatalf("identity.New(%s): %v", nodeID, err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	if reachable {
		cfg := m.Config()
		cfg.AdvertiseURL = srv.URL
		if err := m.UpdateConfig(cfg); err != nil {
			t.Fatalf("UpdateConfig: %v", err)
		}
	}
	t.Cleanup(func() {
		id.Close()
		m.Close()
		srv.Close()
	})
	return &testNode{m: m, id: id, acc: acc, srv: srv}
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// twoNodeCluster returns an origin (a) and a member (b) already joined.
func twoNodeCluster(t *testing.T) (*testNode, *testNode) {
	t.Helper()
	a := newTestNode(t, "node-a", true, "administrator", "default")
	b := newTestNode(t, "node-b", true, "administrator", "default")
	if _, err := a.m.CreateCluster("Home"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	token, _, _ := a.m.NewJoinToken(time.Hour)
	if _, err := b.m.JoinCluster(token); err != nil {
		t.Fatalf("JoinCluster: %v", err)
	}
	waitFor(t, "b to see a", 5*time.Second, func() bool {
		for _, n := range b.m.NodeViews() {
			if n.ID == "node-a" && n.State == membership.StateOnline {
				return true
			}
		}
		return false
	})
	return a, b
}

/*
	Tests
*/

func TestOriginSettingReplicates(t *testing.T) {
	a, b := twoNodeCluster(t)
	if _, self := b.id.Origin(); self {
		t.Fatalf("b must not be origin by default")
	}
	if err := a.m.SetIdentityOrigin("ghost"); err != membership.ErrNodeNotFound {
		t.Errorf("unknown origin accepted: %v", err)
	}
	if err := a.m.SetIdentityOrigin("node-a"); err != nil {
		t.Fatalf("SetIdentityOrigin: %v", err)
	}
	waitFor(t, "b to learn the origin", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })
	if origin, self := a.id.Origin(); origin != "node-a" || !self {
		t.Errorf("a should be origin: %s %v", origin, self)
	}
	st := b.id.Status()
	if !st.Enabled || st.IsOrigin || st.OriginName != "Node node-a" {
		t.Errorf("b status wrong: %+v", st)
	}

	//Disable again from the member side and check it flows back
	if err := b.m.SetIdentityOrigin(""); err != nil {
		t.Fatalf("clear origin: %v", err)
	}
	waitFor(t, "a to learn the origin was cleared", 5*time.Second, func() bool { return a.m.IdentityOrigin() == "" })
}

func TestForwardAuth(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.acc.add("toby", "secret", "administrator", "photographers")
	a.acc.add("guest", "pw", "visitors") //group unknown on b

	//No origin: b has no opinion
	if res := b.id.ForwardAuth("toby", auth.Hash("secret")); res.Decided {
		t.Errorf("without origin ForwardAuth must not decide")
	}

	a.m.SetIdentityOrigin("node-a")
	waitFor(t, "origin replicated", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })

	//Origin itself never forwards
	if res := a.id.ForwardAuth("toby", auth.Hash("secret")); res.Decided {
		t.Errorf("origin must decide locally")
	}

	//Valid login on the member mirrors the account with the groups b knows
	res := b.id.ForwardAuth("toby", auth.Hash("secret"))
	if !res.Decided || !res.Accepted {
		t.Fatalf("valid login rejected: %+v", res)
	}
	if !b.acc.UserExists("toby") || !b.id.IsManaged("toby") {
		t.Errorf("account not mirrored on b")
	}
	groups, _ := b.acc.Groups("toby")
	if len(groups) != 1 || groups[0] != "administrator" {
		t.Errorf("groups not filtered to local ones: %v", groups)
	}

	//Wrong password: decided and rejected, no fallback
	res = b.id.ForwardAuth("toby", auth.Hash("nope"))
	if !res.Decided || res.Accepted {
		t.Errorf("wrong password accepted: %+v", res)
	}

	//Unknown user
	res = b.id.ForwardAuth("nobody", auth.Hash("x"))
	if !res.Decided || res.Accepted {
		t.Errorf("unknown user accepted: %+v", res)
	}

	//User whose groups do not exist on b
	res = b.id.ForwardAuth("guest", auth.Hash("pw"))
	if !res.Decided || res.Accepted || res.Reason == "" {
		t.Errorf("user without local groups should be rejected with a reason: %+v", res)
	}

	//Local-only account on b keeps its own groups but the origin decides the password
	b.acc.add("local", "localpw", "default")
	a.acc.add("local", "originpw", "administrator")
	res = b.id.ForwardAuth("local", auth.Hash("originpw"))
	if !res.Decided || !res.Accepted {
		t.Errorf("origin password for shadowed account should be accepted: %+v", res)
	}
	if b.id.IsManaged("local") {
		t.Errorf("local-only account must not become managed")
	}
	g, _ := b.acc.Groups("local")
	if len(g) != 1 || g[0] != "default" {
		t.Errorf("local-only account groups were overwritten: %v", g)
	}
}

func TestForwardAuthFallsBackWhenOriginDown(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.acc.add("toby", "secret", "administrator")
	a.m.SetIdentityOrigin("node-a")
	waitFor(t, "origin replicated", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })
	if err := b.id.SyncNow(); err != nil {
		t.Fatalf("SyncNow: %v", err)
	}
	if !b.acc.UserExists("toby") {
		t.Fatalf("account not replicated")
	}

	a.srv.Close() //origin goes away
	res := b.id.ForwardAuth("toby", auth.Hash("secret"))
	if res.Decided {
		t.Errorf("unreachable origin must fall back to local accounts, got %+v", res)
	}
	//and the local replicated hash still validates
	h, _ := b.acc.PasswordHash("toby")
	if h != auth.Hash("secret") {
		t.Errorf("replicated hash wrong")
	}
	if st := b.id.Status(); st.LastForwardError == "" {
		t.Errorf("status should report the forward error")
	}
}

func TestDirectorySync(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.acc.add("toby", "s1", "administrator")
	a.acc.add("alice", "s2", "default", "unknown-on-b")
	a.acc.add("bob", "s3", "unknown-on-b")
	b.acc.add("alice", "mine", "default") //local-only account shadowing an origin one

	//Directory is refused unless the node is the origin
	if err := b.id.SyncNow(); err != nil {
		t.Errorf("sync without origin should be a no-op, got %v", err)
	}
	a.m.SetIdentityOrigin("node-a")
	waitFor(t, "origin replicated", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })

	if err := b.id.SyncNow(); err != nil {
		t.Fatalf("SyncNow: %v", err)
	}
	if !b.acc.UserExists("toby") || !b.id.IsManaged("toby") {
		t.Errorf("toby not replicated")
	}
	if h, _ := b.acc.PasswordHash("alice"); h != auth.Hash("mine") {
		t.Errorf("local-only alice was overwritten")
	}
	if b.acc.UserExists("bob") {
		t.Errorf("bob has no local group and must be skipped")
	}
	st := b.id.Status()
	if len(st.Skipped) != 1 || st.Skipped[0] != "bob" || len(st.Conflicts) != 1 || st.Conflicts[0] != "alice" {
		t.Errorf("status skipped/conflicts wrong: %+v", st)
	}
	if st.ManagedAccounts != 1 || st.LastSync == 0 {
		t.Errorf("status counts wrong: %+v", st)
	}

	//Password change on the origin propagates, removal on the origin removes the mirror
	a.acc.add("toby", "s1-new", "administrator")
	a.acc.add("carol", "s4", "default")
	if err := b.id.SyncNow(); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if h, _ := b.acc.PasswordHash("toby"); h != auth.Hash("s1-new") {
		t.Errorf("password change not replicated")
	}
	if !b.acc.UserExists("carol") {
		t.Errorf("new account not replicated")
	}
	a.acc.DeleteUser("carol")
	if err := b.id.SyncNow(); err != nil {
		t.Fatalf("third sync: %v", err)
	}
	if b.acc.UserExists("carol") || b.id.IsManaged("carol") {
		t.Errorf("removed origin account still present on member")
	}

	//Managed markers survive a restart of the identity service (rebuild the
	//in-memory set from the database without re-registering endpoints)
	id2 := &Manager{m: b.m, acc: b.acc, db: b.m.DB(), managed: map[string]bool{}}
	id2.loadManaged()
	if !id2.IsManaged("toby") {
		t.Errorf("managed marker not persisted")
	}
}

func TestPasswordChangeForwardedToOrigin(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.acc.add("toby", "old", "administrator")
	a.m.SetIdentityOrigin("node-a")
	waitFor(t, "origin replicated", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })
	if err := b.id.SyncNow(); err != nil {
		t.Fatalf("SyncNow: %v", err)
	}

	newHash := auth.Hash("new")
	b.acc.SetPasswordHash("toby", newHash)
	b.id.NotifyPasswordChanged("toby", newHash)
	waitFor(t, "origin to receive the new hash", 5*time.Second, func() bool {
		h, _ := a.acc.PasswordHash("toby")
		return h == newHash
	})

	//Local-only accounts are never forwarded
	b.acc.add("localonly", "x", "default")
	b.id.NotifyPasswordChanged("localonly", auth.Hash("y"))
	time.Sleep(200 * time.Millisecond)
	if a.acc.UserExists("localonly") {
		t.Errorf("local-only account leaked to origin")
	}
}

func TestOriginEndpointsRefuseOnNonOrigin(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.m.SetIdentityOrigin("node-a")
	waitFor(t, "origin replicated", 5*time.Second, func() bool { return b.m.IdentityOrigin() == "node-a" })
	//Ask b (not the origin) for a directory: must be refused
	var dir Directory
	err := a.m.Transport().DoJSON(t.Context(), "node-b", "GET", "/cluster/acn/auth/directory", nil, &dir)
	if err == nil {
		t.Errorf("non-origin served a directory")
	}
}

func TestAssertions(t *testing.T) {
	a, b := twoNodeCluster(t)
	a.acc.add("toby", "s", "administrator", "photographers")

	if _, err := a.id.Issue("bad/name", time.Minute); err == nil {
		t.Errorf("invalid username accepted")
	}
	token, err := a.id.Issue("toby", time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	//b verifies with a's published key
	as, err := b.id.Verify(token)
	if err != nil {
		t.Fatalf("Verify on b: %v", err)
	}
	if as.User != "toby" || as.Issuer != "node-a" || len(as.Groups) != 2 {
		t.Errorf("assertion content wrong: %+v", as)
	}
	//a verifies its own
	if _, err := a.id.Verify(token); err != nil {
		t.Errorf("self verify: %v", err)
	}

	//Tampered payload
	if _, err := b.id.Verify("eyJ1IjoieCJ9." + token[len(token)-86:]); err == nil {
		t.Errorf("tampered assertion accepted")
	}
	if _, err := b.id.Verify("garbage"); err != ErrAssertionInvalid {
		t.Errorf("garbage should be invalid, got %v", err)
	}

	//Expired
	if _, err := b.id.verifyAt(token, time.Now().Add(2*time.Minute)); err != ErrAssertionExpired {
		t.Errorf("expired assertion should fail, got %v", err)
	}

	//Unknown issuer: a node outside the cluster
	stranger := newTestNode(t, "node-x", true, "default")
	stranger.m.CreateCluster("Other")
	stranger.acc.add("toby", "s", "default")
	foreign, err := stranger.id.Issue("toby", time.Minute)
	if err != nil {
		t.Fatalf("foreign issue: %v", err)
	}
	if _, err := b.id.Verify(foreign); err == nil {
		t.Errorf("assertion from another cluster accepted")
	}

	//Header round trip
	req := httptest.NewRequest("POST", "/cluster/acn/x", nil)
	if err := a.id.Attach(req, "toby"); err != nil {
		t.Fatalf("Attach: %v", err)
	}
	if got, err := b.id.FromRequest(req); err != nil || got.User != "toby" {
		t.Errorf("FromRequest: %v %+v", err, got)
	}
	if _, err := b.id.FromRequest(httptest.NewRequest("GET", "/", nil)); err == nil {
		t.Errorf("missing header accepted")
	}
}

func TestValidUsername(t *testing.T) {
	tests := map[string]bool{"toby": true, "": false, "a/b": false, "a\\b": false, "x\x00": false}
	for u, want := range tests {
		if got := validUsername(u); got != want {
			t.Errorf("validUsername(%q)=%v want %v", u, got, want)
		}
	}
}
