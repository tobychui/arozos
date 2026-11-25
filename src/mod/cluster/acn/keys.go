package acn

/*
	ArozOS Cluster Node protocol (ACN) - node identity keys

	Every ArozOS node that takes part in a cluster owns one Ed25519 key pair.
	The public key is published in the node's membership record when it joins
	a cluster; the private key never leaves the node and is used to sign every
	node-to-node request (see signing.go).

	The key is stored as a hex encoded 32 byte seed so it survives restarts.
*/

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// NodeKey is the Ed25519 identity of this node.
type NodeKey struct {
	Private ed25519.PrivateKey
	Public  ed25519.PublicKey
}

// GenerateNodeKey creates a brand new random node key pair.
func GenerateNodeKey() (out0 *NodeKey, out1 error) {
	defer logger.Out2(logger.In0("cluster/acn", "GenerateNodeKey"), &out0, &out1)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	return &NodeKey{Private: priv, Public: pub}, nil
}

// LoadOrCreateNodeKey loads the node key stored at keyfile, creating and
// persisting a new one when the file does not exist yet.
func LoadOrCreateNodeKey(keyfile string) (out0 *NodeKey, out1 error) {
	defer logger.Out2(logger.In1("cluster/acn", "LoadOrCreateNodeKey", "!keyfile", keyfile), &out0, &out1)
	content, err := os.ReadFile(keyfile)
	if err == nil {
		return ParseNodeKey(strings.TrimSpace(string(content)))
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	key, err := GenerateNodeKey()
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(keyfile), 0700); err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	if err := os.WriteFile(keyfile, []byte(key.Encode()), 0600); err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	return key, nil
}

// ParseNodeKey rebuilds a key pair from the hex encoded seed produced by Encode.
func ParseNodeKey(hexSeed string) (out0 *NodeKey, out1 error) {
	defer logger.Out2(logger.In1("cluster/acn", "ParseNodeKey", "!hexSeed", hexSeed), &out0, &out1)
	seed, err := hex.DecodeString(strings.TrimSpace(hexSeed))
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, errors.New("invalid node key encoding: " + err.Error())
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("invalid node key length")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return &NodeKey{
		Private: priv,
		Public:  priv.Public().(ed25519.PublicKey),
	}, nil
}

// Encode returns the hex encoded seed of the private key for persistence.
func (k *NodeKey) Encode() string {
	logger.DebugTrace("cluster/acn", "NodeKey.Encode")
	return hex.EncodeToString(k.Private.Seed())
}

// PublicKeyString returns the base64 encoded public key that is published to
// other cluster members.
func (k *NodeKey) PublicKeyString() string {
	logger.DebugTrace("cluster/acn", "NodeKey.PublicKeyString")
	return EncodePublicKey(k.Public)
}

// EncodePublicKey converts a public key into its transport encoding.
func EncodePublicKey(pub ed25519.PublicKey) string {
	logger.DebugTrace("cluster/acn", "EncodePublicKey")
	return base64.StdEncoding.EncodeToString(pub)
}

// DecodePublicKey parses the base64 public key of a peer.
func DecodePublicKey(encoded string) (out0 ed25519.PublicKey, out1 error) {
	defer logger.Out2(logger.In1("cluster/acn", "DecodePublicKey", "encoded", encoded), &out0, &out1)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, errors.New("invalid public key encoding: " + err.Error())
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("invalid public key length")
	}
	return ed25519.PublicKey(raw), nil
}
