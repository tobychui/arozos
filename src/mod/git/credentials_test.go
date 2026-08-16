package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestCredentialStore(t *testing.T) (*CredentialStore, *fakeDatabase) {
	t.Helper()

	database := newFakeDatabase()
	store, err := newCredentialStore(database, filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatalf("newCredentialStore() returned error: %v", err)
	}
	return store, database
}

func TestCredentialSaveAndGet(t *testing.T) {
	store, _ := newTestCredentialStore(t)

	if err := store.Save("toby", "github.com", "tobychui", "ghp_secret_token"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	credential, found := store.Get("toby", "github.com")
	if !found {
		t.Fatalf("Get() = not found, want the saved credential")
	}
	if credential.Username != "tobychui" {
		t.Errorf("Username = %q, want %q", credential.Username, "tobychui")
	}
	if credential.Token != "ghp_secret_token" {
		t.Errorf("Token = %q, want %q", credential.Token, "ghp_secret_token")
	}
	if credential.Host != "github.com" {
		t.Errorf("Host = %q, want %q", credential.Host, "github.com")
	}
}

func TestCredentialTokenIsEncryptedAtRest(t *testing.T) {
	store, database := newTestCredentialStore(t)

	if err := store.Save("toby", "github.com", "tobychui", "ghp_super_secret"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	entries, err := database.ListTable(credentialTable)
	if err != nil {
		t.Fatalf("ListTable() returned error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("stored %d records, want 1", len(entries))
	}

	raw := string(entries[0][1])
	if strings.Contains(raw, "ghp_super_secret") {
		t.Errorf("stored record contains the plaintext token: %s", raw)
	}
	if !strings.Contains(raw, "tobychui") {
		t.Errorf("stored record should keep the user name readable for pre-fill: %s", raw)
	}
}

func TestCredentialTokenIsNeverMarshalled(t *testing.T) {
	store, _ := newTestCredentialStore(t)
	if err := store.Save("toby", "github.com", "tobychui", "ghp_secret"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	//List is what the front-end receives; it must not carry any secret
	for _, credential := range store.List("toby") {
		if credential.Token != "" {
			t.Errorf("List() returned a populated Token field, want it empty")
		}
	}
}

func TestCredentialsAreIsolatedPerUser(t *testing.T) {
	store, _ := newTestCredentialStore(t)

	if err := store.Save("alice", "github.com", "alice-gh", "alice-token"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}
	if err := store.Save("bob", "github.com", "bob-gh", "bob-token"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	alice, found := store.Get("alice", "github.com")
	if !found || alice.Token != "alice-token" {
		t.Errorf("Get(alice) = %+v, want alice's own token", alice)
	}

	bob, found := store.Get("bob", "github.com")
	if !found || bob.Token != "bob-token" {
		t.Errorf("Get(bob) = %+v, want bob's own token", bob)
	}

	if list := store.List("alice"); len(list) != 1 || list[0].Username != "alice-gh" {
		t.Errorf("List(alice) = %+v, want only alice's entry", list)
	}
}

func TestCredentialRemove(t *testing.T) {
	store, _ := newTestCredentialStore(t)

	if err := store.Save("toby", "github.com", "tobychui", "token"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}
	if err := store.Remove("toby", "github.com"); err != nil {
		t.Fatalf("Remove() returned error: %v", err)
	}
	if _, found := store.Get("toby", "github.com"); found {
		t.Errorf("Get() found a credential after Remove(), want it gone")
	}

	//Removing something that is not there is not an error
	if err := store.Remove("toby", "github.com"); err != nil {
		t.Errorf("Remove() on a missing credential = %v, want nil", err)
	}
}

func TestCredentialSaveValidation(t *testing.T) {
	store, _ := newTestCredentialStore(t)

	tests := []struct {
		name       string
		owner      string
		host       string
		remoteUser string
		token      string
	}{
		{name: "empty owner", owner: "", host: "github.com", remoteUser: "u", token: "t"},
		{name: "empty host", owner: "toby", host: "", remoteUser: "u", token: "t"},
		{name: "empty token", owner: "toby", host: "github.com", remoteUser: "u", token: ""},
		{name: "whitespace token", owner: "toby", host: "github.com", remoteUser: "u", token: "   "},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := store.Save(test.owner, test.host, test.remoteUser, test.token); err == nil {
				t.Errorf("Save() with %s = nil error, want an error", test.name)
			}
		})
	}
}

func TestCredentialGetMissing(t *testing.T) {
	store, _ := newTestCredentialStore(t)

	tests := []struct {
		name  string
		owner string
		host  string
	}{
		{name: "nothing stored", owner: "toby", host: "github.com"},
		{name: "empty owner", owner: "", host: "github.com"},
		{name: "empty host", owner: "toby", host: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, found := store.Get(test.owner, test.host); found {
				t.Errorf("Get(%q, %q) = found, want not found", test.owner, test.host)
			}
		})
	}
}

func TestCredentialResolveForRemote(t *testing.T) {
	store, _ := newTestCredentialStore(t)
	if err := store.Save("toby", "github.com", "tobychui", "token"); err != nil {
		t.Fatalf("Save() returned error: %v", err)
	}

	tests := []struct {
		name      string
		remoteURL string
		wantFound bool
	}{
		{name: "https url", remoteURL: "https://github.com/tobychui/arozos.git", wantFound: true},
		{name: "https url with credentials", remoteURL: "https://user@github.com/a/b.git", wantFound: true},
		{name: "scp style", remoteURL: "git@github.com:tobychui/arozos.git", wantFound: true},
		{name: "different host", remoteURL: "https://gitlab.com/a/b.git", wantFound: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, found := store.ResolveForRemote("toby", test.remoteURL)
			if found != test.wantFound {
				t.Errorf("ResolveForRemote(%q) found = %v, want %v", test.remoteURL, found, test.wantFound)
			}
		})
	}
}

func TestNormaliseHost(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "bare host", input: "github.com", want: "github.com"},
		{name: "mixed case", input: "GitHub.COM", want: "github.com"},
		{name: "surrounding spaces", input: "  github.com  ", want: "github.com"},
		{name: "https url", input: "https://github.com/a/b.git", want: "github.com"},
		{name: "http url with port", input: "http://git.local:3000/a/b.git", want: "git.local"},
		{name: "scp syntax", input: "git@github.com:a/b.git", want: "github.com"},
		{name: "host with port", input: "git.local:3000", want: "git.local"},
		{name: "empty", input: "", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normaliseHost(test.input); got != test.want {
				t.Errorf("normaliseHost(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	tests := []struct {
		name      string
		plaintext string
	}{
		{name: "simple token", plaintext: "ghp_abcdefghijklmnop"},
		{name: "empty string", plaintext: ""},
		{name: "unicode", plaintext: "pässwörd-中文"},
		{name: "long secret", plaintext: strings.Repeat("s", 4096)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			encrypted, err := encryptSecret(key, test.plaintext)
			if err != nil {
				t.Fatalf("encryptSecret() returned error: %v", err)
			}
			if encrypted == test.plaintext && test.plaintext != "" {
				t.Fatalf("encryptSecret() returned the plaintext unchanged")
			}

			decrypted, err := decryptSecret(key, encrypted)
			if err != nil {
				t.Fatalf("decryptSecret() returned error: %v", err)
			}
			if decrypted != test.plaintext {
				t.Errorf("round trip = %q, want %q", decrypted, test.plaintext)
			}
		})
	}
}

func TestEncryptSecretUsesFreshNonce(t *testing.T) {
	key := make([]byte, 32)
	first, err := encryptSecret(key, "same input")
	if err != nil {
		t.Fatalf("encryptSecret() returned error: %v", err)
	}
	second, err := encryptSecret(key, "same input")
	if err != nil {
		t.Fatalf("encryptSecret() returned error: %v", err)
	}

	if first == second {
		t.Errorf("encrypting the same value twice produced identical ciphertext, want distinct nonces")
	}
}

func TestDecryptSecretRejectsTampering(t *testing.T) {
	key := make([]byte, 32)
	otherKey := make([]byte, 32)
	otherKey[0] = 0xFF

	encrypted, err := encryptSecret(key, "secret")
	if err != nil {
		t.Fatalf("encryptSecret() returned error: %v", err)
	}

	tests := []struct {
		name  string
		key   []byte
		input string
	}{
		{name: "wrong key", key: otherKey, input: encrypted},
		{name: "not base64", key: key, input: "!!!not base64!!!"},
		{name: "truncated", key: key, input: "AAAA"},
		{name: "empty", key: key, input: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decryptSecret(test.key, test.input); err == nil {
				t.Errorf("decryptSecret() with %s = nil error, want an error", test.name)
			}
		})
	}
}

