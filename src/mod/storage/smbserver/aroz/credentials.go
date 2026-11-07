package aroz

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/storage/smbserver/auth"
)

/*
	credentials.go

	NTLM cannot be checked against the sha512 ArozOS keeps for a login, so a
	user who wants SMB sets a separate password, and the server keeps what
	verifying it needs. An NT hash logs in as that user over SMB and is quick to
	crack, so it is sealed with AES-256-GCM. The key is a 0600 file away from
	the database, so a copy of the database alone discloses nothing.

	The Kerberos keys are kept from the start as well. NTLM is on its way out
	of Windows, and these can only be made while the password is at hand, so
	keeping them now saves asking everyone again later.
*/

const (
	credentialTable = "smbserv_credentials"
	secretKeyFile   = "secret.key"

	//RFC 3962 default
	kerberosIterations = 4096
)

// ErrNoCredential means the user has not enabled SMB.
var ErrNoCredential = errors.New("smbserver/aroz: no SMB password is set for this user")

// sealer encrypts short secrets.
type sealer struct {
	aead cipher.AEAD
}

// loadSealer reads the key from dir, making one on first use. A lost key costs
// users their SMB passwords, which they can simply set again.
func loadSealer(dir string) (*sealer, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(dir, secretKeyFile)
	var key []byte
	if content, err := os.ReadFile(keyPath); err == nil {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(content)))
		if err == nil && len(decoded) == 32 {
			key = decoded
		}
	}
	if key == nil {
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		if err := os.WriteFile(keyPath, []byte(base64.StdEncoding.EncodeToString(key)), 0600); err != nil {
			return nil, err
		}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sealer{aead: aead}, nil
}

// seal encrypts a secret for one user. The user is bound into the result, so
// a record moved onto another account in the database no longer opens.
func (s *sealer) seal(owner string, secret []byte) (string, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := s.aead.Seal(nonce, nonce, secret, []byte(owner))
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (s *sealer) open(owner, text string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, err
	}
	if len(raw) < s.aead.NonceSize() {
		return nil, errors.New("smbserver/aroz: sealed value is too short")
	}
	return s.aead.Open(nil, raw[:s.aead.NonceSize()], raw[s.aead.NonceSize():], []byte(owner))
}

// kerberosFold is the 128 bit n-fold of "kerberos" from RFC 3961, the constant
// every Kerberos string-to-key ends with.
var kerberosFold, _ = hex.DecodeString("6b65726265726f737b9b5b2b93132b93")

// kerberosKey is the AES string-to-key of RFC 3962.
func kerberosKey(password, salt string, iterations, size int) ([]byte, error) {
	temporary, err := pbkdf2.Key(sha1.New, password, []byte(salt), iterations, size)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(temporary)
	if err != nil {
		return nil, err
	}
	key := make([]byte, 0, size)
	chunk := make([]byte, 16)
	copy(chunk, kerberosFold)
	for len(key) < size {
		block.Encrypt(chunk, chunk)
		key = append(key, chunk...)
	}
	return key[:size], nil
}

// storedCredential is one row. The salt and count go with the keys, because a
// future KDC has to announce them to clients.
type storedCredential struct {
	Name       string //The account's spelling
	NTHash     string
	AES128     string
	AES256     string
	Salt       string
	Iterations int
	Changed    int64
}

// CredentialDB keeps the SMB secrets of all users.
type CredentialDB struct {
	mu   sync.RWMutex
	db   *database.Database
	seal *sealer
}

// OpenCredentialDB opens the store. The key file lives in keyDir.
func OpenCredentialDB(db *database.Database, keyDir string) (*CredentialDB, error) {
	if err := db.NewTable(credentialTable); err != nil {
		return nil, err
	}
	s, err := loadSealer(keyDir)
	if err != nil {
		return nil, err
	}
	return &CredentialDB{db: db, seal: s}, nil
}

func credentialKey(username string) string { return strings.ToLower(username) }

// Set stores the SMB password of a user.
func (c *CredentialDB) Set(username, password string) error {
	salt := "arozos-smb:" + strings.ToLower(username)
	aes128, err := kerberosKey(password, salt, kerberosIterations, 16)
	if err != nil {
		return err
	}
	aes256, err := kerberosKey(password, salt, kerberosIterations, 32)
	if err != nil {
		return err
	}

	owner := credentialKey(username)
	record := storedCredential{Name: username, Salt: salt, Iterations: kerberosIterations, Changed: time.Now().Unix()}
	if record.NTHash, err = c.seal.seal(owner, auth.NTHash(password)); err != nil {
		return err
	}
	if record.AES128, err = c.seal.seal(owner, aes128); err != nil {
		return err
	}
	if record.AES256, err = c.seal.seal(owner, aes256); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.db.Write(credentialTable, owner, record)
}

// SetHash stores an NT hash brought over from Samba. There is no password to
// make Kerberos keys from, so that user is asked once more when Kerberos comes.
func (c *CredentialDB) SetHash(username string, ntHash []byte) error {
	if len(ntHash) != 16 {
		return errors.New("smbserver/aroz: an NT hash is 16 bytes")
	}
	owner := credentialKey(username)
	sealed, err := c.seal.seal(owner, ntHash)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.db.Write(credentialTable, owner, storedCredential{Name: username, NTHash: sealed, Changed: time.Now().Unix()})
}

// Remove deletes the SMB password of a user.
func (c *CredentialDB) Remove(username string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.db.Delete(credentialTable, credentialKey(username))
}

// Has reports whether a user has enabled SMB.
func (c *CredentialDB) Has(username string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.db.KeyExists(credentialTable, credentialKey(username))
}

// Lookup implements CredentialStore. Windows sends whatever case was typed.
func (c *CredentialDB) Lookup(username string) (string, []byte, bool) {
	owner := credentialKey(username)
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.db.KeyExists(credentialTable, owner) {
		return "", nil, false
	}
	var record storedCredential
	if err := c.db.Read(credentialTable, owner, &record); err != nil {
		return "", nil, false
	}
	hash, err := c.seal.open(owner, record.NTHash)
	if err != nil {
		return "", nil, false
	}
	return record.Name, hash, true
}

// ActiveUser is one row of the admin's list. It holds nothing secret.
type ActiveUser struct {
	Username string
	Changed  int64
}

// List returns the users who enabled SMB.
func (c *CredentialDB) List() ([]ActiveUser, error) {
	c.mu.RLock()
	rows, err := c.db.ListTable(credentialTable)
	if err != nil {
		c.mu.RUnlock()
		return nil, err
	}
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, string(row[0]))
	}
	out := make([]ActiveUser, 0, len(names))
	for _, key := range names {
		var record storedCredential
		if err := c.db.Read(credentialTable, key, &record); err == nil {
			out = append(out, ActiveUser{Username: record.Name, Changed: record.Changed})
		}
	}
	c.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Username) < strings.ToLower(out[j].Username) })
	return out, nil
}
