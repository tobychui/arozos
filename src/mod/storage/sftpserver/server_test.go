package sftpserver

import (
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type serverRig struct {
	instance *Instance
	addr     string
	key      ssh.Signer
	dir      string
	logins   []string
}

// newServerRig serves the "media" drive of newAccessTestRoot to user alice
// with the password "secret".
func newServerRig(t *testing.T, readOnly bool) *serverRig {
	t.Helper()
	_, access, dir := newAccessTestRoot(t, "rw")
	key, err := LoadOrCreateHostKey(filepath.Join(t.TempDir(), "host.key"))
	if err != nil {
		t.Fatalf("LoadOrCreateHostKey() = %v", err)
	}
	rig := &serverRig{key: key, dir: dir}
	instance, err := NewSFTPServer(&SFTPConfig{
		ListeningIP: "127.0.0.1:0",
		HostKey:     key,
		ReadOnly:    readOnly,
		Authenticate: func(username, password, remote string) error {
			rig.logins = append(rig.logins, username+"@"+remote)
			if username != "alice" || password != "secret" {
				return errors.New("Invalid username or password")
			}
			return nil
		},
		LookupUser: func(username string) (Access, error) { return access, nil },
	})
	if err != nil {
		t.Fatalf("NewSFTPServer() = %v", err)
	}
	t.Cleanup(instance.Close)
	rig.instance = instance
	rig.addr = instance.listener.Addr().String()
	return rig
}

func (r *serverRig) dial(t *testing.T, password string) (*ssh.Client, *sftp.Client, error) {
	t.Helper()
	conn, err := ssh.Dial("tcp", r.addr, &ssh.ClientConfig{
		User:            "alice",
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.FixedHostKey(r.key.PublicKey()),
		Timeout:         5 * time.Second,
	})
	if err != nil {
		return nil, nil, err
	}
	client, err := sftp.NewClient(conn)
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	t.Cleanup(func() { client.Close(); conn.Close() })
	return conn, client, nil
}

func TestHostKeyIsCreatedOnceAndReused(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "sftp", "host.key")
	first, err := LoadOrCreateHostKey(keyFile)
	if err != nil {
		t.Fatalf("LoadOrCreateHostKey() = %v", err)
	}
	second, err := LoadOrCreateHostKey(keyFile)
	if err != nil {
		t.Fatalf("LoadOrCreateHostKey() again = %v", err)
	}
	if Fingerprint(first) != Fingerprint(second) {
		t.Errorf("the key changed between loads: %s, then %s", Fingerprint(first), Fingerprint(second))
	}
	if first.PublicKey().Type() != ssh.KeyAlgoED25519 {
		t.Errorf("key type = %s, want %s", first.PublicKey().Type(), ssh.KeyAlgoED25519)
	}
	other, err := LoadOrCreateHostKey(filepath.Join(t.TempDir(), "host.key"))
	if err != nil {
		t.Fatalf("LoadOrCreateHostKey() elsewhere = %v", err)
	}
	if Fingerprint(other) == Fingerprint(first) {
		t.Error("two installations got the same host key")
	}
}

