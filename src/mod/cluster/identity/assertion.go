package identity

/*
	ArozOS Cluster - signed user assertions

	When node A performs an action on node B on behalf of a logged-in user,
	it attaches an assertion: a short-lived statement "user U with groups G"
	signed with A's node key. B verifies it with A's published public key
	from the membership list, so no node ever has to contact the identity
	origin to trust a cross-node request.

	Encoding: base64url(JSON payload) "." base64url(Ed25519 signature)
	The signature covers the literal payload bytes.
*/

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

const (
	// HeaderUser carries an assertion on node-to-node requests.
	HeaderUser = "X-Aroz-User"
	// DefaultAssertionTTL is how long an assertion stays valid.
	DefaultAssertionTTL = 5 * time.Minute
	assertionMaxSkew    = 5 * time.Minute
)

var (
	ErrAssertionInvalid = errors.New("user assertion invalid")
	ErrAssertionExpired = errors.New("user assertion expired")
	ErrAssertionIssuer  = errors.New("user assertion issuer is not a cluster member")
)

// Assertion is a signed statement about a user made by a node.
type Assertion struct {
	User     string   `json:"u"`
	Groups   []string `json:"g"`
	Issuer   string   `json:"i"`
	Cluster  string   `json:"c"`
	IssuedAt int64    `json:"t"`
	Expires  int64    `json:"e"`
}

// Issue creates an assertion for a user known on this node.
func (i *Manager) Issue(username string, ttl time.Duration) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("cluster/identity", "Manager.Issue", "i", i, "username", username, "&ttl", &ttl), &out0, &out1)
	if !validUsername(username) {
		return "", errors.New("invalid username")
	}
	cluster := i.m.Cluster()
	if cluster == nil {
		return "", errors.New("not in a cluster")
	}
	if ttl <= 0 {
		ttl = DefaultAssertionTTL
	}
	groups, _ := i.acc.Groups(username)
	if groups == nil {
		groups = []string{}
	}
	now := time.Now()
	payload, err := json.Marshal(Assertion{
		User:     username,
		Groups:   groups,
		Issuer:   i.m.NodeID(),
		Cluster:  cluster.ID,
		IssuedAt: now.Unix(),
		Expires:  now.Add(ttl).Unix(),
	})
	if err != nil {
		logger.DebugErr("cluster/identity", err)
		return "", err
	}
	sig := i.m.Sign(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// Verify checks an assertion issued by any current cluster member.
func (i *Manager) Verify(token string) (*Assertion, error) {
	logger.DebugTrace("cluster/identity", "Manager.Verify")
	return i.verifyAt(token, time.Now())
}

func (i *Manager) verifyAt(token string, now time.Time) (out0 *Assertion, out1 error) {
	defer logger.Out2(logger.In3("cluster/identity", "Manager.verifyAt", "i", i, "&now", &now, "!token", token), &out0, &out1)
	parts := strings.SplitN(strings.TrimSpace(token), ".", 2)
	if len(parts) != 2 {
		return nil, ErrAssertionInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		logger.DebugErr("cluster/identity", err)
		return nil, ErrAssertionInvalid
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(sig) != ed25519.SignatureSize {
		return nil, ErrAssertionInvalid
	}
	var a Assertion
	if err := json.Unmarshal(payload, &a); err != nil || !validUsername(a.User) || a.Issuer == "" {
		return nil, ErrAssertionInvalid
	}
	cluster := i.m.Cluster()
	if cluster == nil || a.Cluster != cluster.ID {
		return nil, ErrAssertionInvalid
	}
	peer, ok := i.m.ResolvePeer(a.Issuer)
	if !ok && a.Issuer == i.m.NodeID() {
		//Assertions we issued ourselves: verify with our own key
		self, _ := i.m.ResolvePeer(i.m.NodeID())
		peer, ok = self, self != nil
	}
	if !ok || peer == nil {
		return nil, ErrAssertionIssuer
	}
	if !ed25519.Verify(peer.PublicKey, payload, sig) {
		return nil, ErrAssertionInvalid
	}
	if now.Unix() > a.Expires || a.IssuedAt > now.Add(assertionMaxSkew).Unix() {
		return nil, ErrAssertionExpired
	}
	if a.Groups == nil {
		a.Groups = []string{}
	}
	return &a, nil
}

// Attach adds a fresh assertion for username to an outgoing request.
func (i *Manager) Attach(req *http.Request, username string) (out0 error) {
	defer logger.Out1(logger.In3("cluster/identity", "Manager.Attach", "i", i, "req", req, "username", username), &out0)
	token, err := i.Issue(username, DefaultAssertionTTL)
	if err != nil {
		logger.DebugErr("cluster/identity", err)
		return err
	}
	req.Header.Set(HeaderUser, token)
	return nil
}

// FromRequest verifies the assertion carried by an incoming node request.
func (i *Manager) FromRequest(r *http.Request) (out0 *Assertion, out1 error) {
	defer logger.Out2(logger.In2("cluster/identity", "Manager.FromRequest", "i", i, "r", r), &out0, &out1)
	token := r.Header.Get(HeaderUser)
	if token == "" {
		return nil, ErrAssertionInvalid
	}
	return i.Verify(token)
}
