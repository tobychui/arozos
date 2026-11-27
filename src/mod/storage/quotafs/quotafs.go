// Package quotafs keeps what a file server writes within the storage quota of
// the signed in user.
//
// A file server does not know how big an upload will be when it opens the
// file, so the space is claimed while the file grows: the write that would
// pass the quota is refused with ErrQuotaExceeded. The running total kept here
// is an estimate; the server recalculates the real usage afterwards.
package quotafs

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"sync"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// Quota is the storage quota of a user. *quota.QuotaHandler provides it.
type Quota interface {
	HaveSpace(size int64) bool
	AllocateSpace(filesize int64) error
	ReclaimSpace(filesize int64) error
	CalculateQuotaUsage()
}

// ErrQuotaExceeded is the refusal of a change that does not fit in the quota
var ErrQuotaExceeded = errors.New("User Storage Quota Exceeded")

// claimLock makes asking for space and taking it one step, as one client may
// upload many files, or many parts of a file, at the same time
var claimLock sync.Mutex

// Drive is one storage as seen by the quota of one user. Only drives with a
// folder per user count against it; on any other drive, and without a quota,
// every method works without limits.
type Drive struct {
	fsa   filesystem.FileSystemAbstraction
	quota Quota
}

// For returns the drive fsh under the given quota, which may be nil
func For(fsh *filesystem.FileSystemHandler, quota Quota) Drive {
	d := Drive{fsa: fsh.FileSystemAbstraction}
	if fsh.Hierarchy == "user" {
		d.quota = quota
	}
	return d
}

// Tracked reports whether files on this drive count against the quota
func (d Drive) Tracked() bool {
	return d.quota != nil
}

// HaveSpace reports whether the drive can grow by this many bytes. A change
// that does not grow it is always allowed, even for a user over quota.
func (d Drive) HaveSpace(growth int64) bool {
	if d.quota == nil || growth <= 0 {
		return true
	}
	claimLock.Lock()
	defer claimLock.Unlock()
	return d.quota.HaveSpace(growth)
}

// Claim takes space for the drive to grow by this many bytes, or gives space
// back if it is negative
func (d Drive) Claim(growth int64) error {
	if d.quota == nil || growth == 0 {
		return nil
	}
	claimLock.Lock()
	defer claimLock.Unlock()
	if growth < 0 {
		return d.quota.ReclaimSpace(-growth)
	}
	if !d.quota.HaveSpace(growth) {
		return ErrQuotaExceeded
	}
	return d.quota.AllocateSpace(growth)
}

// Size is the bytes held by a file, or by everything in a folder. A path that
// does not exist holds nothing.
func (d Drive) Size(rpath string) int64 {
	info, err := d.fsa.Stat(rpath)
	if err != nil {
		return 0
	}
	if !info.IsDir() {
		return info.Size()
	}
	total := int64(0)
	d.fsa.Walk(rpath, func(_ string, info fs.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

// Remove deletes a file or an empty folder and gives its space back
func (d Drive) Remove(rpath string) error {
	return d.remove(rpath, d.fsa.Remove)
}

// RemoveAll deletes a file or folder tree and gives its space back
func (d Drive) RemoveAll(rpath string) error {
	return d.remove(rpath, d.fsa.RemoveAll)
}

func (d Drive) remove(rpath string, remove func(string) error) error {
	size := int64(0)
	if d.Tracked() {
		size = d.Size(rpath)
	}
	if err := remove(rpath); err != nil {
		return err
	}
	return d.Claim(-size)
}

// OpenFile opens a file for writing. On a tracked drive the returned file is a
// *File, which refuses to grow past the quota.
func (d Drive) OpenFile(rpath string, flag int, perm os.FileMode) (arozfs.File, error) {
	if !d.Tracked() {
		return d.fsa.OpenFile(rpath, flag, perm)
	}

	//What the file already holds is counted in the usage
	oldSize := int64(0)
	if info, err := d.fsa.Stat(rpath); err == nil && !info.IsDir() {
		oldSize = info.Size()
	}
	f, err := d.fsa.OpenFile(rpath, flag, perm)
	if err != nil {
		return nil, err
	}
	length := oldSize
	if flag&os.O_TRUNC != 0 {
		length = 0
	}
	return &File{
		File:    f,
		drive:   d,
		append:  flag&os.O_APPEND != 0,
		length:  length,
		claimed: oldSize,
	}, nil
}

// File is a file being written on a tracked drive. Rewriting the bytes it held
// when it was opened costs nothing, so that a file can be replaced by one of
// the same size even by a user with no space left. Whatever is not used again
// is given back on Close.
type File struct {
	arozfs.File
	drive  Drive
	append bool

	mu      sync.Mutex
	offset  int64 //Position of the next Read or Write
	length  int64 //Size of the file
	claimed int64 //Bytes of the usage that belong to this file
	refused bool
	closed  bool
}

// Refused reports whether any change to this file was refused for the quota
func (f *File) Refused() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.refused
}

// reach claims what the file needs to extend to end. f.mu must be held.
func (f *File) reach(end int64) error {
	if end <= f.claimed {
		return nil
	}
	if err := f.drive.Claim(end - f.claimed); err != nil {
		f.refused = true
		return err
	}
	f.claimed = end
	return nil
}

// extend claims what writing n bytes at off needs. f.mu must be held.
func (f *File) extend(off int64, n int) error {
	end := off + int64(n)
	if off < 0 || n == 0 {
		return nil //Left for the file itself to reject or ignore
	}
	if end < off {
		f.refused = true
		return ErrQuotaExceeded
	}
	return f.reach(end)
}

// grew records that n bytes were written, ending at end. f.mu must be held.
func (f *File) grew(end int64, n int) {
	if n > 0 && end > f.length {
		f.length = end
	}
}

func (f *File) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, err := f.File.Read(p)
	f.offset += int64(n)
	return n, err
}

func (f *File) Seek(offset int64, whence int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	position, err := f.File.Seek(offset, whence)
	if err == nil {
		f.offset = position
	}
	return position, err
}

func (f *File) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	start := f.offset
	if f.append {
		start = f.length
	}
	if err := f.extend(start, len(p)); err != nil {
		return 0, err
	}
	n, err := f.File.Write(p)
	f.offset = start + int64(n)
	f.grew(f.offset, n)
	return n, err
}

func (f *File) WriteAt(p []byte, off int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.extend(off, len(p)); err != nil {
		return 0, err
	}
	n, err := f.File.WriteAt(p, off)
	f.grew(off+int64(n), n)
	return n, err
}

func (f *File) WriteString(s string) (int, error) {
	return f.Write([]byte(s))
}

// ReadFrom sends io.Copy through Write; the one of the embedded file would
// write past the quota
func (f *File) ReadFrom(r io.Reader) (int64, error) {
	return io.Copy(struct{ io.Writer }{f}, r)
}

func (f *File) Truncate(size int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.reach(size); err != nil {
		return err
	}
	if err := f.File.Truncate(size); err != nil {
		return err
	}
	f.length = size
	return nil
}

// Close closes the file and gives back the space it did not use
func (f *File) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.closed = true
		if f.length < f.claimed {
			f.drive.Claim(f.length - f.claimed)
		}
	}
	return f.File.Close()
}
