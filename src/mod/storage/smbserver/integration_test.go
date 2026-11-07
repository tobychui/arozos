package smbserver

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hirochachacha/go-smb2"
)

/*
	These tests use go-smb2, a client written by someone else, so a mistake
	here cannot hide by being made identically on both ends.
*/

func dial(t *testing.T, h *harness, user, password string) (*smb2.Session, error) {
	t.Helper()
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	d := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: user, Password: password}}
	s, err := d.Dial(nc)
	if err != nil {
		nc.Close()
		return nil, err
	}
	t.Cleanup(func() { s.Logoff() })
	return s, nil
}

func mount(t *testing.T, h *harness) *smb2.Share {
	t.Helper()
	s, err := dial(t, h, testUserName, testPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	fs, err := s.Mount("data")
	if err != nil {
		t.Fatalf("mount: %v", err)
	}
	t.Cleanup(func() { fs.Umount() })
	return fs
}

func TestLoginAndListShares(t *testing.T) {
	h := newHarness(t)
	s, err := dial(t, h, testUserName, testPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	names, err := s.ListSharenames()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	sort.Strings(names)
	if strings.Join(names, ",") != "IPC$,data" {
		t.Errorf("shares = %v", names)
	}
}

func TestLoginIsCaseInsensitive(t *testing.T) {
	h := newHarness(t)
	if _, err := dial(t, h, "ALICE", testPassword); err != nil {
		t.Errorf("login: %v", err)
	}
}

func TestWrongPasswordIsRefusedAndLogged(t *testing.T) {
	h := newHarness(t)
	if _, err := dial(t, h, testUserName, "wrong"); err == nil {
		t.Fatal("expected a refusal")
	}
	if _, err := dial(t, h, "nobody", testPassword); err == nil {
		t.Fatal("expected a refusal")
	}
	h.backend.mu.Lock()
	defer h.backend.mu.Unlock()
	want := []string{"fail:" + testUserName, "fail:nobody"}
	if len(h.backend.logs) != 2 || h.backend.logs[0] != want[0] || h.backend.logs[1] != want[1] {
		t.Errorf("logs = %v, the name that was tried belongs in the log", h.backend.logs)
	}
}

func TestStartRefusesAPortHeldOnIPv4(t *testing.T) {
	//macOS lets a dual stack listener bind beside this one with no error
	holder, err := net.Listen("tcp4", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	_, port, _ := net.SplitHostPort(holder.Addr().String())

	srv, err := New(Config{Address: ":" + port, Backend: &testBackend{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Start(); err == nil {
		srv.Close()
		t.Fatal("clients would reach the other program while this one looks healthy")
	}
}

func TestAuthLogGetsAnAddressWithAPort(t *testing.T) {
	//The system's auth logger splits ip:port, and records "unknown" without it
	h := newHarness(t)
	if _, err := dial(t, h, testUserName, testPassword); err != nil {
		t.Fatal(err)
	}
	h.backend.mu.Lock()
	defer h.backend.mu.Unlock()
	host, port, err := net.SplitHostPort(h.backend.lastRemote)
	if err != nil || host != "127.0.0.1" || port == "" {
		t.Errorf("remote = %q", h.backend.lastRemote)
	}
}

func TestBackendCanLengthenTheFailureDelay(t *testing.T) {
	h := newHarness(t)
	h.backend.mu.Lock()
	h.backend.delay = 300 * time.Millisecond
	h.backend.mu.Unlock()
	started := time.Now()
	if _, err := dial(t, h, testUserName, "wrong"); err == nil {
		t.Fatal("expected a refusal")
	}
	if took := time.Since(started); took < 300*time.Millisecond {
		t.Errorf("the reply came after %v", took)
	}
}

func TestClientsList(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	f, err := fs.Create("open.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	list := h.srv.Clients()
	if len(list) != 1 {
		t.Fatalf("clients = %+v", list)
	}
	c := list[0]
	if c.Username != testUserName || c.Address != "127.0.0.1" || c.Dialect == "" {
		t.Errorf("client = %+v", c)
	}
	if c.OpenFiles == 0 {
		t.Error("the open file must count")
	}
	if c.Connected == 0 {
		t.Error("the login time must be set")
	}
}

func TestDropUserEndsTheSession(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	if h.srv.DropUser("nobody") != 0 {
		t.Error("nobody is connected as that name")
	}
	if got := h.srv.DropUser("ALICE"); got != 1 {
		t.Fatalf("dropped %d", got)
	}
	if _, err := fs.ReadDir("."); err == nil {
		t.Error("a dropped client must lose its session")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && h.srv.ConnectionCount() != 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if n := h.srv.ConnectionCount(); n != 0 {
		t.Errorf("%d connections left", n)
	}
}

func TestUnknownShare(t *testing.T) {
	h := newHarness(t)
	s, err := dial(t, h, testUserName, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Mount("nope"); err == nil {
		t.Error("expected an error")
	}
}

func TestReadDirectoryAndStat(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "hello.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(h.share.root, "中文檔案.txt"), []byte("zh"), 0644)
	os.Mkdir(filepath.Join(h.share.root, "folder"), 0755)
	fs := mount(t, h)

	entries, err := fs.ReadDir(".")
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	got := map[string]os.FileInfo{}
	for _, e := range entries {
		got[e.Name()] = e
	}
	if len(got) != 3 || got["中文檔案.txt"] == nil {
		t.Fatalf("entries = %v", got)
	}
	if got["hello.txt"].Size() != 5 || got["hello.txt"].IsDir() {
		t.Errorf("hello.txt = %+v", got["hello.txt"])
	}
	if !got["folder"].IsDir() {
		t.Error("folder must be a directory")
	}

	info, err := fs.Stat("hello.txt")
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Size() != 5 {
		t.Errorf("size = %d", info.Size())
	}
	if _, err := fs.Stat("missing.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing file: %v", err)
	}
}

func TestManyFilesPage(t *testing.T) {
	h := newHarness(t)
	const total = 3000
	for i := 0; i < total; i++ {
		os.WriteFile(filepath.Join(h.share.root, fmt.Sprintf("file-with-a-longer-name-%05d.txt", i)), nil, 0644)
	}
	fs := mount(t, h)
	entries, err := fs.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != total {
		t.Errorf("listed %d of %d", len(entries), total)
	}
}

func TestWriteThenRead(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	want := []byte("written over SMB")
	if err := fs.WriteFile("new.txt", want, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := fs.ReadFile("new.txt")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("read back %q", got)
	}
	onDisk, _ := os.ReadFile(filepath.Join(h.share.root, "new.txt"))
	if !bytes.Equal(onDisk, want) {
		t.Errorf("on disk %q", onDisk)
	}
}

func TestLargeFileRoundTrip(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)

	data := make([]byte, 32<<20+12345)
	rand.Read(data)
	want := sha256.Sum256(data)

	f, err := fs.Create("big.bin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}
	f.Close()

	onDisk, _ := os.ReadFile(filepath.Join(h.share.root, "big.bin"))
	if sha256.Sum256(onDisk) != want {
		t.Fatal("the file on disk differs")
	}

	r, err := fs.Open("big.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, r); err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(sum.Sum(nil), want[:]) {
		t.Error("the file read back differs")
	}
}

func TestRenameDeleteAndFolders(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)

	if err := fs.Mkdir("dir", 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := fs.WriteFile("dir/a.txt", []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := fs.Remove("dir"); err == nil {
		t.Error("a folder with a file in it must not delete")
	}
	if err := fs.Rename("dir/a.txt", "dir/b.txt"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.share.root, "dir", "b.txt")); err != nil {
		t.Errorf("after rename: %v", err)
	}
	if err := fs.Remove("dir/b.txt"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := fs.Remove("dir"); err != nil {
		t.Fatalf("rmdir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.share.root, "dir")); !os.IsNotExist(err) {
		t.Errorf("folder still there: %v", err)
	}
}

func TestRenameRefusesToClobber(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	fs.WriteFile("a.txt", []byte("a"), 0644)
	fs.WriteFile("b.txt", []byte("b"), 0644)
	if err := fs.Rename("a.txt", "b.txt"); err == nil {
		t.Error("rename over an existing file must fail without the replace flag")
	}
	if got, _ := fs.ReadFile("b.txt"); string(got) != "b" {
		t.Errorf("b.txt = %q", got)
	}
}

func TestTruncateAndTimes(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	fs.WriteFile("t.txt", []byte("0123456789"), 0644)

	if err := fs.Truncate("t.txt", 4); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if got, _ := fs.ReadFile("t.txt"); string(got) != "0123" {
		t.Errorf("after truncate %q", got)
	}

	when := time.Date(2021, 3, 4, 5, 6, 7, 0, time.UTC)
	if err := fs.Chtimes("t.txt", when, when); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	info, err := os.Stat(filepath.Join(h.share.root, "t.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(when) {
		t.Errorf("mod time = %v", info.ModTime())
	}
}

func TestCaseInsensitiveOpen(t *testing.T) {
	h := newHarness(t)
	os.Mkdir(filepath.Join(h.share.root, "Folder"), 0755)
	os.WriteFile(filepath.Join(h.share.root, "Folder", "Mixed.TXT"), []byte("x"), 0644)
	fs := mount(t, h)
	got, err := fs.ReadFile("FOLDER/mixed.txt")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != "x" {
		t.Errorf("got %q", got)
	}
}

func TestReadOnlyShare(t *testing.T) {
	h := newHarness(t)
	h.share.readOnly = true
	os.WriteFile(filepath.Join(h.share.root, "r.txt"), []byte("r"), 0644)
	fs := mount(t, h)

	if got, err := fs.ReadFile("r.txt"); err != nil || string(got) != "r" {
		t.Errorf("read: %q %v", got, err)
	}
	if err := fs.WriteFile("w.txt", []byte("w"), 0644); err == nil {
		t.Error("write to a read only share must fail")
	}
	if err := fs.Remove("r.txt"); err == nil {
		t.Error("delete on a read only share must fail")
	}
	if err := fs.Mkdir("d", 0755); err == nil {
		t.Error("mkdir on a read only share must fail")
	}
}

func TestAccessChangeReachesOpenSessions(t *testing.T) {
	h := newHarness(t)
	fs := mount(t, h)
	if err := fs.WriteFile("a.txt", []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}

	f, err := fs.OpenFile("a.txt", os.O_RDWR, 0644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	h.share.mu.Lock()
	h.share.denyWrite["a.txt"] = true
	h.share.mu.Unlock()
	if _, err := f.WriteAt([]byte("2"), 0); err == nil {
		t.Error("a revoked write must fail on a handle that is already open")
	}
}

func TestProtectedFolderIsReadOnly(t *testing.T) {
	h := newHarness(t)
	os.Mkdir(filepath.Join(h.share.root, ".metadata"), 0755)
	fs := mount(t, h)
	if err := fs.WriteFile(".metadata/x", []byte("x"), 0644); err == nil {
		t.Error("writes into .metadata must be refused")
	}
}

func TestQuotaStopsAGrowingFile(t *testing.T) {
	h := newHarness(t)
	h.share.spaceLeft = 1024
	fs := mount(t, h)
	if err := fs.WriteFile("small.txt", make([]byte, 512), 0644); err != nil {
		t.Fatalf("within quota: %v", err)
	}
	if err := fs.WriteFile("big.txt", make([]byte, 4096), 0644); err == nil {
		t.Error("over quota must fail")
	}
}

func TestTraversalIsRefused(t *testing.T) {
	h := newHarness(t)
	secret := filepath.Join(filepath.Dir(h.share.root), "outside.txt")
	os.WriteFile(secret, []byte("secret"), 0644)
	defer os.Remove(secret)
	fs := mount(t, h)

	for _, p := range []string{"../outside.txt", "a/../../outside.txt"} {
		if got, err := fs.ReadFile(p); err == nil {
			t.Errorf("%s: read %q", p, got)
		}
	}
}

func TestConcurrentClients(t *testing.T) {
	h := newHarness(t)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		fs := mount(t, h)
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			name := fmt.Sprintf("worker-%d.bin", i)
			data := bytes.Repeat([]byte{byte(i)}, 1<<20)
			for round := 0; round < 5; round++ {
				if err := fs.WriteFile(name, data, 0644); err != nil {
					errs <- err
					return
				}
				got, err := fs.ReadFile(name)
				if err != nil {
					errs <- err
					return
				}
				if !bytes.Equal(got, data) {
					errs <- fmt.Errorf("worker %d read back other data", i)
					return
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestHandlesCloseWithTheConnection(t *testing.T) {
	h := newHarness(t)
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	d := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: testUserName, Password: testPassword}}
	s, err := d.Dial(nc)
	if err != nil {
		t.Fatal(err)
	}
	fs, err := s.Mount("data")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Create("held.txt"); err != nil {
		t.Fatal(err)
	}

	//The cable is pulled: no logoff, no close
	nc.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && h.srv.ConnectionCount() != 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if n := h.srv.ConnectionCount(); n != 0 {
		t.Fatalf("%d connections left", n)
	}
	fs2 := mount(t, h)
	if err := fs2.Remove("held.txt"); err != nil {
		t.Errorf("the file must be free again: %v", err)
	}
}

func TestSilentClientIsDropped(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.LoginTimeout = 100 * time.Millisecond })
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := nc.Read(make([]byte, 1)); err == nil {
		t.Error("expected the server to hang up")
	} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Error("the server never hung up")
	}
}

func TestOversizedPreloginFrameIsDropped(t *testing.T) {
	h := newHarness(t)
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	nc.Write([]byte{0, 0x7F, 0xFF, 0xFF})
	nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := nc.Read(make([]byte, 1)); err == nil {
		t.Error("expected the server to hang up")
	} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Error("the server never hung up")
	}
}

func TestDeniedAddressIsDropped(t *testing.T) {
	h := newHarness(t)
	h.backend.mu.Lock()
	h.backend.denied = true
	h.backend.mu.Unlock()
	if _, err := func() (*smb2.Session, error) {
		nc, err := net.Dial("tcp", h.addr)
		if err != nil {
			return nil, err
		}
		defer nc.Close()
		d := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: testUserName, Password: testPassword}}
		return d.Dial(nc)
	}(); err == nil {
		t.Error("a denied address must not log in")
	}
}
