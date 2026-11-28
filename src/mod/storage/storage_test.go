package storage

import (
	"errors"
	"os"
	"strings"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/emptyfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

// newTestDrive builds a drive handler whose abstraction does nothing
func newTestDrive(uuid string) *fs.FileSystemHandler {
	return &fs.FileSystemHandler{
		Name:                  uuid,
		UUID:                  uuid,
		Filesystem:            "ext4",
		Hierarchy:             "public",
		FileSystemAbstraction: emptyfs.NewEmptyFileSystemAbstraction(),
	}
}

// TestNewStoragePool keeps the given drives and owner.
func TestNewStoragePool(t *testing.T) {
	pool, err := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("a"), newTestDrive("b")}, "users")
	if err != nil {
		t.Fatalf("NewStoragePool returned error: %v", err)
	}
	if pool.Owner != "users" || len(pool.Storages) != 2 {
		t.Errorf("unexpected pool: owner %q, %d drives", pool.Owner, len(pool.Storages))
	}
}

// TestGetFsHandlerByUUID finds drives by id, with or without a path.
func TestGetFsHandlerByUUID(t *testing.T) {
	pool, _ := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("photos"), newTestDrive("music")}, "system")
	tests := []struct {
		id      string
		want    string
		wantErr error
	}{
		{"photos", "photos", nil},
		{"music:/Albums", "music", nil},
		{"video", "", arozfs.ErrFSHNotFOund},
	}
	for _, tt := range tests {
		fsh, err := pool.GetFsHandlerByUUID(tt.id)
		if !errors.Is(err, tt.wantErr) {
			t.Errorf("GetFsHandlerByUUID(%q) error = %v, want %v", tt.id, err, tt.wantErr)
			continue
		}
		if tt.wantErr == nil && fsh.UUID != tt.want {
			t.Errorf("GetFsHandlerByUUID(%q) = %s, want %s", tt.id, fsh.UUID, tt.want)
		}
	}
}

// TestGetFSHandlerFromVirtualPath splits a virtual path into drive and subpath.
func TestGetFSHandlerFromVirtualPath(t *testing.T) {
	pool, _ := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("photos")}, "system")
	fsh, subpath, err := pool.GetFSHandlerFromVirtualPath("photos:/2024/beach.jpg")
	if err != nil {
		t.Fatalf("GetFSHandlerFromVirtualPath returned error: %v", err)
	}
	if fsh.UUID != "photos" || subpath != "/2024/beach.jpg" {
		t.Errorf("got %s %q, want photos /2024/beach.jpg", fsh.UUID, subpath)
	}
	if _, _, err := pool.GetFSHandlerFromVirtualPath("music:/a.mp3"); err == nil {
		t.Error("a drive outside the pool should not be found")
	}
}

// TestAttachDetachFsHandler adds and removes drives, refusing a duplicate id.
func TestAttachDetachFsHandler(t *testing.T) {
	pool, _ := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("a")}, "users")
	if err := pool.AttachFsHandler(newTestDrive("b")); err != nil {
		t.Fatalf("AttachFsHandler returned error: %v", err)
	}
	if err := pool.AttachFsHandler(newTestDrive("b")); err == nil {
		t.Error("a second drive with the same id should be refused")
	}
	if !pool.ContainDiskID("b") || len(pool.Storages) != 2 {
		t.Fatalf("drive b not attached once: %s", fs.DebugHandlerList(pool.Storages))
	}
	pool.DetachFsHandler("a")
	if pool.ContainDiskID("a") || !pool.ContainDiskID("b") {
		t.Errorf("only a should be detached: %s", fs.DebugHandlerList(pool.Storages))
	}
	pool.DetachFsHandler("missing")
	if len(pool.Storages) != 1 {
		t.Errorf("detaching a missing id changed the pool: %s", fs.DebugHandlerList(pool.Storages))
	}
}

// TestStoragePoolClose closes every drive that is still open.
func TestStoragePoolClose(t *testing.T) {
	open := newTestDrive("open")
	closed := newTestDrive("closed")
	closed.Closed = true
	pool, _ := NewStoragePool([]*fs.FileSystemHandler{open, closed}, "users")
	pool.Close()
	if !open.Closed || !closed.Closed {
		t.Errorf("every drive should be closed: %s", fs.DebugHandlerList(pool.Storages))
	}
}

// TestPoolDebugTrace checks the debug lines of pool changes, and that none
// are written while debug is off.
func TestPoolDebugTrace(t *testing.T) {
	tests := []struct {
		enabled bool
		want    []string
	}{
		{false, nil},
		{true, []string{
			"NewStoragePool(system): a nil drive handler was given, it is left out",
			"NewStoragePool(system): 1 drive(s) [media:/]",
			"AttachFsHandler(pool system): \"video\" (video:/",
			"DetachFsHandler(pool system): video:/ detached",
			"GetFSHandlerFromVirtualPath(pool system, \"nowhere:/a\"): drive nowhere:/ is not in this pool",
		}},
	}
	for _, tt := range tests {
		l, err := logger.NewLogger("debug", t.TempDir(), true)
		if err != nil {
			t.Fatalf("NewLogger error: %v", err)
		}
		logger.SetDefaultLogger(l)
		logger.SetDebug(tt.enabled)
		NewStoragePool([]*fs.FileSystemHandler{nil}, "system")
		pool, _ := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("media")}, "system")
		pool.AttachFsHandler(newTestDrive("video"))
		pool.DetachFsHandler("video")
		pool.GetFSHandlerFromVirtualPath("nowhere:/a")
		logger.SetDebug(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
		data, _ := os.ReadFile(l.CurrentLogFile)
		got := string(data)
		if len(tt.want) == 0 && got != "" {
			t.Errorf("debug off: expected no lines, got %q", got)
		}
		for _, want := range tt.want {
			if !strings.Contains(got, want) {
				t.Errorf("debug on: %q missing from %q", want, got)
			}
		}
	}
}

// TestNilHandlersAreSkipped checks that a nil drive handler is left out of a
// new pool, and that one found in a pool anyway is passed over by lookups,
// detaching and closing instead of panicking.
func TestNilHandlersAreSkipped(t *testing.T) {
	pool, _ := NewStoragePool([]*fs.FileSystemHandler{nil, newTestDrive("media"), nil}, "system")
	if len(pool.Storages) != 1 {
		t.Fatalf("pool holds %d drives, want the 1 that is not nil", len(pool.Storages))
	}
	pool.Storages = append(pool.Storages, nil, newTestDrive("music"))
	tests := []struct {
		name string
		run  func() bool
	}{
		{"contains", func() bool { return pool.ContainDiskID("music") && !pool.ContainDiskID("video") }},
		{"lookup", func() bool { fsh, err := pool.GetFsHandlerByUUID("music"); return err == nil && fsh.UUID == "music" }},
		{"lookup missing", func() bool { _, err := pool.GetFsHandlerByUUID("video"); return err != nil }},
	}
	for _, tt := range tests {
		if !tt.run() {
			t.Errorf("%s failed with a nil handler in the pool", tt.name)
		}
	}
	pool.DetachFsHandler("media")
	if len(pool.Storages) != 1 || pool.Storages[0].UUID != "music" {
		t.Errorf("after detaching media the pool holds %s", fs.DebugHandlerList(pool.Storages))
	}
	pool.Storages = append(pool.Storages, nil)
	pool.Close()
	if !pool.Storages[0].Closed {
		t.Error("the drive next to a nil handler was not closed")
	}
}
