package acn

/*
	ArozOS Cluster Node protocol (ACN) - request signing

	Node-to-node requests do not use user sessions. Every request carries a
	set of headers that identify the sending node and an Ed25519 signature
	over the request method, target, cluster, node, timestamp, nonce and body
	hash. Receivers look the sender up in the membership list (through a
	PeerResolver), check the clock skew, reject replayed nonces and verify the
	signature with the sender's published public key.

	Relayed requests (see RelayPrefix) are signed over the target path with the
	relay prefix removed, so both the relaying node and the final node can
	verify the very same signature.
*/

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	HeaderNode      = "X-Aroz-Node"
	HeaderCluster   = "X-Aroz-Cluster"
	HeaderTimestamp = "X-Aroz-Timestamp"
	HeaderNonce     = "X-Aroz-Nonce"
	HeaderSignature = "X-Aroz-Signature"

	// BasePath is the URL prefix every ACN endpoint lives under on each node.
	BasePath = "/cluster/acn"
	// RelayPrefix is the prefix used to ask a node to forward a request to a
	// node that is only reachable through a tunnel terminating at that node.
	// The full form is RelayPrefix + "/" + targetNodeID + originalPath.
	RelayPrefix = BasePath + "/relay"

	// MaxClockSkew is the accepted difference between sender and receiver clocks.
	MaxClockSkew = 5 * time.Minute
	// MaxSignedBody limits how much of a request body a verifier will buffer.
	MaxSignedBody = 64 << 20
)

var (
	ErrNotSigned      = errors.New("request is not signed")
	ErrUnknownNode    = errors.New("sender is not a member of this cluster")
	ErrWrongCluster   = errors.New("request targets another cluster")
	ErrClockSkew      = errors.New("request timestamp outside the accepted window")
	ErrReplay         = errors.New("request nonce already seen")
	ErrBadSignature   = errors.New("request signature invalid")
	ErrBodyTooLarge   = errors.New("request body exceeds signed body limit")
	ErrPeerNoEndpoint = errors.New("peer has no reachable endpoint")
)

// Peer is the transport-level view of a cluster member.
type Peer struct {
	ID           string
	Name         string
	PublicKey    ed25519.PublicKey
	AdvertiseURL string //Base URL where the peer's HTTP server can be reached, empty for NAT-only nodes
	TunnelVia    string //Node ID that terminates the peer's tunnel when it has no AdvertiseURL
}

// PeerResolver is implemented by the membership layer so the transport can
// look up public keys and endpoints without importing it.
type PeerResolver interface {
	ResolvePeer(nodeID string) (*Peer, bool)
}

// Signer produces the ACN headers for outgoing requests.
type Signer struct {
	NodeID    string
	ClusterID string
	Key       *NodeKey
}

// SignedIdentity is what a verifier learns about a valid request.
type SignedIdentity struct {
	NodeID    string
	ClusterID string
	Peer      *Peer
}

// canonicalString builds the byte string that is signed and verified.
func canonicalString(method, target, clusterID, nodeID, timestamp, nonce string, bodyHash []byte) []byte {
	var b bytes.Buffer
	b.WriteString(strings.ToUpper(method))
	b.WriteByte('\n')
	b.WriteString(target)
	b.WriteByte('\n')
	b.WriteString(clusterID)
	b.WriteByte('\n')
	b.WriteString(nodeID)
	b.WriteByte('\n')
	b.WriteString(timestamp)
	b.WriteByte('\n')
	b.WriteString(nonce)
	b.WriteByte('\n')
	b.WriteString(hex.EncodeToString(bodyHash))
	return b.Bytes()
}

// SignedTarget returns the path (plus query when present) a request is signed over.
func SignedTarget(path string, rawQuery string) string {
	if rawQuery == "" {
		return path
	}
	return path + "?" + rawQuery
}

// StripRelayPrefix removes the relay routing prefix from a request path and
// returns the target node ID and the original path. ok is false when the path
// is not a relay path.
func StripRelayPrefix(path string) (targetNode string, originalPath string, ok bool) {
	if !strings.HasPrefix(path, RelayPrefix+"/") {
		return "", path, false
	}
	rest := strings.TrimPrefix(path, RelayPrefix+"/")
	idx := strings.Index(rest, "/")
	if idx <= 0 {
		return "", path, false
	}
	return rest[:idx], rest[idx:], true
}

