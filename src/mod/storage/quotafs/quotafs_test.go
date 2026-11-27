package quotafs

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// fakeQuota behaves like quota.QuotaHandler: a change must be smaller than
// what is left, and a total of -1 is no limit
type fakeQuota struct {
	total, used int64
}

func (q *fakeQuota) HaveSpace(size int64) bool   { return q.total == -1 || size < q.total-q.used }
func (q *fakeQuota) AllocateSpace(n int64) error { q.used += n; return nil }
func (q *fakeQuota) ReclaimSpace(n int64) error  { q.used = max(q.used-n, 0); return nil }
func (q *fakeQuota) CalculateQuotaUsage()        {}
func newDrive(dir, hierarchy string, q Quota) Drive {
	return For(&filesystem.FileSystemHandler{
		UUID:                  "user",
		Hierarchy:             hierarchy,
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("user", dir, hierarchy, false),
	}, q)
}

// newFile makes a file of size bytes and returns its path
func newFile(t *testing.T, dir, name string, size int) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("MkdirAll() = %v", err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("o", size)), 0644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	return path
}

func TestOnlyUserDrivesAreTracked(t *testing.T) {
	tests := []struct {
		name      string
		hierarchy string
		quota     Quota
		tracked   bool
	}{
		{name: "user drive", hierarchy: "user", quota: &fakeQuota{total: 10}, tracked: true},
		{name: "public drive", hierarchy: "public", quota: &fakeQuota{total: 10}},
		{name: "no quota", hierarchy: "user"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			d := newDrive(dir, tt.hierarchy, tt.quota)
			if d.Tracked() != tt.tracked {
				t.Fatalf("Tracked() = %v, want %v", d.Tracked(), tt.tracked)
			}
			f, err := d.OpenFile(filepath.Join(dir, "a.bin"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
			if err != nil {
				t.Fatalf("OpenFile() = %v", err)
			}
			defer f.Close()
			_, err = f.Write(make([]byte, 100))
			if tt.tracked != errors.Is(err, ErrQuotaExceeded) {
				t.Fatalf("Write() = %v, tracked %v", err, tt.tracked)
			}
			if !tt.tracked && (!d.HaveSpace(1000) || d.Claim(1000) != nil) {
				t.Fatalf("an untracked drive has a limit")
			}
		})
	}
}

func TestFileWritesAreHeldToTheQuota(t *testing.T) {
	const trunc = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	const keep = os.O_RDWR | os.O_CREATE

	write := func(n int) func(*File) error {
		return func(f *File) error {
			_, err := f.Write(make([]byte, n))
			return err
		}
	}
	writeAt := func(off int64, n int) func(*File) error {
		return func(f *File) error {
			_, err := f.WriteAt(make([]byte, n), off)
			return err
		}
	}
	steps := func(all ...func(*File) error) func(*File) error {
		return func(f *File) error {
			for _, step := range all {
				if err := step(f); err != nil {
					return err
				}
			}
			return nil
		}
	}

	//The file exists with oldSize bytes, which are part of the usage
	tests := []struct {
		name     string
		total    int64
		used     int64
		oldSize  int
		flag     int
		perform  func(*File) error
		refused  bool
		wantUsed int64
		wantSize int64
	}{
		{name: "new file that fits", total: 100, flag: trunc, perform: write(50), wantUsed: 50, wantSize: 50},
		{name: "new file too big", total: 100, flag: trunc, perform: write(200), refused: true},
		{name: "exactly what is left", total: 100, flag: trunc, perform: write(100), refused: true},
		{name: "unlimited", total: -1, flag: trunc, perform: write(200), wantUsed: 200, wantSize: 200},
		{name: "grows past it", total: 100, flag: trunc, perform: steps(write(60), write(60)), refused: true, wantUsed: 60, wantSize: 60},
		{name: "empty write when full", total: 10, used: 10, flag: trunc, perform: write(0), wantUsed: 10},
		{name: "same size when over quota", total: 10, used: 50, oldSize: 40, flag: trunc, perform: write(40), wantUsed: 50, wantSize: 40},
		{name: "smaller replacement", total: 100, used: 40, oldSize: 40, flag: trunc, perform: write(10), wantUsed: 10, wantSize: 10},
		{name: "bigger replacement that fits", total: 100, used: 40, oldSize: 40, flag: trunc, perform: write(90), wantUsed: 90, wantSize: 90},
		{name: "bigger replacement too big", total: 100, used: 40, oldSize: 40, flag: trunc, perform: write(120), refused: true},
		{name: "rewriting inside the file", total: 10, used: 40, oldSize: 40, flag: keep, perform: writeAt(10, 20), wantUsed: 40, wantSize: 40},
		{name: "writing past the end", total: 100, used: 40, oldSize: 40, flag: keep, perform: writeAt(40, 30), wantUsed: 70, wantSize: 70},
		{name: "far offset", total: 100, flag: trunc, perform: writeAt(1<<40, 1), refused: true},
		{name: "offset that overflows", total: 100, flag: trunc, perform: writeAt(1<<63-1, 2), refused: true},
		{name: "append that fits", total: 100, used: 40, oldSize: 40, flag: os.O_WRONLY | os.O_APPEND, perform: write(30), wantUsed: 70, wantSize: 70},
		{name: "append too big", total: 100, used: 40, oldSize: 40, flag: os.O_WRONLY | os.O_APPEND, perform: write(80), refused: true, wantUsed: 40, wantSize: 40},
		{name: "write after read", total: 100, used: 40, oldSize: 40, flag: keep, perform: steps(
			func(f *File) error { _, err := io.ReadFull(f, make([]byte, 40)); return err },
			write(30),
		), wantUsed: 70, wantSize: 70},
		{name: "write after seek", total: 100, used: 40, oldSize: 40, flag: keep, perform: steps(
			func(f *File) error { _, err := f.Seek(0, io.SeekEnd); return err },
			write(80),
		), refused: true, wantUsed: 40, wantSize: 40},
		{name: "io.Copy", total: 100, flag: trunc, perform: func(f *File) error {
			_, err := io.Copy(f, io.LimitReader(strings.NewReader(strings.Repeat("x", 200)), 200))
			return err
		}, refused: true},
		{name: "write string", total: 100, flag: trunc, perform: func(f *File) error {
			_, err := f.WriteString(strings.Repeat("x", 200))
			return err
		}, refused: true},
		{name: "truncate to grow", total: 100, flag: trunc, perform: func(f *File) error { return f.Truncate(200) }, refused: true},
		{name: "truncate to shrink", total: 100, used: 40, oldSize: 40, flag: keep, perform: func(f *File) error { return f.Truncate(5) }, wantUsed: 5, wantSize: 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "a.bin")
			if tt.oldSize > 0 {
				newFile(t, dir, "a.bin", tt.oldSize)
			}
			q := &fakeQuota{total: tt.total, used: tt.used}
			opened, err := newDrive(dir, "user", q).OpenFile(path, tt.flag, 0644)
			if err != nil {
				t.Fatalf("OpenFile() = %v", err)
			}
			f := opened.(*File)
			err = tt.perform(f)
			if errors.Is(err, ErrQuotaExceeded) != tt.refused || (!tt.refused && err != nil) {
				t.Errorf("error = %v, want refused %v", err, tt.refused)
			}
			if f.Refused() != tt.refused {
				t.Errorf("Refused() = %v, want %v", f.Refused(), tt.refused)
			}
			if err := f.Close(); err != nil {
				t.Fatalf("Close() = %v", err)
			}
			f.Close() //A second close must not give space back twice

			info, err := os.Stat(path)
			if err != nil {
				t.Fatalf("Stat() = %v", err)
			}
			if info.Size() != tt.wantSize {
				t.Errorf("file holds %d bytes, want %d", info.Size(), tt.wantSize)
			}
			//The usage is what was used before, with this file at its new size
			if tt.wantUsed != q.used {
				t.Errorf("used = %d, want %d", q.used, tt.wantUsed)
			}
		})
	}
}

