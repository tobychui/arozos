package aroz

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/storage/smbserver"
)

// fakeAccount stands in for the signed in user. levels holds what the user may
// do per drive id: "r", "rw", or nothing for a drive they cannot use.
type fakeAccount struct {
	fshs   []*filesystem.FileSystemHandler
	levels map[string]string
}

func (a *fakeAccount) levelOf(vpath string) string {
	return a.levels[strings.SplitN(vpath, ":", 2)[0]]
}

func (a *fakeAccount) GetAllFileSystemHandler() []*filesystem.FileSystemHandler {
	return a.fshs
}

func (a *fakeAccount) CanRead(vpath string) bool  { return a.levelOf(vpath) != "" }
func (a *fakeAccount) CanWrite(vpath string) bool { return a.levelOf(vpath) == "rw" }

// noCredentials is a store with nobody in it.
type noCredentials struct{}

func (noCredentials) Lookup(string) (string, []byte, bool) { return "", nil, false }

type fakeQuota struct {
	left      int64
	allocated int64
	reclaimed int64
}

func (q *fakeQuota) HaveSpace(size int64) bool { return size < q.left }
func (q *fakeQuota) AllocateSpace(n int64) error {
	q.allocated += n
	return nil
}
func (q *fakeQuota) ReclaimSpace(n int64) error {
	q.reclaimed += n
	return nil
}

func drive(t *testing.T, uuid, hierarchy string) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	return &filesystem.FileSystemHandler{
		UUID:                  uuid,
		Name:                  "Drive " + uuid,
		Hierarchy:             hierarchy,
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction(uuid, dir, hierarchy, false),
	}, dir
}

func loginAs(t *testing.T, username string, account *fakeAccount, quota Quota) smbserver.UserView {
	t.Helper()
	b, err := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, quota, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	v, err := b.Login(username)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func onlyShare(t *testing.T, v smbserver.UserView) smbserver.Share {
	t.Helper()
	shares := v.Shares()
	if len(shares) != 1 {
		t.Fatalf("shares = %d", len(shares))
	}
	return shares[0]
}

func TestNewNeedsItsDependencies(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Error("expected an error")
	}
}

func TestSharesSkipUnusableDrives(t *testing.T) {
	normal, _ := drive(t, "media", "public")
	closed, _ := drive(t, "gone", "public")
	closed.Closed = true
	staged, _ := drive(t, "cloud", "public")
	staged.RequireBuffer = true

	v := loginAs(t, "alice", &fakeAccount{fshs: []*filesystem.FileSystemHandler{normal, closed, staged}, levels: map[string]string{"media": "rw"}}, nil)
	s := onlyShare(t, v)
	if s.Name() != "media" || s.Comment() != "Drive media" {
		t.Errorf("share = %s, %s", s.Name(), s.Comment())
	}
}

func TestAccessIsAskedPerOperation(t *testing.T) {
	fsh, _ := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	s := onlyShare(t, loginAs(t, "alice", account, nil))
	if !s.CanWrite("a.txt") {
		t.Fatal("expected write access")
	}
	account.levels["media"] = "r"
	if s.CanWrite("a.txt") {
		t.Error("a rule change must reach the session")
	}
	if !s.CanRead("a.txt") {
		t.Error("read must stay")
	}
}

