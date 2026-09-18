package acn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
	Test helpers
*/

type staticResolver struct {
	mu    sync.RWMutex
	peers map[string]*Peer
}

func newStaticResolver() *staticResolver {
	return &staticResolver{peers: map[string]*Peer{}}
}

func (s *staticResolver) add(p *Peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.peers[p.ID] = p
}

func (s *staticResolver) ResolvePeer(id string) (*Peer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.peers[id]
	return p, ok
}

type testNode struct {
	id       string
	key      *NodeKey
	signer   *Signer
	verifier *Verifier
	hub      *TunnelHub
	server   *Server
	resolver *staticResolver
	http     *httptest.Server
	tr       *Transport
}

func newTestNode(t *testing.T, id string, cluster string, resolver *staticResolver) *testNode {
	t.Helper()
	key, err := GenerateNodeKey()
	if err != nil {
		t.Fatalf("GenerateNodeKey: %v", err)
	}
	n := &testNode{id: id, key: key, resolver: resolver}
	n.signer = &Signer{NodeID: id, ClusterID: cluster, Key: key}
	n.verifier = NewVerifier(func() string { return cluster }, resolver)
	n.hub = NewTunnelHub(n.verifier)
	n.server = NewServer(n.verifier, n.hub, "test")
	n.http = httptest.NewServer(n.server)
	n.tr = NewTransport(n.signer, resolver, n.hub, false)
	t.Cleanup(func() {
		n.hub.Close()
		n.http.Close()
	})
	return n
}

func (n *testNode) peer(advertise bool, tunnelVia string) *Peer {
	p := &Peer{ID: n.id, Name: n.id, PublicKey: n.key.Public, TunnelVia: tunnelVia}
	if advertise {
		p.AdvertiseURL = n.http.URL
	}
	return p
}

/*
	Keys
*/

func TestNodeKeyRoundTrip(t *testing.T) {
	key, err := GenerateNodeKey()
	if err != nil {
		t.Fatalf("GenerateNodeKey: %v", err)
	}
	parsed, err := ParseNodeKey(key.Encode())
	if err != nil {
		t.Fatalf("ParseNodeKey: %v", err)
	}
	if parsed.PublicKeyString() != key.PublicKeyString() {
		t.Errorf("public key mismatch after round trip")
	}
	pub, err := DecodePublicKey(key.PublicKeyString())
	if err != nil {
		t.Fatalf("DecodePublicKey: %v", err)
	}
	if string(pub) != string(key.Public) {
		t.Errorf("decoded public key differs")
	}
}

func TestLoadOrCreateNodeKeyPersists(t *testing.T) {
	dir := t.TempDir()
	keyfile := filepath.Join(dir, "sub", "node.key")
	first, err := LoadOrCreateNodeKey(keyfile)
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	second, err := LoadOrCreateNodeKey(keyfile)
	if err != nil {
		t.Fatalf("second load: %v", err)
	}
	if first.PublicKeyString() != second.PublicKeyString() {
		t.Errorf("key not persisted: %s != %s", first.PublicKeyString(), second.PublicKeyString())
	}
}

func TestParseNodeKeyInvalid(t *testing.T) {
	cases := []string{"", "zz", "abcd"}
	for _, c := range cases {
		if _, err := ParseNodeKey(c); err == nil {
			t.Errorf("ParseNodeKey(%q) expected error", c)
		}
	}
	if _, err := DecodePublicKey("not-base64!"); err == nil {
		t.Errorf("DecodePublicKey expected error")
	}
}

/*
	Signing
*/

func TestSignVerifyRoundTrip(t *testing.T) {
	resolver := newStaticResolver()
	a := newTestNode(t, "node-a", "cluster-1", resolver)
	resolver.add(a.peer(true, ""))

	body := []byte(`{"hello":"world"}`)
	req := httptest.NewRequest(http.MethodPost, "/cluster/acn/ping?x=1", strings.NewReader(string(body)))
	a.signer.Sign(req, SignedTarget("/cluster/acn/ping", "x=1"), body)

	id, got, err := a.verifier.VerifyRequest(req)
	if err != nil {
		t.Fatalf("VerifyRequest: %v", err)
	}
	if id.NodeID != "node-a" {
		t.Errorf("expected sender node-a, got %s", id.NodeID)
	}
	if string(got) != string(body) {
		t.Errorf("body not preserved")
	}
}