// Parts of many files uploaded at once cannot all take the same free space
func TestParallelWritesShareTheQuota(t *testing.T) {
	dir := t.TempDir()
	q := &fakeQuota{total: 101}
	d := newDrive(dir, "user", q)

	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f, err := d.OpenFile(filepath.Join(dir, string(rune('a'+i))), os.O_WRONLY|os.O_CREATE, 0644)
			if err != nil {
				t.Errorf("OpenFile() = %v", err)
				return
			}
			defer f.Close()
			f.WriteAt(make([]byte, 10), 0)
		}()
	}
	wg.Wait()

	if q.used != 100 {
		t.Fatalf("used = %d, want 100", q.used)
	}
}

func TestSizeAndRemove(t *testing.T) {
	tests := []struct {
		name     string
		target   string
		remove   func(Drive, string) error
		wantSize int64
		wantErr  bool
		wantUsed int64
	}{
		{name: "file", target: "folder/a", remove: Drive.Remove, wantSize: 10, wantUsed: 20},
		{name: "folder tree", target: "folder", remove: Drive.RemoveAll, wantSize: 30, wantUsed: 0},
		{name: "folder that is not empty", target: "folder", remove: Drive.Remove, wantSize: 30, wantErr: true, wantUsed: 30},
		{name: "missing", target: "nothing", remove: Drive.RemoveAll, wantSize: 0, wantUsed: 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			newFile(t, dir, "folder/a", 10)
			newFile(t, dir, "folder/sub/b", 20)
			q := &fakeQuota{total: 100, used: 30}
			d := newDrive(dir, "user", q)
			target := filepath.Join(dir, tt.target)
			if got := d.Size(target); got != tt.wantSize {
				t.Errorf("Size() = %d, want %d", got, tt.wantSize)
			}
			if err := tt.remove(d, target); (err != nil) != tt.wantErr {
				t.Errorf("remove = %v, want error %v", err, tt.wantErr)
			}
			if q.used != tt.wantUsed {
				t.Errorf("used = %d, want %d", q.used, tt.wantUsed)
			}
		})
	}
}
