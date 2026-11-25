package storage

import (
	"errors"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/emptyfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

// newTestDrive returns an open drive that needs no disk
func newTestDrive(uuid string) *fs.FileSystemHandler {
	return &fs.FileSystemHandler{
		Name:                  uuid,
		UUID:                  uuid,
		Filesystem:            "virtual",
		FileSystemAbstraction: emptyfs.NewEmptyFileSystemAbstraction(),
	}
}

// runBothDebugModes runs a test with debug logging off and on, since the pool
// logs while debug is on and must behave the same either way
func runBothDebugModes(t *testing.T, test func(t *testing.T)) {
	was := logger.IsDebug()
	t.Cleanup(func() { logger.SetDebug(was) })
	for _, enabled := range []bool{false, true} {
		name := "debug off"
		if enabled {
			name = "debug on"
		}
		t.Run(name, func(t *testing.T) {
			logger.SetDebug(enabled)
			test(t)
		})
	}
}

// TestNewStoragePool checks the owner and drives of a new pool
func TestNewStoragePool(t *testing.T) {
	runBothDebugModes(t, func(t *testing.T) {
		sp, err := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("a"), newTestDrive("b")}, "users")
		if err != nil {
			t.Fatalf("NewStoragePool returned error: %v", err)
		}
		if sp.Owner != "users" || len(sp.Storages) != 2 {
			t.Fatalf("pool = %q with %d drives, want users with 2", sp.Owner, len(sp.Storages))
		}
	})
}

// TestAttachDetach checks attaching, refusing a duplicate and detaching
func TestAttachDetach(t *testing.T) {
	runBothDebugModes(t, func(t *testing.T) {
		sp, _ := NewStoragePool(nil, "system")
		tests := []struct {
			name    string
			do      func() error
			wantErr bool
			wantIDs []string
		}{
			{"attach a", func() error { return sp.AttachFsHandler(newTestDrive("a")) }, false, []string{"a"}},
			{"attach b", func() error { return sp.AttachFsHandler(newTestDrive("b")) }, false, []string{"a", "b"}},
			{"attach a twice", func() error { return sp.AttachFsHandler(newTestDrive("a")) }, true, []string{"a", "b"}},
			{"detach a", func() error { sp.DetachFsHandler("a"); return nil }, false, []string{"b"}},
			{"detach missing", func() error { sp.DetachFsHandler("zz"); return nil }, false, []string{"b"}},
		}
		for _, tt := range tests {
			err := tt.do()
			if (err != nil) != tt.wantErr {
				t.Fatalf("%s: err = %v, want error %v", tt.name, err, tt.wantErr)
			}
			if len(sp.Storages) != len(tt.wantIDs) {
				t.Fatalf("%s: %d drives, want %v", tt.name, len(sp.Storages), tt.wantIDs)
			}
			for i, id := range tt.wantIDs {
				if sp.Storages[i].UUID != id {
					t.Errorf("%s: drive %d is %q, want %q", tt.name, i, sp.Storages[i].UUID, id)
				}
			}
		}
	})
}

// TestLookups checks finding drives by id and by virtual path
func TestLookups(t *testing.T) {
	runBothDebugModes(t, func(t *testing.T) {
		sp, _ := NewStoragePool([]*fs.FileSystemHandler{newTestDrive("user"), newTestDrive("S1")}, "system")
		tests := []struct {
			vpath   string
			wantID  string
			wantSub string
			wantErr error
		}{
			{"S1:/Music/a.mp3", "S1", "/Music/a.mp3", nil},
			{"user:/", "user", "", nil},
			{"S9:/x", "", "", arozfs.ErrFSHNotFOund},
		}
		for _, tt := range tests {
			fsh, sub, err := sp.GetFSHandlerFromVirtualPath(tt.vpath)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("%s: err = %v, want %v", tt.vpath, err, tt.wantErr)
				}
				continue
			}
			if err != nil || fsh.UUID != tt.wantID || sub != tt.wantSub {
				t.Errorf("%s: got %v %q %v, want %s %q", tt.vpath, fsh, sub, err, tt.wantID, tt.wantSub)
			}
		}
		if _, _, err := sp.GetFSHandlerFromVirtualPath("no-colon"); err == nil {
			t.Error("a path without a drive id was accepted")
		}
		if !sp.ContainDiskID("S1") || sp.ContainDiskID("S9") {
			t.Error("ContainDiskID answered wrongly")
		}
		if fsh, err := sp.GetFsHandlerByUUID("S1:/"); err != nil || fsh.UUID != "S1" {
			t.Errorf("GetFsHandlerByUUID with a :/ suffix = %v, %v", fsh, err)
		}
	})
}

// TestClose checks that closing a pool closes each open drive
func TestClose(t *testing.T) {
	runBothDebugModes(t, func(t *testing.T) {
		open := newTestDrive("a")
		closed := newTestDrive("b")
		closed.Closed = true
		sp, _ := NewStoragePool([]*fs.FileSystemHandler{open, closed}, "system")
		sp.Close()
		if !open.Closed || !closed.Closed {
			t.Errorf("after Close: a closed=%v, b closed=%v, want both closed", open.Closed, closed.Closed)
		}
	})
}