func TestLoadOrCreateKeyIsStable(t *testing.T) {
	keyStore := filepath.Join(t.TempDir(), "keys")

	first, err := loadOrCreateKey(keyStore)
	if err != nil {
		t.Fatalf("loadOrCreateKey() returned error: %v", err)
	}
	if len(first) != 32 {
		t.Fatalf("key length = %d, want 32", len(first))
	}

	second, err := loadOrCreateKey(keyStore)
	if err != nil {
		t.Fatalf("loadOrCreateKey() second call returned error: %v", err)
	}
	if string(first) != string(second) {
		t.Errorf("loadOrCreateKey() returned a different key on the second call")
	}
}

func TestLoadOrCreateKeyRegeneratesDamagedFile(t *testing.T) {
	keyStore := filepath.Join(t.TempDir(), "keys")
	if _, err := loadOrCreateKey(keyStore); err != nil {
		t.Fatalf("loadOrCreateKey() returned error: %v", err)
	}

	if err := os.WriteFile(filepath.Join(keyStore, keyFileName), []byte("corrupted"), 0600); err != nil {
		t.Fatalf("cannot damage key file: %v", err)
	}

	key, err := loadOrCreateKey(keyStore)
	if err != nil {
		t.Fatalf("loadOrCreateKey() on a damaged file returned error: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("regenerated key length = %d, want 32", len(key))
	}
}

func TestNewCredentialStoreValidation(t *testing.T) {
	tests := []struct {
		name         string
		database     CredentialDatabase
		keyStorePath string
	}{
		{name: "nil database", database: nil, keyStorePath: t.TempDir()},
		{name: "empty key path", database: newFakeDatabase(), keyStorePath: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := newCredentialStore(test.database, test.keyStorePath); err == nil {
				t.Errorf("newCredentialStore() with %s = nil error, want an error", test.name)
			}
		})
	}
}

func TestManagerWithoutDatabaseHasNoCredentialStore(t *testing.T) {
	manager, err := NewManager(Options{})
	if err != nil {
		t.Fatalf("NewManager() returned error: %v", err)
	}
	if manager.Credentials() != nil {
		t.Errorf("Credentials() = non-nil without a database, want nil")
	}
}