func newNonce() string {
	buf := make([]byte, 16)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

// Sign adds the ACN authentication headers to req. target must be the path
// (and query) the receiver will verify against, which for relayed requests is
// the path without the relay prefix. body is the full request body.
func (s *Signer) Sign(req *http.Request, target string, body []byte) {
	s.SignAt(req, target, body, time.Now())
}

// SignAt is Sign with an explicit timestamp, used by tests.
func (s *Signer) SignAt(req *http.Request, target string, body []byte, at time.Time) {
	ts := strconv.FormatInt(at.Unix(), 10)
	nonce := newNonce()
	sum := sha256.Sum256(body)
	msg := canonicalString(req.Method, target, s.ClusterID, s.NodeID, ts, nonce, sum[:])
	sig := ed25519.Sign(s.Key.Private, msg)

	req.Header.Set(HeaderNode, s.NodeID)
	req.Header.Set(HeaderCluster, s.ClusterID)
	req.Header.Set(HeaderTimestamp, ts)
	req.Header.Set(HeaderNonce, nonce)
	req.Header.Set(HeaderSignature, base64.StdEncoding.EncodeToString(sig))
}

// nonceCache remembers recently seen nonces for replay protection.
type nonceCache struct {
	mu      sync.Mutex
	seen    map[string]int64 //nonce -> expiry unix time
	lastGC  int64
	ttl     int64
	maxSize int
}

func newNonceCache(ttl time.Duration) *nonceCache {
	return &nonceCache{
		seen:    map[string]int64{},
		ttl:     int64(ttl.Seconds()),
		maxSize: 100000,
	}
}

// remember returns false when the nonce was already recorded.
func (c *nonceCache) remember(nonce string, now int64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now-c.lastGC > 60 || len(c.seen) > c.maxSize {
		for k, exp := range c.seen {
			if exp < now {
				delete(c.seen, k)
			}
		}
		c.lastGC = now
	}
	if _, exists := c.seen[nonce]; exists {
		return false
	}
	c.seen[nonce] = now + c.ttl
	return true
}

// Verifier checks incoming ACN requests.
type Verifier struct {
	ClusterID func() string //Returns the cluster this node belongs to, empty when not in a cluster
	Resolver  PeerResolver
	nonces    *nonceCache
	Now       func() time.Time
}

// NewVerifier creates a verifier backed by the given resolver.
func NewVerifier(clusterID func() string, resolver PeerResolver) *Verifier {
	return &Verifier{
		ClusterID: clusterID,
		Resolver:  resolver,
		nonces:    newNonceCache(MaxClockSkew * 2),
		Now:       time.Now,
	}
}

// ReadBody buffers and restores a request body so it can be hashed and then
// consumed by the handler.
func ReadBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return []byte{}, nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxSignedBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > MaxSignedBody {
		return nil, ErrBodyTooLarge
	}
	r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, nil
}

// Verify validates the ACN headers of r against target (the signed path) and
// body and returns the identity of the sender. The request body is left
// readable for the handler.
func (v *Verifier) Verify(r *http.Request, target string, body []byte) (*SignedIdentity, error) {
	nodeID := r.Header.Get(HeaderNode)
	clusterID := r.Header.Get(HeaderCluster)
	ts := r.Header.Get(HeaderTimestamp)
	nonce := r.Header.Get(HeaderNonce)
	sigEnc := r.Header.Get(HeaderSignature)
	if nodeID == "" || clusterID == "" || ts == "" || nonce == "" || sigEnc == "" {
		return nil, ErrNotSigned
	}

	localCluster := v.ClusterID()
	if localCluster == "" || localCluster != clusterID {
		return nil, ErrWrongCluster
	}

	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return nil, ErrClockSkew
	}
	now := v.Now().Unix()
	skew := now - tsInt
	if skew < 0 {
		skew = -skew
	}
	if skew > int64(MaxClockSkew.Seconds()) {
		return nil, ErrClockSkew
	}

	peer, ok := v.Resolver.ResolvePeer(nodeID)
	if !ok || peer == nil || len(peer.PublicKey) != ed25519.PublicKeySize {
		return nil, ErrUnknownNode
	}

	sig, err := base64.StdEncoding.DecodeString(sigEnc)
	if err != nil {
		return nil, ErrBadSignature
	}
	sum := sha256.Sum256(body)
	msg := canonicalString(r.Method, target, clusterID, nodeID, ts, nonce, sum[:])
	if !ed25519.Verify(peer.PublicKey, msg, sig) {
		return nil, ErrBadSignature
	}

	//Signature is valid, only now spend the nonce so bad requests cannot poison the cache
	if !v.nonces.remember(nodeID+":"+nonce, now) {
		return nil, ErrReplay
	}

	return &SignedIdentity{NodeID: nodeID, ClusterID: clusterID, Peer: peer}, nil
}

// VerifyRequest is the common entry point for HTTP handlers: it buffers the
// body, derives the signed target (stripping the relay prefix when present)
// and verifies the request.
func (v *Verifier) VerifyRequest(r *http.Request) (*SignedIdentity, []byte, error) {
	body, err := ReadBody(r)
	if err != nil {
		return nil, nil, err
	}
	path := r.URL.Path
	if _, original, ok := StripRelayPrefix(path); ok {
		path = original
	}
	identity, err := v.Verify(r, SignedTarget(path, r.URL.RawQuery), body)
	if err != nil {
		return nil, nil, err
	}
	return identity, body, nil
}
