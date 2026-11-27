package sftpserver

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/storage/quotafs"
)

// fakeQuota behaves like quota.QuotaHandler: a change must be smaller than
// what is left
type fakeQuota struct {
	lock        sync.Mutex
	total, used int64
	recounted   int
}

func (q *fakeQuota) HaveSpace(size int64) bool {
	q.lock.Lock()
	defer q.lock.Unlock()
	return size < q.total-q.used
}

func (q *fakeQuota) AllocateSpace(n int64) error {
	q.lock.Lock()
	defer q.lock.Unlock()
	q.used += n
	return nil
}

func (q *fakeQuota) ReclaimSpace(n int64) error {
	q.lock.Lock()
	defer q.lock.Unlock()
	q.used -= n
	return nil
}

func (q *fakeQuota) CalculateQuotaUsage() {
	q.lock.Lock()
	defer q.lock.Unlock()
	q.recounted++
}

func (q *fakeQuota) state() (int64, int) {
	q.lock.Lock()
	defer q.lock.Unlock()
	return q.used, q.recounted
}

// userDriveFsa keeps the files of a test drive at the root of its folder
func userDriveFsa(uuid, dir string) filesystem.FileSystemAbstraction {
	return localfs.NewLocalFileSystemAbstraction(uuid, dir, "public", false)
}

// newQuotaTestRoot serves "user", which counts against a quota of 100 bytes
// with 40 used by old.bin, and "public", which does not count and holds
// big.bin (200 bytes) and small.bin (10 bytes).
func newQuotaTestRoot(t *testing.T) (*root, *fakeQuota, string) {
	t.Helper()
	userDir, publicDir := t.TempDir(), t.TempDir()
	for path, size := range map[string]int{
		filepath.Join(userDir, "old.bin"):     40,
		filepath.Join(publicDir, "big.bin"):   200,
		filepath.Join(publicDir, "small.bin"): 10,
	} {
		if err := os.WriteFile(path, []byte(strings.Repeat("o", size)), 0644); err != nil {
			t.Fatalf("WriteFile() = %v", err)
		}
	}
	access := &fakeAccess{
		fshs: []*filesystem.FileSystemHandler{
			{UUID: "user", Hierarchy: "user", FileSystemAbstraction: userDriveFsa("user", userDir)},
			{UUID: "public", Hierarchy: "public", FileSystemAbstraction: userDriveFsa("public", publicDir)},
		},
		levels: map[string]string{"user": "rw", "public": "rw"},
	}
	q := &fakeQuota{total: 100, used: 40}
	return &root{username: "alice", rootFile: &rootFolder{name: "/", isdir: true}, startDirectory: "/", access: access, quota: q}, q, userDir
}

// The writes themselves are tested end to end in TestUploadsAreHeldToTheQuota;
// these are the other changes a client can make
func TestQuotaOnFileCommands(t *testing.T) {
	tests := []struct {
		name     string
		perform  func(fs *root) error
		refused  bool
		wantUsed int64
	}{
		{name: "delete gives space back", wantUsed: 0,
			perform: func(fs *root) error { return fs.unlink("/user/old.bin") }},
		{name: "remove folder gives space back", wantUsed: 40,
			perform: func(fs *root) error {
				if err := fs.mkdir("/user/folder"); err != nil {
					return err
				}
				return fs.rmdir("/user/folder")
			}},
		{name: "rename", wantUsed: 40,
			perform: func(fs *root) error { return fs.rename("/user/old.bin", "/user/new.bin") }},
		{name: "move in that fits", wantUsed: 50,
			perform: func(fs *root) error { return fs.rename("/public/small.bin", "/user/small.bin") }},
		{name: "move in too big", refused: true, wantUsed: 40,
			perform: func(fs *root) error { return fs.rename("/public/big.bin", "/user/big.bin") }},
		{name: "move over a file keeps it", refused: true, wantUsed: 40,
			perform: func(fs *root) error { return fs.rename("/public/big.bin", "/user/old.bin") }},
		{name: "move out", wantUsed: 40,
			perform: func(fs *root) error { return fs.rename("/user/old.bin", "/public/old.bin") }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fs, q, userDir := newQuotaTestRoot(t)
			err := tt.perform(fs)
			if (err == quotafs.ErrQuotaExceeded) != tt.refused || (!tt.refused && err != nil) {
				t.Fatalf("error = %v, want refused %v", err, tt.refused)
			}
			if used, _ := q.state(); used != tt.wantUsed {
				t.Errorf("used = %d, want %d", used, tt.wantUsed)
			}
			if tt.refused {
				info, err := os.Stat(filepath.Join(userDir, "old.bin"))
				if err != nil || info.Size() != 40 {
					t.Errorf("old.bin was changed: %v", err)
				}
			}
		})
	}
}

// A real client uploads through the server
func TestUploadsAreHeldToTheQuota(t *testing.T) {
	tests := []struct {
		name     string
		target   string
		size     int
		total    int64 //0 for the 100 bytes of the test root
		refused  bool
		wantUsed int64
	}{
		{name: "fits", target: "/user/new.bin", size: 50, wantUsed: 90},
		{name: "too big", target: "/user/new.bin", size: 80, refused: true, wantUsed: 40},
		{name: "overwrite that fits", target: "/user/old.bin", size: 90, wantUsed: 90},
		{name: "drive that does not count", target: "/public/new.bin", size: 500, wantUsed: 40},
		//Sent as several writes, of which the first ones fit
		{name: "refused part way", target: "/user/new.bin", size: 100 << 10, total: 50 << 10, refused: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			served, q, userDir := newQuotaTestRoot(t)
			if tt.total != 0 {
				q.total = tt.total
			}
			rig := newServerRigFor(t, served.access, q, false)
			conn, client, err := rig.dial(t, "secret")
			if err != nil {
				t.Fatalf("dial() = %v", err)
			}

			f, err := client.Create(tt.target)
			if err != nil {
				t.Fatalf("Create() = %v", err)
			}
			_, writeErr := f.Write([]byte(strings.Repeat("n", tt.size)))
			if err := f.Close(); err != nil {
				t.Fatalf("Close() = %v", err)
			}
			if tt.refused {
				if writeErr == nil || !strings.Contains(writeErr.Error(), quotafs.ErrQuotaExceeded.Error()) {
					t.Errorf("write error = %v, want %v", writeErr, quotafs.ErrQuotaExceeded)
				}
				if info, err := os.Stat(filepath.Join(userDir, "new.bin")); err == nil && info.Size() >= q.total-40 {
					t.Errorf("%d bytes were stored past the quota", info.Size())
				}
			} else if writeErr != nil {
				t.Errorf("write error = %v", writeErr)
			}
			if used, _ := q.state(); !tt.refused && used != tt.wantUsed {
				t.Errorf("used = %d, want %d", used, tt.wantUsed)
			}

			//The usage is recalculated once the client is gone
			client.Close()
			conn.Close()
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, recounted := q.state(); recounted > 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("the usage was not recalculated")
				}
				time.Sleep(5 * time.Millisecond)
			}
		})
	}
}
