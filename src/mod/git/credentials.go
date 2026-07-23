package git

/*
	credentials.go

	Per-user HTTPS credential storage.

	Tokens are encrypted with AES-256-GCM before they reach the system database.
	The key lives in a single 0600 file under the ArozOS system folder and is
	generated on first use, so a database dump alone never discloses anyone's
	personal access tokens.

	Keys are namespaced "<username>/<host>", meaning one ArozOS account can never
	read another's tokens even though both share the table.
*/

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// credentialTable is the system database table holding encrypted credentials.
const credentialTable = "gitcredentials"

// keyFileName is the AES key file created inside Options.KeyStorePath.
const keyFileName = "credential.key"

// CredentialDatabase is the slice of the ArozOS system database this package
// needs. Declaring it as an interface keeps mod/git testable without a bolt
// file and avoids a hard dependency on mod/database.
type CredentialDatabase interface {
	NewTable(tableName string) error
	Write(tableName string, key string, value interface{}) error
	Read(tableName string, key string, assignee interface{}) error
	KeyExists(tableName string, key string) bool
	Delete(tableName string, key string) error
	ListTable(tableName string) ([][][]byte, error)
}

// storedCredential is the record persisted in the database. Only Token is
// encrypted; the user name is stored in the clear so the UI can pre-fill it.
type storedCredential struct {
	Host           string `json:"host"`
	Username       string `json:"username"`
	EncryptedToken string `json:"encryptedToken"` //base64(nonce || ciphertext)
}

// CredentialStore reads and writes encrypted git credentials.
type CredentialStore struct {
	database CredentialDatabase
	key      []byte
	mutex    sync.RWMutex
}

// newCredentialStore prepares the table and loads (or creates) the AES key.
func newCredentialStore(database CredentialDatabase, keyStorePath string) (*CredentialStore, error) {
	if database == nil {
		return nil, errors.New("credential store requires a database")
	}
	if strings.TrimSpace(keyStorePath) == "" {
		return nil, errors.New("credential store requires a key storage path")
	}

	if err := database.NewTable(credentialTable); err != nil {
		return nil, err
	}

	key, err := loadOrCreateKey(keyStorePath)
	if err != nil {
		return nil, err
	}

	return &CredentialStore{
		database: database,
		key:      key,
	}, nil
}

// Save stores (or replaces) the credential for one user and host. An empty
// token is rejected — the caller should call Remove instead.
func (c *CredentialStore) Save(username string, host string, remoteUser string, token string) error {
	username = strings.TrimSpace(username)
	host = normaliseHost(host)

	if username == "" {
		return errors.New("credential owner cannot be empty")
	}
	if host == "" {
		return errors.New("credential host cannot be empty")
	}
	if strings.TrimSpace(token) == "" {
		return errors.New("credential token cannot be empty")
	}

	c.mutex.Lock()
	defer c.mutex.Unlock()

	encrypted, err := encryptSecret(c.key, token)
	if err != nil {
		return err
	}

	return c.database.Write(credentialTable, credentialKey(username, host), storedCredential{
		Host:           host,
		Username:       strings.TrimSpace(remoteUser),
		EncryptedToken: encrypted,
	})
}

// Get returns the stored credential for a user and host. The second return
// value is false when nothing is stored.
func (c *CredentialStore) Get(username string, host string) (*Credential, bool) {
	username = strings.TrimSpace(username)
	host = normaliseHost(host)
	if username == "" || host == "" {
		return nil, false
	}

	c.mutex.RLock()
	defer c.mutex.RUnlock()

	key := credentialKey(username, host)
	if !c.database.KeyExists(credentialTable, key) {
		return nil, false
	}

	record := storedCredential{}
	if err := c.database.Read(credentialTable, key, &record); err != nil {
		return nil, false
	}

	token, err := decryptSecret(c.key, record.EncryptedToken)
	if err != nil {
		//A key rotation or a corrupted record leaves an unusable entry. Report
		//it as missing so the UI asks for the credential again.
		return nil, false
	}

	return &Credential{
		Host:     record.Host,
		Username: record.Username,
		Token:    token,
	}, true
}

// List returns the hosts a user has credentials for, without any secrets.
func (c *CredentialStore) List(username string) []Credential {
	username = strings.TrimSpace(username)
	results := []Credential{}
	if username == "" {
		return results
	}

	c.mutex.RLock()
	defer c.mutex.RUnlock()

	entries, err := c.database.ListTable(credentialTable)
	if err != nil {
		return results
	}

	prefix := username + "/"
	for _, entry := range entries {
		if len(entry) < 2 || !strings.HasPrefix(string(entry[0]), prefix) {
			continue
		}

		record := storedCredential{}
		if err := json.Unmarshal(entry[1], &record); err != nil {
			continue
		}
		results = append(results, Credential{
			Host:     record.Host,
			Username: record.Username,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Host < results[j].Host
	})
	return results
}

// Remove deletes a stored credential. Deleting a credential that is not there
// is not an error.
func (c *CredentialStore) Remove(username string, host string) error {
	username = strings.TrimSpace(username)
	host = normaliseHost(host)
	if username == "" || host == "" {
		return errors.New("owner and host are both required")
	}

	c.mutex.Lock()
	defer c.mutex.Unlock()

	key := credentialKey(username, host)
	if !c.database.KeyExists(credentialTable, key) {
		return nil
	}
	return c.database.Delete(credentialTable, key)
}

// ResolveForRemote looks up the credential matching a remote URL, which is what
// every transport call needs before it can build an auth method.
func (c *CredentialStore) ResolveForRemote(username string, remoteURL string) (*Credential, bool) {
	return c.Get(username, RemoteHost(remoteURL))
}

// credentialKey namespaces a record by its owning ArozOS account.
func credentialKey(username string, host string) string {
	return username + "/" + host
}

// normaliseHost accepts either a bare host or a full remote URL and always
// returns the lower-cased host, so "https://github.com/a/b.git" and "GitHub.com"
// address the same record.
func normaliseHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if strings.Contains(host, "://") || strings.Contains(host, "@") || strings.Contains(host, "/") {
		return RemoteHost(host)
	}
	//A bare "host:port" still needs the port dropped
	if index := strings.Index(host, ":"); index > 0 {
		host = host[:index]
	}
	return strings.ToLower(host)
}

// loadOrCreateKey reads the AES key from disk, generating a fresh 32-byte key
// on first run.
func loadOrCreateKey(keyStorePath string) ([]byte, error) {
	if err := os.MkdirAll(keyStorePath, 0700); err != nil {
		return nil, err
	}

	keyFile := filepath.Join(keyStorePath, keyFileName)
	if content, err := os.ReadFile(keyFile); err == nil {
		decoded, derr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(content)))
		if derr == nil && len(decoded) == 32 {
			return decoded, nil
		}
		//Fall through and regenerate: a damaged key file only costs the user
		//their saved tokens, which the UI can ask for again.
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}

	encoded := base64.StdEncoding.EncodeToString(key)
	if err := os.WriteFile(keyFile, []byte(encoded), 0600); err != nil {
		return nil, err
	}

	return key, nil
}

// encryptSecret seals plaintext with AES-GCM, returning base64(nonce||ciphertext).
func encryptSecret(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	sealed := aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptSecret reverses encryptSecret.
func decryptSecret(key []byte, encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	if len(raw) < aead.NonceSize() {
		return "", errors.New("stored credential is truncated")
	}

	nonce, ciphertext := raw[:aead.NonceSize()], raw[aead.NonceSize():]
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
