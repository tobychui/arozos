package ftpfs

import (
	"bytes"
	"crypto/tls"
	"errors"
	"io"
	"io/fs"
	"os"
	"testing"

	ftpserver "github.com/fclairamb/ftpserverlib"
	"github.com/spf13/afero"
)

// memDriver serves an in-memory folder, with or without MLST.
type memDriver struct {
	fs     afero.Fs
	noMLST bool
}

func (d *memDriver) GetSettings() (*ftpserver.Settings, error) {
	return &ftpserver.Settings{ListenAddr: "127.0.0.1:0", PublicHost: "127.0.0.1", DisableMLST: d.noMLST}, nil
}
func (d *memDriver) ClientConnected(ftpserver.ClientContext) (string, error) { return "test", nil }
func (d *memDriver) ClientDisconnected(ftpserver.ClientContext)              {}
func (d *memDriver) AuthUser(_ ftpserver.ClientContext, user, pass string) (ftpserver.ClientDriver, error) {
	if user == "tester" && pass == "secret" {
		return d.fs, nil
	}
	return nil, errors.New("denied")
}
func (d *memDriver) GetTLSConfig() (*tls.Config, error) { return nil, errors.New("no tls") }

func startServer(t *testing.T, noMLST bool) (FTPFSAbstraction, afero.Fs) {
	t.Helper()
	mem := afero.NewMemMapFs()
	srv := ftpserver.NewFtpServer(&memDriver{fs: mem, noMLST: noMLST})
	if err := srv.Listen(); err != nil {
		t.Fatal(err)
	}
	go srv.Serve()
	t.Cleanup(func() { srv.Stop() })
	l, err := NewFTPFSAbstraction("ftp", "public", srv.Addr(), "tester", "secret")
	if err != nil {
		t.Fatal(err)
	}
	return l, mem
}

func TestStat(t *testing.T) {
	for _, noMLST := range []bool{false, true} {
		l, mem := startServer(t, noMLST)
		mem.MkdirAll("/docs", 0755)
		afero.WriteFile(mem, "/docs/a.txt", []byte("hello"), 0644)

		tests := []struct {
			path  string
			isDir bool
			size  int64
			name  string
		}{
			{"/docs/a.txt", false, 5, "a.txt"},
			{"/docs", true, 0, "docs"},
			{"/", true, 0, "/"},
		}
		for _, tt := range tests {
			info, err := l.Stat(tt.path)
			if err != nil {
				t.Errorf("mlst off=%v %s: %v", noMLST, tt.path, err)
				continue
			}
			if info.IsDir() != tt.isDir || info.Name() != tt.name {
				t.Errorf("mlst off=%v %s: dir=%v name=%q", noMLST, tt.path, info.IsDir(), info.Name())
			}
			if !tt.isDir && info.Size() != tt.size {
				t.Errorf("mlst off=%v %s: size %d", noMLST, tt.path, info.Size())
			}
		}
		if _, err := l.Stat("/docs/missing.txt"); !errors.Is(err, fs.ErrNotExist) || !os.IsNotExist(err) {
			t.Errorf("mlst off=%v: missing file gave %v", noMLST, err)
		}
		if !l.FileExists("/docs/a.txt") || l.FileExists("/nothing") {
			t.Errorf("mlst off=%v: FileExists is wrong", noMLST)
		}
		if !l.IsDir("/docs") || l.IsDir("/docs/a.txt") {
			t.Errorf("mlst off=%v: IsDir is wrong", noMLST)
		}
	}
}

func TestMissingFilesReportNotExist(t *testing.T) {
	l, _ := startServer(t, false)
	if _, err := l.ReadStream("/nothing.bin"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("ReadStream: %v", err)
	}
	if _, err := l.ReadDir("/nothing"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("ReadDir: %v", err)
	}
	if err := l.Remove("/nothing.bin"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Remove: %v", err)
	}
}

func TestMkdirOfAnExistingFolder(t *testing.T) {
	l, mem := startServer(t, false)
	mem.MkdirAll("/docs", 0755)
	if err := l.Mkdir("/docs", 0755); !errors.Is(err, fs.ErrExist) {
		t.Errorf("err = %v", err)
	}
	if err := l.Mkdir("/fresh", 0755); err != nil {
		t.Errorf("err = %v", err)
	}
}

func TestReadStreamReadsTheWholeFile(t *testing.T) {
	l, mem := startServer(t, false)
	data := bytes.Repeat([]byte("0123456789abcdef"), 1<<16) //1 MiB
	afero.WriteFile(mem, "/big.bin", data, 0644)
	rc, err := l.ReadStream("/big.bin")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if err := rc.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Errorf("read %d bytes, want %d", len(got), len(data))
	}
}