func TestHostKeyFileIsPrivate(t *testing.T) {
	if filepath.Separator == '\\' {
		t.Skip("Windows has no Unix file modes")
	}
	keyFile := filepath.Join(t.TempDir(), "host.key")
	if _, err := LoadOrCreateHostKey(keyFile); err != nil {
		t.Fatalf("LoadOrCreateHostKey() = %v", err)
	}
	info, err := os.Stat(keyFile)
	if err != nil {
		t.Fatalf("Stat() = %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("key file mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestAddressAllowed(t *testing.T) {
	cases := []struct {
		addr        string
		allowPublic bool
		want        bool
	}{
		{"192.168.1.20:5000", false, true},
		{"10.0.0.3:5000", false, true},
		{"127.0.0.1:5000", false, true},
		{"[::1]:5000", false, true},
		{"[fe80::1]:5000", false, true},
		{"8.8.8.8:5000", false, false},
		{"[2001:4860::1]:5000", false, false},
		{"8.8.8.8:5000", true, true},
	}
	for _, c := range cases {
		addr, err := net.ResolveTCPAddr("tcp", c.addr)
		if err != nil {
			t.Fatalf("ResolveTCPAddr(%s) = %v", c.addr, err)
		}
		if got := AddressAllowed(addr, c.allowPublic); got != c.want {
			t.Errorf("AddressAllowed(%s, %v) = %v, want %v", c.addr, c.allowPublic, got, c.want)
		}
	}
	if AddressAllowed(nil, false) {
		t.Error("a missing address must not count as private")
	}
}

func TestSignInAndRead(t *testing.T) {
	rig := newServerRig(t, false)
	_, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	f, err := client.Open("/media/docs/a.txt")
	if err != nil {
		t.Fatalf("Open() = %v", err)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil || string(data) != "hello" {
		t.Errorf("read %q, %v; want hello", data, err)
	}
	if len(rig.logins) == 0 || rig.logins[0] != "alice@127.0.0.1" {
		t.Errorf("Authenticate got %v, want alice@127.0.0.1 (the address without a port)", rig.logins)
	}
}

func TestWrongPasswordIsRefused(t *testing.T) {
	rig := newServerRig(t, false)
	if _, _, err := rig.dial(t, "wrong"); err == nil {
		t.Fatal("a wrong password signed in")
	}
	if clients := rig.instance.Clients(); len(clients) != 0 {
		t.Errorf("Clients() = %v after a failed sign in, want none", clients)
	}
}

func TestReadOnlyRefusesChanges(t *testing.T) {
	rig := newServerRig(t, true)
	_, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	if f, err := client.Open("/media/docs/a.txt"); err != nil {
		t.Errorf("reading in read only mode: %v", err)
	} else {
		f.Close()
	}
	if f, err := client.Create("/media/docs/new.txt"); err == nil {
		f.Close()
		t.Error("Create() worked in read only mode")
	}
	if err := client.Remove("/media/docs/a.txt"); err == nil {
		t.Error("Remove() worked in read only mode")
	}
	if err := client.Mkdir("/media/other"); err == nil {
		t.Error("Mkdir() worked in read only mode")
	}
	if _, err := os.Stat(filepath.Join(rig.dir, "docs", "a.txt")); err != nil {
		t.Errorf("the file is gone: %v", err)
	}
}

func TestWritesWorkWithoutReadOnly(t *testing.T) {
	rig := newServerRig(t, false)
	_, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	f, err := client.Create("/media/docs/new.txt")
	if err != nil {
		t.Fatalf("Create() = %v", err)
	}
	f.Write([]byte("data"))
	f.Close()
	if data, err := os.ReadFile(filepath.Join(rig.dir, "docs", "new.txt")); err != nil || string(data) != "data" {
		t.Errorf("file holds %q, %v; want data", data, err)
	}
}

func TestClientsListAConnectionAndCloseDropsIt(t *testing.T) {
	rig := newServerRig(t, false)
	conn, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	if _, err := client.ReadDir("/"); err != nil {
		t.Fatalf("ReadDir() = %v", err)
	}
	clients := rig.instance.Clients()
	if len(clients) != 1 {
		t.Fatalf("Clients() = %v, want one", clients)
	}
	if clients[0].Username != "alice" || clients[0].Address != "127.0.0.1" || clients[0].Connected == 0 || clients[0].Client == "" {
		t.Errorf("Clients()[0] = %+v", clients[0])
	}

	rig.instance.Close()
	done := make(chan error, 1)
	go func() { done <- conn.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the client is still connected after Close")
	}
	if _, err := net.DialTimeout("tcp", rig.addr, time.Second); err == nil {
		t.Error("the server still accepts connections after Close")
	}
}

func TestUploadOverABiggerFileTruncatesIt(t *testing.T) {
	rig := newServerRig(t, false)
	_, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	//What OpenSSH's put and WinSCP send: write, create, truncate, no read
	f, err := client.OpenFile("/media/docs/a.txt", os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		t.Fatalf("OpenFile() = %v", err)
	}
	f.Write([]byte("hi"))
	f.Close()
	if data, _ := os.ReadFile(filepath.Join(rig.dir, "docs", "a.txt")); string(data) != "hi" {
		t.Errorf("file holds %q, want hi", data)
	}
}

func TestOpenFileLeavesNoHandleBehind(t *testing.T) {
	rig := newServerRig(t, false)
	_, client, err := rig.dial(t, "secret")
	if err != nil {
		t.Fatalf("dial = %v", err)
	}
	f, err := client.Open("/media/docs/a.txt")
	if err != nil {
		t.Fatalf("Open() = %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("Close() = %v", err)
	}
	//Windows refuses to rename a file that is still open
	if err := os.Rename(filepath.Join(rig.dir, "docs", "a.txt"), filepath.Join(rig.dir, "docs", "b.txt")); err != nil {
		t.Errorf("the file is still open on the server: %v", err)
	}
}
