// Package state holds what every connection must agree on about an open file:
// share modes, pending deletes and byte range locks. The file system below
// has none of this, so the server keeps it here, in memory, for all clients.
package state

import (
	"strings"
	"sync"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

const (
	readBits   = wire.FileReadData | wire.FileExecute
	writeBits  = wire.FileWriteData | wire.FileAppendData
	deleteBits = wire.AccessDelete
)

// Table tracks every open file of the server.
type Table struct {
	mu      sync.Mutex
	entries map[string]*entry
}

// NewTable returns an empty table.
func NewTable() *Table {
	return &Table{entries: map[string]*entry{}}
}

type lockRange struct {
	owner     *Handle
	offset    uint64
	length    uint64
	exclusive bool
}

func (l *lockRange) overlaps(offset, length uint64) bool {
	//A zero length range never conflicts with anything
	if l.length == 0 || length == 0 {
		return false
	}
	return offset <= l.offset+(l.length-1) && l.offset <= offset+(length-1)
}

type entry struct {
	key           string
	handles       map[*Handle]struct{}
	deletePending bool
	locks         []lockRange
	changed       chan struct{}
}

// Handle is one open of one file.
type Handle struct {
	table         *Table
	entry         *entry
	access        uint32
	share         uint32
	deleteOnClose bool
	closed        bool
	path          string
	fileID        uint64
	owner         any //What the server keeps for this handle
}

// SetOwner records what the server keeps for a handle, so a handle found
// through another one leads back to it.
func (h *Handle) SetOwner(owner any) {
	h.table.mu.Lock()
	h.owner = owner
	h.table.mu.Unlock()
}

// Owner returns what SetOwner recorded.
func (h *Handle) Owner() any {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	return h.owner
}

// sameFile tells real aliases apart from two files whose names only differ by
// case on a case sensitive drive, which share an entry.
func (h *Handle) sameFile(other *Handle) bool {
	if h.fileID != 0 && other.fileID != 0 {
		return h.fileID == other.fileID
	}
	return strings.EqualFold(h.path, other.path)
}

func usesData(access uint32) bool {
	return access&(readBits|writeBits|deleteBits) != 0
}

func conflicts(access, share, otherAccess, otherShare uint32) bool {
	if !usesData(access) || !usesData(otherAccess) {
		return false
	}
	switch {
	case access&readBits != 0 && otherShare&wire.ShareRead == 0:
		return true
	case access&writeBits != 0 && otherShare&wire.ShareWrite == 0:
		return true
	case access&deleteBits != 0 && otherShare&wire.ShareDelete == 0:
		return true
	case otherAccess&readBits != 0 && share&wire.ShareRead == 0:
		return true
	case otherAccess&writeBits != 0 && share&wire.ShareWrite == 0:
		return true
	case otherAccess&deleteBits != 0 && share&wire.ShareDelete == 0:
		return true
	}
	return false
}

// Open registers an open of key at path. The returned status is non zero when
// another open forbids it or the file is waiting to be deleted.
func (t *Table) Open(key, path string, access, share uint32) (*Handle, uint32) {
	t.mu.Lock()
	defer t.mu.Unlock()

	e := t.entries[key]
	if e == nil {
		e = &entry{key: key, handles: map[*Handle]struct{}{}, changed: make(chan struct{})}
		t.entries[key] = e
	}
	if e.deletePending {
		return nil, wire.StatusDeletePending
	}
	for other := range e.handles {
		if conflicts(access, share, other.access, other.share) {
			if len(e.handles) == 0 {
				delete(t.entries, key)
			}
			return nil, wire.StatusSharingViolation
		}
	}
	h := &Handle{table: t, entry: e, access: access, share: share, path: path}
	e.handles[h] = struct{}{}
	return h, wire.StatusOK
}

// Close drops the handle and its locks. It reports true when this was the
// last handle of a file marked for deletion, and the caller must now delete it.
func (h *Handle) Close() bool {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()
	if h.closed {
		return false
	}
	h.closed = true

	e := h.entry
	if h.deleteOnClose {
		e.deletePending = true
	}
	delete(e.handles, h)

	kept := e.locks[:0]
	for _, l := range e.locks {
		if l.owner != h {
			kept = append(kept, l)
		}
	}
	e.locks = kept
	e.notify()

	if len(e.handles) != 0 {
		return false
	}
	delete(t.entries, e.key)
	return e.deletePending
}

func (e *entry) notify() {
	close(e.changed)
	e.changed = make(chan struct{})
}

// SetDeleteOnClose records the CreateOptions flag: the file goes when this
// handle closes.
func (h *Handle) SetDeleteOnClose() {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	h.deleteOnClose = true
}

// SetDisposition is FileDispositionInformation: it marks or clears the
// pending delete right away, so new opens start failing.
func (h *Handle) SetDisposition(pending bool) {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	h.entry.deletePending = pending
	if !pending {
		h.deleteOnClose = false
	}
}

// DeletePending reports whether the file is waiting to be deleted.
func (h *Handle) DeletePending() bool {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	return h.entry.deletePending || h.deleteOnClose
}

// CanRename reports the status of renaming this handle's file to newKey.
// Windows refuses to rename a folder with something open below it, and
// refuses to replace a file someone has open.
func (h *Handle) CanRename(newKey string) uint32 {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()

	prefix := h.entry.key + "/"
	for key := range t.entries {
		if strings.HasPrefix(key, prefix) {
			return wire.StatusAccessDenied
		}
	}
	if target := t.entries[newKey]; target != nil && target != h.entry && len(target.handles) > 0 {
		return wire.StatusAccessDenied
	}
	return wire.StatusOK
}

// Rename moves the file to newKey and newPath, keeping every handle and lock on
// it. Every other handle of the file follows: applications write through one
// handle and rename through another, and the first must keep working.
func (h *Handle) Rename(newKey, newPath string) {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()
	e := h.entry
	for other := range e.handles {
		if other != h && h.sameFile(other) {
			other.path = newPath
		}
	}
	h.path = newPath
	if e.key == newKey {
		return
	}
	delete(t.entries, e.key)
	e.key = newKey
	t.entries[newKey] = e
}

// Path returns where this handle's file is now.
func (h *Handle) Path() string {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	return h.path
}

// SetFileID records the file's number once it is known.
func (h *Handle) SetFileID(id uint64) {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	h.fileID = id
}

// Key returns the file key this handle is on now.
func (h *Handle) Key() string {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	return h.entry.key
}

// Locked returns the file's lock waiters channel, closed on the next change.
func (h *Handle) Changed() <-chan struct{} {
	h.table.mu.Lock()
	defer h.table.mu.Unlock()
	return h.entry.changed
}

// LockSet takes a whole set of ranges, or none of them.
func (h *Handle) LockSet(ranges []wire.LockElement) uint32 {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()
	e := h.entry

	for i, want := range ranges {
		exclusive := want.Flags&wire.LockExclusive != 0
		if want.Length != 0 && want.Offset+(want.Length-1) < want.Offset {
			return wire.StatusInvalidParameter
		}
		for j := range e.locks {
			held := &e.locks[j]
			if held.overlaps(want.Offset, want.Length) && (exclusive || held.exclusive) {
				return wire.StatusLockNotGranted
			}
		}
		//The set must also agree with itself
		for _, earlier := range ranges[:i] {
			probe := lockRange{offset: earlier.Offset, length: earlier.Length}
			if probe.overlaps(want.Offset, want.Length) && (exclusive || earlier.Flags&wire.LockExclusive != 0) {
				return wire.StatusLockNotGranted
			}
		}
	}
	for _, want := range ranges {
		e.locks = append(e.locks, lockRange{owner: h, offset: want.Offset, length: want.Length, exclusive: want.Flags&wire.LockExclusive != 0})
	}
	return wire.StatusOK
}

// Unlock releases ranges this handle holds. Every range must match exactly,
// and a set with an unknown range changes nothing.
func (h *Handle) Unlock(ranges []wire.LockElement) uint32 {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()
	e := h.entry

	remaining := append([]lockRange{}, e.locks...)
	for _, want := range ranges {
		found := -1
		for i := range remaining {
			l := &remaining[i]
			if l.owner == h && l.offset == want.Offset && l.length == want.Length {
				found = i
				break
			}
		}
		if found < 0 {
			return wire.StatusRangeNotLocked
		}
		remaining = append(remaining[:found], remaining[found+1:]...)
	}
	e.locks = remaining
	e.notify()
	return wire.StatusOK
}

// CheckIO reports whether a read or write of the range is blocked by a lock.
// A shared lock stops writes from everyone, its owner included.
func (h *Handle) CheckIO(offset, length uint64, write bool) uint32 {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()

	for i := range h.entry.locks {
		l := &h.entry.locks[i]
		if !l.overlaps(offset, length) {
			continue
		}
		if l.exclusive && l.owner == h {
			continue
		}
		if write || l.exclusive {
			return wire.StatusFileLockConflict
		}
	}
	return wire.StatusOK
}

// Peers returns the other handles open on the same file.
func (h *Handle) Peers() []*Handle {
	t := h.table
	t.mu.Lock()
	defer t.mu.Unlock()
	out := []*Handle{}
	for other := range h.entry.handles {
		if other != h {
			out = append(out, other)
		}
	}
	return out
}

// WouldConflict reports whether a new open with this access and share mode
// would be refused because of h.
func (h *Handle) WouldConflict(access, share uint32) bool {
	return conflicts(access, share, h.access, h.share)
}

// Count returns how many handles the file at key has.
func (t *Table) Count(key string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	if e := t.entries[key]; e != nil {
		return len(e.handles)
	}
	return 0
}