func TestFileOperations(t *testing.T) {
	fsh, dir := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	s := onlyShare(t, loginAs(t, "alice", account, nil))

	if err := s.Mkdir("docs"); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	f, err := s.Open("docs/a.txt", os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := f.WriteAt([]byte("hello"), 0); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := f.Truncate(4); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := f.Sync(); err != nil {
		t.Fatalf("sync: %v", err)
	}
	f.Close()

	info, err := s.Stat("docs/a.txt")
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Name != "a.txt" || info.Size != 4 || info.IsDir {
		t.Errorf("info = %+v", info)
	}
	if info.ID == 0 {
		t.Log("no inode on this platform, the core hashes the path")
	}

	list, err := s.ReadDir("docs")
	if err != nil || len(list) != 1 || list[0].Name != "a.txt" {
		t.Fatalf("readdir: %+v %v", list, err)
	}

	when := time.Date(2022, 2, 2, 2, 2, 2, 0, time.UTC)
	if err := s.SetModTime("docs/a.txt", when); err != nil {
		t.Fatalf("set time: %v", err)
	}
	if fi, _ := os.Stat(filepath.Join(dir, "docs", "a.txt")); !fi.ModTime().Equal(when) {
		t.Errorf("mod time = %v", fi.ModTime())
	}

	if err := s.Rename("docs/a.txt", "docs/b.txt"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := s.Remove("docs/b.txt"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := s.Remove("docs"); err != nil {
		t.Fatalf("remove folder: %v", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("left behind: %v", entries)
	}
}

func TestUserDriveIsPerUser(t *testing.T) {
	fsh, dir := drive(t, "user", "user")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"user": "rw"}}
	alice := onlyShare(t, loginAs(t, "alice", account, nil))
	bob := onlyShare(t, loginAs(t, "bob", account, nil))

	if alice.Key() == bob.Key() {
		t.Error("two users' folders must not share locks")
	}
	f, err := alice.Open("mine.txt", os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	f.Close()

	if _, err := bob.Stat("mine.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("bob must not see alice's file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "users", "alice", "mine.txt")); err != nil {
		t.Errorf("alice's file is not in her folder: %v", err)
	}
}

func TestPublicDriveKeyIsShared(t *testing.T) {
	fsh, _ := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	alice := onlyShare(t, loginAs(t, "alice", account, nil))
	bob := onlyShare(t, loginAs(t, "bob", account, nil))
	if alice.Key() != bob.Key() {
		t.Error("the same files must share locks across users")
	}
}

func TestLinksMustStayOnTheDrive(t *testing.T) {
	fsh, dir := drive(t, "media", "public")
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	os.WriteFile(secret, []byte("secret"), 0644)
	os.WriteFile(filepath.Join(dir, "inside.txt"), []byte("ok"), 0644)

	if err := os.Symlink(secret, filepath.Join(dir, "file-link")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	os.Symlink(outside, filepath.Join(dir, "dir-link"))
	os.Symlink(filepath.Join(dir, "inside.txt"), filepath.Join(dir, "good-link"))
	os.Symlink(filepath.Join(outside, "not-yet"), filepath.Join(dir, "dangling"))

	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	s := onlyShare(t, loginAs(t, "alice", account, nil))

	cases := []struct {
		name    string
		perform func() error
	}{
		{"stat a link out", func() error { _, err := s.Stat("file-link"); return err }},
		{"open a link out", func() error { _, err := s.Open("file-link", os.O_RDONLY); return err }},
		{"list through a link", func() error { _, err := s.ReadDir("dir-link"); return err }},
		{"create below a link", func() error { _, err := s.Open("dir-link/new.txt", os.O_RDWR|os.O_CREATE); return err }},
		{"write through a dangling link", func() error { _, err := s.Open("dangling", os.O_RDWR|os.O_CREATE); return err }},
		{"rename to below a link", func() error { return s.Rename("inside.txt", "dir-link/moved.txt") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := c.perform(); !errors.Is(err, os.ErrPermission) {
				t.Errorf("err = %v", err)
			}
		})
	}
	if _, err := os.Stat(filepath.Join(outside, "new.txt")); err == nil {
		t.Error("a file escaped the drive")
	}
	if _, err := os.Stat(filepath.Join(outside, "not-yet")); err == nil {
		t.Error("a dangling link was written through")
	}

	if got, err := s.Stat("good-link"); err != nil || got.Size != 2 {
		t.Errorf("a link inside the drive must work: %+v %v", got, err)
	}

	list, err := s.ReadDir("")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range list {
		if e.Name == "file-link" || e.Name == "dir-link" {
			t.Errorf("%s leads off the drive and must not be listed", e.Name)
		}
	}
}

func TestQuotaOnlyAppliesToUserDrives(t *testing.T) {
	userDrive, _ := drive(t, "user", "user")
	public, _ := drive(t, "media", "public")
	q := &fakeQuota{left: 100}
	levels := map[string]string{"user": "rw", "media": "rw"}

	u := onlyShare(t, loginAs(t, "alice", &fakeAccount{fshs: []*filesystem.FileSystemHandler{userDrive}, levels: levels}, q))
	p := onlyShare(t, loginAs(t, "alice", &fakeAccount{fshs: []*filesystem.FileSystemHandler{public}, levels: levels}, q))

	if u.HaveSpace(1000) {
		t.Error("the user drive must be limited")
	}
	if !p.HaveSpace(1000) {
		t.Error("a public drive is not in the user's quota")
	}

	u.FileChanged("a", -1, 50)
	if q.allocated != 50 {
		t.Errorf("a new file: allocated %d", q.allocated)
	}
	u.FileChanged("a", 50, 80)
	if q.allocated != 80 {
		t.Errorf("growth: allocated %d", q.allocated)
	}
	u.FileChanged("a", 80, 30)
	if q.reclaimed != 50 {
		t.Errorf("shrink: reclaimed %d", q.reclaimed)
	}
	p.FileChanged("a", -1, 999)
	if q.allocated != 80 {
		t.Error("a public drive must not touch the quota")
	}
}

func TestRemoveGivesQuotaBack(t *testing.T) {
	fsh, _ := drive(t, "user", "user")
	q := &fakeQuota{left: 1 << 20}
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"user": "rw"}}
	s := onlyShare(t, loginAs(t, "alice", account, q))
	f, err := s.Open("a.bin", os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteAt(make([]byte, 100), 0)
	f.Close()
	if err := s.Remove("a.bin"); err != nil {
		t.Fatal(err)
	}
	if q.reclaimed != 100 {
		t.Errorf("reclaimed %d", q.reclaimed)
	}
}

func TestRenameOverAFileGivesItsQuotaBack(t *testing.T) {
	fsh, _ := drive(t, "user", "user")
	q := &fakeQuota{left: 1 << 20}
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"user": "rw"}}
	s := onlyShare(t, loginAs(t, "alice", account, q))
	for _, name := range []string{"a.bin", "b.bin"} {
		f, err := s.Open(name, os.O_RDWR|os.O_CREATE)
		if err != nil {
			t.Fatal(err)
		}
		f.WriteAt(make([]byte, 40), 0)
		f.Close()
	}
	if err := s.Rename("a.bin", "b.bin"); err != nil {
		t.Fatal(err)
	}
	if q.reclaimed != 40 {
		t.Errorf("reclaimed %d", q.reclaimed)
	}
}

func TestUsage(t *testing.T) {
	fsh, _ := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}

	s := onlyShare(t, loginAs(t, "alice", account, nil))
	if total, free := s.Usage(); total == 0 || free == 0 {
		t.Error("an unknown size must still look usable")
	}

	b, _ := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		Capacity: func(username, vpath string) (uint64, uint64, bool) {
			if username != "alice" || vpath != "media:/" {
				t.Errorf("asked for %s %s", username, vpath)
			}
			return 1000, 400, true
		},
	})
	v, _ := b.Login("alice")
	if total, free := onlyShare(t, v).Usage(); total != 1000 || free != 400 {
		t.Errorf("usage = %d %d", total, free)
	}
}