func TestVerifyRejects(t *testing.T) {
	resolver := newStaticResolver()
	a := newTestNode(t, "node-a", "cluster-1", resolver)
	resolver.add(a.peer(true, ""))
	stranger := newTestNode(t, "node-x", "cluster-1", resolver) //never added to resolver
	other := newTestNode(t, "node-b", "cluster-2", resolver)
	resolver.add(other.peer(true, ""))

	body := []byte("payload")
	mk := func() *http.Request {
		return httptest.NewRequest(http.MethodPost, "/cluster/acn/ping", strings.NewReader(string(body)))
	}

	tests := []struct {
		name string
		req  func() *http.Request
		want error
	}{
		{"unsigned", func() *http.Request { return mk() }, ErrNotSigned},
		{"unknown node", func() *http.Request {
			r := mk()
			stranger.signer.Sign(r, "/cluster/acn/ping", body)
			return r
		}, ErrUnknownNode},
		{"wrong cluster", func() *http.Request {
			r := mk()
			other.signer.Sign(r, "/cluster/acn/ping", body)
			return r
		}, ErrWrongCluster},
		{"clock skew", func() *http.Request {
			r := mk()
			a.signer.SignAt(r, "/cluster/acn/ping", body, time.Now().Add(-MaxClockSkew-time.Minute))
			return r
		}, ErrClockSkew},
		{"tampered body", func() *http.Request {
			r := mk()
			a.signer.Sign(r, "/cluster/acn/ping", []byte("different"))
			return r
		}, ErrBadSignature},
		{"wrong path", func() *http.Request {
			r := mk()
			a.signer.Sign(r, "/cluster/acn/other", body)
			return r
		}, ErrBadSignature},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := a.verifier.VerifyRequest(tc.req())
			if err != tc.want {
				t.Errorf("expected %v, got %v", tc.want, err)
			}
		})
	}
}

func TestVerifyRejectsReplay(t *testing.T) {
	resolver := newStaticResolver()
	a := newTestNode(t, "node-a", "cluster-1", resolver)
	resolver.add(a.peer(true, ""))

	body := []byte("once")
	req := httptest.NewRequest(http.MethodPost, "/cluster/acn/ping", strings.NewReader(string(body)))
	a.signer.Sign(req, "/cluster/acn/ping", body)
	headers := req.Header.Clone()

	if _, _, err := a.verifier.VerifyRequest(req); err != nil {
		t.Fatalf("first verify: %v", err)
	}
	replay := httptest.NewRequest(http.MethodPost, "/cluster/acn/ping", strings.NewReader(string(body)))
	replay.Header = headers
	if _, _, err := a.verifier.VerifyRequest(replay); err != ErrReplay {
		t.Errorf("expected ErrReplay, got %v", err)
	}
}

func TestStripRelayPrefix(t *testing.T) {
	tests := []struct {
		path     string
		node     string
		original string
		ok       bool
	}{
		{"/cluster/acn/relay/node-b/cluster/acn/ping", "node-b", "/cluster/acn/ping", true},
		{"/cluster/acn/relay/node-b/cluster/acn/a/b", "node-b", "/cluster/acn/a/b", true},
		{"/cluster/acn/ping", "", "/cluster/acn/ping", false},
		{"/cluster/acn/relay/", "", "/cluster/acn/relay/", false},
		{"/cluster/acn/relay/node-b", "", "/cluster/acn/relay/node-b", false},
	}
	for _, tc := range tests {
		node, original, ok := StripRelayPrefix(tc.path)
		if node != tc.node || original != tc.original || ok != tc.ok {
			t.Errorf("StripRelayPrefix(%q) = (%q,%q,%v) want (%q,%q,%v)", tc.path, node, original, ok, tc.node, tc.original, tc.ok)
		}
	}
}

/*
	Frames
*/

