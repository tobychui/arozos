package ftp

import (
	"os"
	"sort"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

// newTestAofs returns an aofs whose user can reach a local storage, a
// buffered remote storage and a closed storage.
func newTestAofs() aofs {
	return aofs{
		userinfo: &user.User{
			Username: "alice",
			HomeDirectories: &storage.StoragePool{
				Storages: []*filesystem.FileSystemHandler{
					{UUID: "user"},
					{UUID: "remote", RequireBuffer: true},
					{UUID: "closed", Closed: true},
				},
			},
		},
	}
}

func TestIsVirtualRootPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/", true},
		{"/README.txt", true},
		{"/user/../README.txt", true},
		{"/user", false},
		{"/user/README.txt", false},
		{"/readme.txt", false},
	}
	for _, c := range cases {
		if got := isVirtualRootPath(c.path); got != c.want {
			t.Errorf("isVirtualRootPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

func TestRootListing(t *testing.T) {
	a := newTestAofs()

	fi, err := a.Stat("/")
	if err != nil {
		t.Fatalf("Stat root: %v", err)
	}
	if !fi.IsDir() {
		t.Error("expected root to be a directory")
	}

	f, err := a.Open("/")
	if err != nil {
		t.Fatalf("Open root: %v", err)
	}
	defer f.Close()
	names, err := f.Readdirnames(-1)
	if err != nil {
		t.Fatalf("Readdirnames: %v", err)
	}
	sort.Strings(names)
	want := []string{"README.txt", "user"}
	if len(names) != len(want) {
		t.Fatalf("root entries = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("root entries = %v, want %v", names, want)
			break
		}
	}
}

func TestRootReadmeReadable(t *testing.T) {
	a := newTestAofs()
	f, err := a.Open("/README.txt")
	if err != nil {
		t.Fatalf("Open README: %v", err)
	}
	defer f.Close()
	buf := make([]byte, 64)
	n, _ := f.Read(buf)
	if n == 0 {
		t.Error("expected README.txt to have content")
	}
}

func TestRootIsReadOnly(t *testing.T) {
	a := newTestAofs()

	if _, err := a.OpenFile("/README.txt", os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
		t.Error("expected writing README.txt to fail")
	}
	if _, err := a.Create("/README.txt"); err == nil {
		t.Error("expected creating README.txt to fail")
	}
	if err := a.Remove("/README.txt"); err == nil {
		t.Error("expected removing README.txt to fail")
	}
	if err := a.Mkdir("/", 0755); err == nil {
		t.Error("expected mkdir on root to fail")
	}
	if err := a.Rename("/README.txt", "/user/README.txt"); err == nil {
		t.Error("expected renaming README.txt to fail")
	}
}

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebug(enabled)
	t.Cleanup(func() {
		logger.SetDebug(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return func() string {
		data, err := os.ReadFile(l.CurrentLogFile)
		if err != nil {
			t.Fatalf("ReadFile error: %v", err)
		}
		return string(data)
	}
}

// TestAofsDebug checks the debug records of FTP requests.
func TestAofsDebug(t *testing.T) {
	tests := []struct {
		name string
		run  func()
		want string
	}{
		{"no user", func() { aofs{}.debugf("Stat %q", "/a") }, "[FTP] <no user>: Stat \"/a\""},
		{"user", func() { newTestAofs().debugf("Stat %q", "/a") }, "[FTP] alice: Stat \"/a\""},
		{"unknown drive", func() { newTestAofs().pathRewrite("/missing/a.txt") }, "drive missing:/ is not open to this user"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		tt.run()
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q does not contain %q", tt.name, got, tt.want)
		}
	}
}