func TestUsageIsCached(t *testing.T) {
	fsh, _ := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	calls := 0
	b, _ := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		Capacity: func(string, string) (uint64, uint64, bool) {
			calls++
			return 1000, 400, true
		},
	})
	v, _ := b.Login("alice")
	for i := 0; i < 5; i++ {
		onlyShare(t, v).Usage()
	}
	if calls != 1 {
		t.Errorf("the size was worked out %d times", calls)
	}
}

func TestAddressRules(t *testing.T) {
	b, _ := New(Options{Credentials: noCredentials{}, LookupUser: func(string) (Account, Quota, error) { return nil, nil, nil }})
	cases := []struct {
		ip   string
		want bool
	}{
		{"192.168.0.26", true},
		{"10.1.2.3", true},
		{"127.0.0.1", true},
		{"fd00::1", true},
		{"fe80::1", true},
		{"8.8.8.8", false},
		{"2001:4860:4860::8888", false},
	}
	for _, c := range cases {
		if got := b.Allow(net.ParseIP(c.ip)); got != c.want {
			t.Errorf("%s: %v", c.ip, got)
		}
	}
	if b.Allow(nil) {
		t.Error("an unknown address must be refused")
	}

	open, _ := New(Options{Credentials: noCredentials{}, LookupUser: func(string) (Account, Quota, error) { return nil, nil, nil }, AllowPublicAddresses: true})
	if !open.Allow(net.ParseIP("8.8.8.8")) {
		t.Error("an admin may open this up")
	}

	banned, _ := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return nil, nil, nil },
		AllowIP:     func(ip string) bool { return ip != "192.168.0.99" },
	})
	if banned.Allow(net.ParseIP("192.168.0.99")) {
		t.Error("the system's IP rules must apply")
	}
}

func TestAuthLogIsForwarded(t *testing.T) {
	logged := ""
	b, _ := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return nil, nil, nil },
		LogAuth:     func(username, remote string, ok bool) { logged = username + "@" + remote },
	})
	b.AuthLog("alice", "1.2.3.4", true)
	if logged != "alice@1.2.3.4" {
		t.Errorf("logged %q", logged)
	}
}

func TestFailureDelayIsForwarded(t *testing.T) {
	b, _ := New(Options{
		Credentials:  noCredentials{},
		LookupUser:   func(string) (Account, Quota, error) { return nil, nil, nil },
		FailureDelay: func(string, string, bool) time.Duration { return 7 * time.Second },
	})
	if got := b.AuthLog("alice", "1.2.3.4", false); got != 7*time.Second {
		t.Errorf("delay = %v", got)
	}
}

func TestLoginErrorIsPassedOn(t *testing.T) {
	b, _ := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return nil, nil, errors.New("no such user") },
	})
	if _, err := b.Login("ghost"); err == nil {
		t.Error("expected an error")
	}
}