func TestFrameRoundTrip(t *testing.T) {
	hdr := frameHeader{ID: "1", Method: "POST", Target: "/cluster/acn/ping?q=1", Headers: map[string][]string{"X-Test": {"a", "b"}}}
	body := []byte("body-bytes")
	data, err := encodeFrame(frameKindRequest, hdr, body)
	if err != nil {
		t.Fatalf("encodeFrame: %v", err)
	}
	kind, got, gotBody, err := decodeFrame(data)
	if err != nil {
		t.Fatalf("decodeFrame: %v", err)
	}
	if kind != frameKindRequest || got.ID != "1" || got.Target != hdr.Target || string(gotBody) != "body-bytes" {
		t.Errorf("frame mismatch: %v %+v %q", kind, got, gotBody)
	}
	if len(got.Headers["X-Test"]) != 2 {
		t.Errorf("headers not preserved")
	}
	if _, _, _, err := decodeFrame([]byte{1, 0}); err == nil {
		t.Errorf("short frame should fail")
	}
	if _, err := encodeFrame(frameKindRequest, hdr, make([]byte, TunnelMaxFrame)); err != ErrFrameTooLarge {
		t.Errorf("oversized frame should fail, got %v", err)
	}
}

func TestWebSocketURL(t *testing.T) {
	tests := []struct {
		in   string
		want string
		err  bool
	}{
		{"https://node.example.com", "wss://node.example.com/cluster/acn/tunnel", false},
		{"http://10.0.0.2:8080/", "ws://10.0.0.2:8080/cluster/acn/tunnel", false},
		{"ftp://x", "", true},
	}
	for _, tc := range tests {
		got, err := WebSocketURL(tc.in, TunnelPath)
		if (err != nil) != tc.err {
			t.Errorf("WebSocketURL(%q) err=%v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("WebSocketURL(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

/*
	Transport routes
*/

func TestTransportDirect(t *testing.T) {
	resolver := newStaticResolver()
	a := newTestNode(t, "node-a", "cluster-1", resolver)
	b := newTestNode(t, "node-b", "cluster-1", resolver)
	resolver.add(a.peer(true, ""))
	resolver.add(b.peer(true, ""))

	var out map[string]interface{}
	err := a.tr.DoJSON(context.Background(), "node-b", http.MethodPost, BasePath+"/ping", map[string]string{"k": "v"}, &out)
	if err != nil {
		t.Fatalf("DoJSON: %v", err)
	}
	if out["node"] != "node-a" {
		t.Errorf("ping should echo sender, got %v", out)
	}

	//Anonymous hello
	resp, err := a.tr.DoURL(context.Background(), b.http.URL, http.MethodGet, BasePath+"/hello", nil, false)
	if err != nil || resp.Status != 200 {
		t.Fatalf("hello: %v %v", err, resp)
	}
	if !strings.Contains(string(resp.Body), `"acn":true`) {
		t.Errorf("hello body unexpected: %s", resp.Body)
	}
}

func TestTransportUnknownPeer(t *testing.T) {
	resolver := newStaticResolver()
	a := newTestNode(t, "node-a", "cluster-1", resolver)
	if _, err := a.tr.Do(context.Background(), "ghost", http.MethodPost, BasePath+"/ping", nil); err != ErrUnknownNode {
		t.Errorf("expected ErrUnknownNode, got %v", err)
	}
	resolver.add(&Peer{ID: "nat-only", PublicKey: a.key.Public})
	if _, err := a.tr.Do(context.Background(), "nat-only", http.MethodPost, BasePath+"/ping", nil); err != ErrPeerNoEndpoint {
		t.Errorf("expected ErrPeerNoEndpoint, got %v", err)
	}
}

// connectTunnel attaches nat (no URL) to host and waits for the hub to see it.
func connectTunnel(t *testing.T, nat *testNode, host *testNode) *TunnelClient {
	t.Helper()
	client := &TunnelClient{
		Signer:  nat.signer,
		Handler: nat.server,
		PickHost: func() (TunnelHost, bool) {
			return TunnelHost{NodeID: host.id, URL: host.http.URL}, true
		},
	}
	client.Start()
	t.Cleanup(client.Stop)
	deadline := time.Now().Add(5 * time.Second)
	for !host.hub.Connected(nat.id) {
		if time.Now().After(deadline) {
			t.Fatalf("tunnel from %s to %s never connected", nat.id, host.id)
		}
		time.Sleep(20 * time.Millisecond)
	}
	return client
}

func TestTransportTunnelAndRelay(t *testing.T) {
	resolver := newStaticResolver()
	host := newTestNode(t, "node-host", "cluster-1", resolver)
	nat := newTestNode(t, "node-nat", "cluster-1", resolver)
	other := newTestNode(t, "node-other", "cluster-1", resolver)
	resolver.add(host.peer(true, ""))
	resolver.add(other.peer(true, ""))
	resolver.add(nat.peer(false, host.id))

	client := connectTunnel(t, nat, host)
	if ok, h := client.Status(); !ok || h.NodeID != host.id {
		t.Fatalf("client status wrong: %v %+v", ok, h)
	}

	//Host reaches nat over its own tunnel
	var out map[string]interface{}
	if err := host.tr.DoJSON(context.Background(), nat.id, http.MethodPost, BasePath+"/ping", map[string]int{"n": 1}, &out); err != nil {
		t.Fatalf("host->nat via tunnel: %v", err)
	}
	if out["node"] != host.id {
		t.Errorf("nat should see host as sender, got %v", out)
	}

	//Other reaches nat by relaying through host
	out = nil
	if err := other.tr.DoJSON(context.Background(), nat.id, http.MethodPost, BasePath+"/ping?via=relay", map[string]int{"n": 2}, &out); err != nil {
		t.Fatalf("other->nat via relay: %v", err)
	}
	if out["node"] != other.id {
		t.Errorf("nat should see other as original sender, got %v", out)
	}

	//Nat reaches other directly (other has a URL)
	out = nil
	if err := nat.tr.DoJSON(context.Background(), other.id, http.MethodPost, BasePath+"/ping", nil, &out); err != nil {
		t.Fatalf("nat->other direct: %v", err)
	}

	//Relay refuses non-ACN paths
	req, _ := http.NewRequest(http.MethodGet, host.http.URL+RelayPrefix+"/"+nat.id+"/system/secret", nil)
	other.signer.Sign(req, "/system/secret", []byte{})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("relay request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("relay of non-ACN path should be rejected, got %d", resp.StatusCode)
	}

	//Drop the tunnel: host can no longer reach nat, relay returns bad gateway
	client.Stop()
	deadline := time.Now().Add(5 * time.Second)
	for host.hub.Connected(nat.id) {
		if time.Now().After(deadline) {
			t.Fatalf("tunnel did not close")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := host.tr.Do(context.Background(), nat.id, http.MethodPost, BasePath+"/ping", nil); err != ErrTunnelNotConnected {
		t.Errorf("expected ErrTunnelNotConnected, got %v", err)
	}
	r, err := other.tr.Do(context.Background(), nat.id, http.MethodPost, BasePath+"/ping", nil)
	if err != nil {
		t.Fatalf("relay after close: %v", err)
	}
	if r.Status != http.StatusBadGateway {
		t.Errorf("relay after close expected 502, got %d", r.Status)
	}
}

func TestTunnelRejectsUnsignedUpgrade(t *testing.T) {
	resolver := newStaticResolver()
	host := newTestNode(t, "node-host", "cluster-1", resolver)
	resp, err := http.Get(host.http.URL + TunnelPath)
	if err != nil {
		t.Fatalf("GET tunnel: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unsigned tunnel upgrade expected 401, got %d", resp.StatusCode)
	}
}

func TestTunnelClientReconnects(t *testing.T) {
	resolver := newStaticResolver()
	host := newTestNode(t, "node-host", "cluster-1", resolver)
	nat := newTestNode(t, "node-nat", "cluster-1", resolver)
	resolver.add(host.peer(true, ""))
	resolver.add(nat.peer(false, host.id))

	client := connectTunnel(t, nat, host)
	client.Reconnect() //drops the socket, loop must dial again
	deadline := time.Now().Add(10 * time.Second)
	for {
		//First wait for the drop to be observed on both ends
		if ok, _ := client.Status(); !ok && !host.hub.Connected(nat.id) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("tunnel did not drop after Reconnect")
		}
		time.Sleep(20 * time.Millisecond)
	}
	for {
		if ok, _ := client.Status(); ok && host.hub.Connected(nat.id) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("tunnel did not reconnect")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := host.tr.Do(context.Background(), nat.id, http.MethodPost, BasePath+"/ping", nil); err != nil {
		t.Errorf("ping after reconnect: %v", err)
	}
}

func TestResponseError(t *testing.T) {
	if (&Response{Status: 200}).Error() != nil {
		t.Errorf("200 should not be an error")
	}
	if (&Response{Status: 500, Body: []byte("boom")}).Error() == nil {
		t.Errorf("500 should be an error")
	}
	var nilResp *Response
	if nilResp.Error() == nil {
		t.Errorf("nil response should be an error")
	}
}
