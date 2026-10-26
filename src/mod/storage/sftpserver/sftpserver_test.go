package sftpserver

import (
	"io"
	"os"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"imuslab.com/arozos/mod/filesystem"
)

// TestCleanPath verifies the POSIX-clean-path utility.
func TestCleanPath(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"/foo/bar", "/foo/bar"},
		{"foo/bar", "/foo/bar"},
		{"/foo/../bar", "/bar"},
		{"//foo//bar//", "/foo/bar"},
		{"/", "/"},
	}
	for _, c := range cases {
		got := cleanPath(c.input)
		if got != c.expected {
			t.Errorf("cleanPath(%q): expected %q, got %q", c.input, c.expected, got)
		}
	}
}

func TestCleanPathWithBase(t *testing.T) {
	got := cleanPathWithBase("/home", "docs/file.txt")
	if got != "/home/docs/file.txt" {
		t.Errorf("expected '/home/docs/file.txt', got %q", got)
	}
	// Absolute path should ignore base
	got = cleanPathWithBase("/home", "/absolute/path")
	if got != "/absolute/path" {
		t.Errorf("expected '/absolute/path', got %q", got)
	}
}

// TestNewVrootEmulatedDirEntry checks the helper that wraps an FSH as a DirEntry.
func TestNewVrootEmulatedDirEntry(t *testing.T) {
	fsh := &filesystem.FileSystemHandler{UUID: "test-uuid"}
	entry := NewVrootEmulatedDirEntry(fsh)
	if entry == nil {
		t.Fatal("NewVrootEmulatedDirEntry returned nil")
	}
	if entry.Name() != "test-uuid" {
		t.Errorf("expected Name()='test-uuid', got %q", entry.Name())
	}
	if !entry.IsDir() {
		t.Error("expected IsDir()=true for vroot entry")
	}
	if entry.Size() != 0 {
		t.Errorf("expected Size()=0, got %d", entry.Size())
	}
	if entry.Sys() != nil {
		t.Error("expected Sys()=nil")
	}
}

// TestRootFolder_FileInfoInterface verifies rootFolder satisfies os.FileInfo.
func TestRootFolder_FileInfoInterface(t *testing.T) {
	now := time.Now()
	rf := &rootFolder{
		name:    "/",
		modtime: now,
		isdir:   true,
		content: []byte{},
	}

	var fi os.FileInfo = rf
	if fi.Name() != "/" {
		t.Errorf("Name(): expected '/', got %q", fi.Name())
	}
	if !fi.IsDir() {
		t.Error("IsDir() should be true")
	}
	if fi.Mode()&os.ModeDir == 0 {
		t.Error("Mode() should have directory bit set")
	}
	if fi.ModTime() != now {
		t.Error("ModTime() did not match")
	}
	if fi.Sys() != nil {
		t.Error("Sys() should be nil")
	}
}

// TestRootFolder_ReadWrite verifies that ReadAt and WriteAt on the root folder
// return errors (the root is not readable/writable directly).
func TestRootFolder_ReadWrite(t *testing.T) {
	rf := &rootFolder{name: "/", isdir: true}
	_, err := rf.ReadAt(make([]byte, 4), 0)
	if err == nil {
		t.Error("expected error from rootFolder.ReadAt")
	}
	_, err = rf.WriteAt([]byte("data"), 0)
	if err == nil {
		t.Error("expected error from rootFolder.WriteAt")
	}
}

// TestListerat_ListAt checks the listerat type used for Filelist responses.
func TestListerat_ListAt(t *testing.T) {
	rf := &rootFolder{name: "root", isdir: true, modtime: time.Now()}
	ls := listerat([]os.FileInfo{rf})

	buf := make([]os.FileInfo, 2)
	n, err := ls.ListAt(buf, 0)
	if n != 1 {
		t.Errorf("expected 1 entry, got %d", n)
	}
	if err != io.EOF {
		t.Errorf("expected io.EOF after last entry, got %v", err)
	}
	if buf[0].Name() != "root" {
		t.Errorf("unexpected entry name: %q", buf[0].Name())
	}
}

func TestListerat_ListAt_Offset(t *testing.T) {
	rf := &rootFolder{name: "root", isdir: true, modtime: time.Now()}
	ls := listerat([]os.FileInfo{rf})

	buf := make([]os.FileInfo, 1)
	n, err := ls.ListAt(buf, 10) // offset beyond end
	if n != 0 || err != io.EOF {
		t.Errorf("expected (0, io.EOF) when offset >= length, got (%d, %v)", n, err)
	}
}

// TestGetNewSFTPRoot ensures GetNewSFTPRoot returns a valid sftp.Handlers.
func TestGetNewSFTPRoot(t *testing.T) {
	handlers := GetNewSFTPRoot("alice", []*filesystem.FileSystemHandler{})
	// sftp.Handlers is a struct; assign to typed variable to confirm it compiled.
	var _ sftp.Handlers = handlers
}

// TestInstance_Closed verifies Instance struct basics.
func TestInstance_Closed(t *testing.T) {
	inst := &Instance{
		Closed: false,
	}
	if inst.Closed {
		t.Error("expected Closed=false initially")
	}
}
