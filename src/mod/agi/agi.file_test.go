package agi

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/storage"
	user "imuslab.com/arozos/mod/user"
)

// newFsTestUser returns a user whose only storage is a read-write local file
// system in a temporary folder, reachable as "test:/". The public hierarchy
// keeps quota bookkeeping (which needs a database) out of the way.
func newFsTestUser(t *testing.T) (*user.User, string) {
	t.Helper()
	dir := t.TempDir()
	fsh := &filesystem.FileSystemHandler{
		Name:                  "test",
		UUID:                  "test",
		Path:                  dir + "/",
		Hierarchy:             "public",
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("test", dir+"/", "public", false),
		Filesystem:            "ext4",
	}
	u := &user.User{
		Username: "alice",
		HomeDirectories: &storage.StoragePool{
			Owner:    "alice",
			Storages: []*filesystem.FileSystemHandler{fsh},
		},
	}
	return u, dir
}

// newFileLibTestVM returns a VM with filelib loaded for a user from newFsTestUser.
func newFileLibTestVM(t *testing.T) (*otto.Otto, string) {
	t.Helper()
	u, dir := newFsTestUser(t)
	vm := otto.New()
	minimalGateway().injectFileLibFunctions(&static.AgiLibInjectionPayload{VM: vm, User: u})
	return vm, dir
}

// Scripts reach the library through the filelib object; a function that is
// registered but never attached to it is undefined for them.
func TestInjectFileLib_JSObjectExposed(t *testing.T) {
	vm, _ := newFileLibTestVM(t)

	present := []string{
		"writeFile", "readFile", "deleteFile", "walk", "glob", "aglob",
		"filesize", "fileExists", "isDir", "md5", "mkdir", "mtime",
		"rootName", "readdir", "readBinaryFile", "writeBinaryFile",
	}
	for _, fn := range present {
		val, err := vm.Run(`typeof filelib.` + fn)
		if err != nil {
			t.Fatalf("evaluating filelib.%s: %v", fn, err)
		}
		if s, _ := val.ToString(); s != "function" {
			t.Errorf("filelib.%s should be a function, got %q", fn, s)
		}
	}
}

func TestFileLibWriteBinaryFile(t *testing.T) {
	cases := []struct {
		name      string
		hex       string
		want      bool
		wantBytes []byte // nil means no file is written
	}{
		{"ascii text", "68656c6c6f", true, []byte("hello")},
		{"zero and high bytes", "00ff10fe", true, []byte{0x00, 0xff, 0x10, 0xfe}},
		{"upper case hex", "DEADBEEF", true, []byte{0xde, 0xad, 0xbe, 0xef}},
		{"empty content", "", true, []byte{}},
		{"invalid hex", "zz", false, nil},
		{"odd length hex", "abc", false, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, dir := newFileLibTestVM(t)
			vm.Set("hexContent", c.hex)
			val, err := vm.Run(`filelib.writeBinaryFile("test:/out.bin", hexContent)`)
			if err != nil {
				t.Fatalf("writeBinaryFile: %v", err)
			}
			if got, _ := val.ToBoolean(); got != c.want {
				t.Fatalf("writeBinaryFile returned %v, want %v", got, c.want)
			}

			content, err := os.ReadFile(filepath.Join(dir, "out.bin"))
			if c.wantBytes == nil {
				if err == nil {
					t.Errorf("a failed write left a file behind: %x", content)
				}
				return
			}
			if err != nil {
				t.Fatalf("file not written: %v", err)
			}
			if !bytes.Equal(content, c.wantBytes) {
				t.Errorf("file holds %x, want %x", content, c.wantBytes)
			}
		})
	}
}

func TestFileLibReadBinaryFile(t *testing.T) {
	cases := []struct {
		name    string
		content []byte // nil means the file does not exist
		want    string
		wantNil bool
	}{
		{"ascii text", []byte("hello"), "68656c6c6f", false},
		{"zero and high bytes", []byte{0x00, 0xff, 0x10, 0xfe}, "00ff10fe", false},
		{"empty file", []byte{}, "", false},
		{"missing file", nil, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, dir := newFileLibTestVM(t)
			if c.content != nil {
				if err := os.WriteFile(filepath.Join(dir, "in.bin"), c.content, 0644); err != nil {
					t.Fatalf("write fixture: %v", err)
				}
			}
			val, err := vm.Run(`filelib.readBinaryFile("test:/in.bin")`)
			if err != nil {
				t.Fatalf("readBinaryFile: %v", err)
			}
			if c.wantNil {
				if !val.IsNull() {
					t.Errorf("readBinaryFile of a missing file = %v, want null", val)
				}
				return
			}
			if got, _ := val.ToString(); got != c.want {
				t.Errorf("readBinaryFile = %q, want %q", got, c.want)
			}
		})
	}
}

// What writeBinaryFile writes, readBinaryFile reads back unchanged.
func TestFileLibBinaryRoundTrip(t *testing.T) {
	vm, _ := newFileLibTestVM(t)
	val, err := vm.Run(`
		var data = "";
		for (var i = 0; i < 256; i++) {
			data += (i < 16 ? "0" : "") + i.toString(16);
		}
		filelib.writeBinaryFile("test:/all.bin", data) && filelib.readBinaryFile("test:/all.bin") === data;
	`)
	if err != nil {
		t.Fatalf("round trip: %v", err)
	}
	if ok, _ := val.ToBoolean(); !ok {
		t.Errorf("bytes 00-ff did not survive a write and read back")
	}
}

// Paths on storage the user has no access to are refused with an exception.
func TestFileLibBinaryPermissionDenied(t *testing.T) {
	cases := []struct {
		name   string
		script string
	}{
		{"read", `filelib.readBinaryFile("other:/x.bin")`},
		{"write", `filelib.writeBinaryFile("other:/x.bin", "00")`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vm, _ := newFileLibTestVM(t)
			if _, err := vm.Run(c.script); err == nil {
				t.Errorf("%s on a storage outside the user's pool should throw", c.name)
			}
		})
	}
}
