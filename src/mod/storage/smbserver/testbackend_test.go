package smbserver

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/auth"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// testShare serves a local folder, standing in for an ArozOS drive.
type testShare struct {
	name     string
	root     string
	readOnly bool

	mu        sync.Mutex
	denyWrite map[string]bool
	denyRead  map[string]bool
	spaceLeft int64 //Negative means unlimited
	changed   []string
	openDelay time.Duration //Stands in for a slow remote drive
	readDelay time.Duration
	closeErr  error //What Close reports, like a failed staged upload
	opened    int   //Files open right now
	pending   int64 //Size the open file claims, like a staged copy; 0 is none
	noPoll    bool  //Like a cloud drive, which cannot be listed often
}

func (s *testShare) full(p string) string { return filepath.Join(s.root, filepath.FromSlash(p)) }

func (s *testShare) Name() string    { return s.name }
func (s *testShare) Comment() string { return "Test drive " + s.name }
func (s *testShare) Key() string     { return s.root }
func (s *testShare) ReadOnly() bool  { return s.readOnly }
func (s *testShare) CanPoll() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.noPoll
}

func (s *testShare) CanRead(p string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.denyRead[p]
}

func (s *testShare) CanWrite(p string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.denyWrite[p]
}

func infoOf(fi os.FileInfo) FileInfo {
	return FileInfo{Name: fi.Name(), Size: fi.Size(), IsDir: fi.IsDir(), ModTime: fi.ModTime()}
}

func (s *testShare) Stat(p string) (FileInfo, error) {
	fi, err := os.Stat(s.full(p))
	if err != nil {
		return FileInfo{}, err
	}
	return infoOf(fi), nil
}

func (s *testShare) ReadDir(p string) ([]FileInfo, error) {
	entries, err := os.ReadDir(s.full(p))
	if err != nil {
		return nil, err
	}
	out := make([]FileInfo, 0, len(entries))
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, infoOf(fi))
	}
	return out, nil
}

func (s *testShare) Open(p string, flag int) (File, error) {
	s.mu.Lock()
	delay := s.openDelay
	s.mu.Unlock()
	time.Sleep(delay)
	f, err := os.OpenFile(s.full(p), flag, 0644)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.opened++
	s.mu.Unlock()
	return &testFile{File: f, share: s}, nil
}

func (s *testShare) openCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opened
}

// testFile is a local file with the delays and failures of its share.
type testFile struct {
	*os.File
	share *testShare
}

func (f *testFile) ReadAt(b []byte, off int64) (int, error) {
	f.share.mu.Lock()
	delay := f.share.readDelay
	f.share.mu.Unlock()
	time.Sleep(delay)
	return f.File.ReadAt(b, off)
}

func (f *testFile) PendingSize() (int64, bool) {
	f.share.mu.Lock()
	defer f.share.mu.Unlock()
	return f.share.pending, f.share.pending != 0
}

func (f *testFile) Close() error {
	f.share.mu.Lock()
	f.share.opened--
	err := f.share.closeErr
	f.share.mu.Unlock()
	if cerr := f.File.Close(); cerr != nil {
		return cerr
	}
	return err
}
func (s *testShare) Mkdir(p string) error                   { return os.Mkdir(s.full(p), 0755) }
func (s *testShare) Remove(p string) error                  { return os.Remove(s.full(p)) }
func (s *testShare) Rename(a, b string) error               { return os.Rename(s.full(a), s.full(b)) }
func (s *testShare) SetModTime(p string, t time.Time) error { return os.Chtimes(s.full(p), t, t) }
func (s *testShare) Usage() (uint64, uint64)                { return 1 << 40, 1 << 39 }

func (s *testShare) HaveSpace(extra int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.spaceLeft < 0 || extra <= s.spaceLeft
}

func (s *testShare) FileChanged(p string, oldSize, newSize int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.changed = append(s.changed, p)
}

type testUser struct {
	name   string
	shares []Share
}

func (u *testUser) Username() string { return u.name }
func (u *testUser) Shares() []Share  { return u.shares }

// testBackend holds one account.
type testBackend struct {
	shares []Share

	mu         sync.Mutex
	logs       []string
	delay      time.Duration
	lastRemote string
	denied     bool
}

const (
	testUserName = "alice"
	testPassword = "correct horse"
)

func (b *testBackend) LookupHash(username string) (string, []byte, bool) {
	if strings.EqualFold(username, testUserName) {
		return testUserName, auth.NTHash(testPassword), true
	}
	return "", nil, false
}

func (b *testBackend) Login(username string) (UserView, error) {
	return &testUser{name: username, shares: b.shares}, nil
}

func (b *testBackend) Allow(ip net.IP) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.denied
}

func (b *testBackend) AuthLog(username, remote string, ok bool) time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	state := "fail"
	if ok {
		state = "ok"
	}
	b.logs = append(b.logs, state+":"+username)
	b.lastRemote = remote
	return b.delay
}

// harness is a running server over a temporary folder.
type harness struct {
	srv     *Server
	backend *testBackend
	share   *testShare
	addr    string
	port    string
}

func newHarness(t *testing.T, tune ...func(*Config)) *harness {
	t.Helper()
	share := &testShare{name: "data", root: t.TempDir(), denyWrite: map[string]bool{}, denyRead: map[string]bool{}, spaceLeft: -1}
	backend := &testBackend{shares: []Share{share}}
	cfg := Config{Address: "127.0.0.1:0", ServerName: "AROZTEST", Backend: backend, LoginDelay: time.Millisecond}
	for _, f := range tune {
		f(&cfg)
	}
	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { srv.Close() })
	addr := srv.Addr().String()
	_, port, _ := net.SplitHostPort(addr)
	return &harness{srv: srv, backend: backend, share: share, addr: addr, port: port}
}

func userSIDString(s *Server) string {
	return wire.UserSID(s.machineSID, testUserName).String()
}
