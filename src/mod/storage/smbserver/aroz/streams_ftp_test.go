package aroz

import (
	"crypto/tls"
	"errors"
	"os"
	"path"
	"path/filepath"
	"testing"

	ftpserver "github.com/fclairamb/ftpserverlib"
	"github.com/spf13/afero"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/ftpfs"
	"imuslab.com/arozos/mod/storage/smbserver"
)

// strictFs refuses a folder whose parent is missing, as a real FTP server
// does; the in-memory one quietly makes the parents.
type strictFs struct{ afero.Fs }

func (s strictFs) Mkdir(name string, perm os.FileMode) error {
	if _, err := s.Fs.Stat(path.Dir(name)); err != nil {
		return err
	}
	return s.Fs.Mkdir(name, perm)
}

type ftpDriver struct{ fs afero.Fs }

func (d *ftpDriver) GetSettings() (*ftpserver.Settings, error) {
	return &ftpserver.Settings{ListenAddr: "127.0.0.1:0", PublicHost: "127.0.0.1"}, nil
}
func (d *ftpDriver) ClientConnected(ftpserver.ClientContext) (string, error) { return "test", nil }
func (d *ftpDriver) ClientDisconnected(ftpserver.ClientContext)              {}
func (d *ftpDriver) AuthUser(_ ftpserver.ClientContext, user, pass string) (ftpserver.ClientDriver, error) {
	if user == "tester" && pass == "secret" {
		return strictFs{d.fs}, nil
	}
	return nil, errors.New("denied")
}
func (d *ftpDriver) GetTLSConfig() (*tls.Config, error) { return nil, errors.New("no tls") }

func ftpShare(t *testing.T) (smbserver.Share, afero.Fs) {
	t.Helper()
	mem := afero.NewMemMapFs()
	srv := ftpserver.NewFtpServer(&ftpDriver{fs: mem})
	if err := srv.Listen(); err != nil {
		t.Fatal(err)
	}
	go srv.Serve()
	t.Cleanup(func() { srv.Stop() })
	fsa, err := ftpfs.NewFTPFSAbstraction("ftp", "public", srv.Addr(), "tester", "secret")
	if err != nil {
		t.Fatal(err)
	}
	fsh := &filesystem.FileSystemHandler{UUID: "ftp", Name: "FTP", Hierarchy: "public", RequireBuffer: true, Filesystem: "ftp", FileSystemAbstraction: fsa}
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"ftp": "rw"}}
	b, err := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		StageDir:    filepath.Join(t.TempDir(), "stage"),
	})
	if err != nil {
		t.Fatal(err)
	}
	v, err := b.Login("alice")
	if err != nil {
		t.Fatal(err)
	}
	return onlyShare(t, v), mem
}

// FTP has no command that makes parents, and refuses a folder that exists:
// the first stream of a file needs three new folders, the second none.
func TestStreamsOnAnFTPDrive(t *testing.T) {
	s, mem := ftpShare(t)
	mem.MkdirAll("/docs", 0755)
	afero.WriteFile(mem, "/docs/a.txt", []byte("data"), 0644)

	tests := []struct {
		name, base, stream, content string
	}{
		{"fresh sidecar", "docs/a.txt", "Zone.Identifier", "[ZoneTransfer]"},
		{"existing sidecar", "docs/a.txt", "AFP_AfpInfo", "info"},
		{"the root", "", "AFP_AfpInfo", "root info"},
	}
	for _, tt := range tests {
		writeStream(t, s, streamOf(tt.base, tt.stream), tt.content)
		if got := readStream(t, s, streamOf(tt.base, tt.stream)); got != tt.content {
			t.Errorf("%s: read back %q", tt.name, got)
		}
	}
	if n := len(s.(smbserver.StreamShare).Streams("docs/a.txt")); n != 2 {
		t.Errorf("%d streams on the file", n)
	}
	if got, _ := afero.ReadFile(mem, "/docs/a.txt"); string(got) != "data" {
		t.Error("the file's own data must not change")
	}
}
