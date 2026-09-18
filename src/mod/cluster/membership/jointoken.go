package membership

/*
	ArozOS Cluster - join tokens

	A join token is generated on a reachable member and pasted into the
	System Settings of the node that wants to join. It carries everything the
	joiner needs: the cluster ID and name, the URL of the issuing node and a
	one-time-style secret. Only the SHA-256 of the secret is stored server
	side.
*/

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const joinTokenPrefix = "aroz-join:"

// joinTokenPayload is the wire form embedded in the pasted string.
type joinTokenPayload struct {
	ClusterID   string `json:"c"`
	ClusterName string `json:"n"`
	URL         string `json:"u"`
	TokenID     string `json:"t"`
	Secret      string `json:"s"`
}

func randomHex(n int) string {
	buf := make([]byte, n)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// NewJoinToken creates a token valid for ttl and the pasteable string that
// encodes it for the issuing node at issuerURL.
func NewJoinToken(cluster ClusterInfo, issuerURL string, ttl time.Duration) (*JoinToken, string, error) {
	if strings.TrimSpace(issuerURL) == "" {
		return nil, "", errors.New("this node has no advertised URL; generate the join token on a node that other nodes can reach")
	}
	secret := randomHex(32)
	now := time.Now()
	token := &JoinToken{
		ID:         randomHex(8),
		SecretHash: hashSecret(secret),
		Created:    now.Unix(),
		Expires:    now.Add(ttl).Unix(),
	}
	payload := joinTokenPayload{
		ClusterID:   cluster.ID,
		ClusterName: cluster.Name,
		URL:         strings.TrimRight(strings.TrimSpace(issuerURL), "/"),
		TokenID:     token.ID,
		Secret:      secret,
	}
	js, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}
	return token, joinTokenPrefix + base64.RawURLEncoding.EncodeToString(js), nil
}

// DecodeJoinToken parses a pasted token string.
func DecodeJoinToken(encoded string) (*joinTokenPayload, error) {
	encoded = strings.TrimSpace(encoded)
	if !strings.HasPrefix(encoded, joinTokenPrefix) {
		return nil, errors.New("not an ArozOS join token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(encoded, joinTokenPrefix))
	if err != nil {
		return nil, errors.New("join token is corrupted")
	}
	var p joinTokenPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, errors.New("join token is corrupted")
	}
	if p.ClusterID == "" || p.URL == "" || p.TokenID == "" || p.Secret == "" {
		return nil, errors.New("join token is incomplete")
	}
	if !strings.HasPrefix(p.URL, "http://") && !strings.HasPrefix(p.URL, "https://") {
		return nil, errors.New("join token has an invalid node URL")
	}
	return &p, nil
}

// Valid checks a presented secret against the stored token at time now.
func (t *JoinToken) Valid(secret string, now time.Time) bool {
	if t == nil || now.Unix() > t.Expires {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashSecret(secret)), []byte(t.SecretHash)) == 1
}
