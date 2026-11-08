package aroz

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/storage/smbserver/auth"
)

func openStore(t *testing.T) (*CredentialDB, *database.Database, string) {
	t.Helper()
	dir := t.TempDir()
	db, err := database.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	keyDir := filepath.Join(dir, "keys")
	c, err := OpenCredentialDB(db, keyDir)
	if err != nil {
		t.Fatal(err)
	}
	return c, db, keyDir
}

// The AES vectors of RFC 3962 appendix B, all with the salt it uses.
func TestKerberosKeyVectors(t *testing.T) {
	cases := []struct {
		name       string
		password   string
		salt       string
		iterations int
		size       int
		want       string
	}{
		{"one iteration, 128", "password", "ATHENA.MIT.EDUraeburn", 1, 16, "42263c6e89f4fc28b8df68ee09799f15"},
		{"two iterations, 128", "password", "ATHENA.MIT.EDUraeburn", 2, 16, "c651bf29e2300ac27fa469d693bdda13"},
		{"1200 iterations, 128", "password", "ATHENA.MIT.EDUraeburn", 1200, 16, "4c01cd46d632d01e6dbe230a01ed642a"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := kerberosKey(c.password, c.salt, c.iterations, c.size)
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(got) != c.want {
				t.Errorf("got %x want %s", got, c.want)
			}
		})
	}
	long, err := kerberosKey("password", "ATHENA.MIT.EDUraeburn", 1, 32)
	if err != nil {
		t.Fatal(err)
	}
	if len(long) != 32 {
		t.Errorf("a 256 bit key is %d bytes", len(long))
	}
}

func TestSetAndLookup(t *testing.T) {
	c, _, _ := openStore(t)
	if err := c.Set("Alice", "correct horse"); err != nil {
		t.Fatal(err)
	}
	name, hash, ok := c.Lookup("ALICE")
	if !ok {
		t.Fatal("lookup failed")
	}
	if name != "Alice" {
		t.Errorf("name = %q, the account's spelling must come back", name)
	}
	if !bytes.Equal(hash, auth.NTHash("correct horse")) {
		t.Error("wrong hash")
	}
	if !c.Has("alice") {
		t.Error("Has must ignore case")
	}
	if _, _, ok := c.Lookup("nobody"); ok {
		t.Error("an unknown user must not resolve")
	}
}

func TestPasswordChangeReplacesTheHash(t *testing.T) {
	c, _, _ := openStore(t)
	c.Set("alice", "first")
	c.Set("alice", "second")
	_, hash, _ := c.Lookup("alice")
	if !bytes.Equal(hash, auth.NTHash("second")) {
		t.Error("the old password still works")
	}
}

func TestRemoveRevokes(t *testing.T) {
	c, _, _ := openStore(t)
	c.Set("alice", "pw")
	if err := c.Remove("ALICE"); err != nil {
		t.Fatal(err)
	}
	if c.Has("alice") {
		t.Error("the user is still active")
	}
	if _, _, ok := c.Lookup("alice"); ok {
		t.Error("a revoked user must not log in")
	}
}

func TestNoSecretIsReadableInTheDatabase(t *testing.T) {
	c, db, _ := openStore(t)
	c.Set("alice", "correct horse")

	var record storedCredential
	if err := db.Read(credentialTable, "alice", &record); err != nil {
		t.Fatal(err)
	}
	raw := record.NTHash + record.AES128 + record.AES256
	if strings.Contains(raw, hex.EncodeToString(auth.NTHash("correct horse"))) {
		t.Error("the NT hash is stored in the clear")
	}
	if record.Salt == "" || record.Iterations != kerberosIterations {
		t.Errorf("a KDC needs the salt and count: %+v", record)
	}
	if record.AES128 == "" || record.AES256 == "" {
		t.Error("the Kerberos keys must be kept from the start")
	}
}

func TestARecordCannotMoveToAnotherUser(t *testing.T) {
	c, db, _ := openStore(t)
	c.Set("mallory", "mallory's password")

	//An attacker with write access to the database copies their own row over
	//the admin's, to log in as the admin with a password they know
	var record storedCredential
	db.Read(credentialTable, "mallory", &record)
	record.Name = "admin"
	if err := db.Write(credentialTable, "admin", record); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := c.Lookup("admin"); ok {
		t.Error("a sealed value must only open for its owner")
	}
}

func TestARecordCannotBeRenamedInPlace(t *testing.T) {
	c, db, _ := openStore(t)
	c.Set("mallory", "mallory's password")
	c.Set("admin", "the admin's password")

	//The row stays under mallory's key, so its seal still opens, but the name
	//the login becomes is changed to the admin's
	var record storedCredential
	db.Read(credentialTable, "mallory", &record)
	record.Name = "admin"
	if err := db.Write(credentialTable, "mallory", record); err != nil {
		t.Fatal(err)
	}
	if name, _, ok := c.Lookup("mallory"); ok {
		t.Errorf("a renamed row resolved to %q", name)
	}
	list, err := c.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Username != "admin" {
		t.Errorf("a renamed row must not be listed: %v", list)
	}

	//A difference in case only is still the same account
	record.Name = "Mallory"
	db.Write(credentialTable, "mallory", record)
	if name, _, ok := c.Lookup("MALLORY"); !ok || name != "Mallory" {
		t.Errorf("lookup = %q %v", name, ok)
	}
}

func TestKeyFileIsPrivateAndReused(t *testing.T) {
	c, db, keyDir := openStore(t)
	c.Set("alice", "pw")

	info, err := os.Stat(filepath.Join(keyDir, secretKeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Errorf("mode = %v", info.Mode().Perm())
	}

	reopened, err := OpenCredentialDB(db, keyDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := reopened.Lookup("alice"); !ok {
		t.Error("the store must survive a restart")
	}
}

func TestLostKeyOnlyCostsThePasswords(t *testing.T) {
	c, db, keyDir := openStore(t)
	c.Set("alice", "pw")
	os.Remove(filepath.Join(keyDir, secretKeyFile))

	reopened, err := OpenCredentialDB(db, keyDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := reopened.Lookup("alice"); ok {
		t.Error("a record sealed with a lost key must not open")
	}
	if err := reopened.Set("alice", "new"); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := reopened.Lookup("alice"); !ok {
		t.Error("setting it again must work")
	}
}

func TestSetHash(t *testing.T) {
	c, _, _ := openStore(t)
	hash := auth.NTHash("from samba")
	if err := c.SetHash("bob", hash); err != nil {
		t.Fatal(err)
	}
	if _, got, ok := c.Lookup("bob"); !ok || !bytes.Equal(got, hash) {
		t.Errorf("lookup: %x %v", got, ok)
	}
	if err := c.SetHash("bob", []byte{1, 2}); err == nil {
		t.Error("a short hash must be refused")
	}
}

func TestList(t *testing.T) {
	c, _, _ := openStore(t)
	c.Set("Zed", "pw")
	c.Set("alice", "pw")
	list, err := c.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Username != "alice" || list[1].Username != "Zed" {
		t.Errorf("list = %+v", list)
	}
	if list[0].Changed == 0 {
		t.Error("the change time must be kept")
	}
}

func TestStoreWorksAsABackend(t *testing.T) {
	c, _, _ := openStore(t)
	c.Set("alice", "pw")
	b, err := New(Options{Credentials: c, LookupUser: func(string) (Account, Quota, error) { return nil, nil, nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, hash, ok := b.LookupHash("Alice"); !ok || !bytes.Equal(hash, auth.NTHash("pw")) {
		t.Error("the backend must read the store")
	}
}
