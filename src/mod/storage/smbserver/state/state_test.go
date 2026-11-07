package state

import (
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func TestShareModes(t *testing.T) {
	const (
		read  = wire.FileReadData
		write = wire.FileWriteData
		del   = wire.AccessDelete
		attrs = wire.FileReadAttributes
		all   = wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	)
	cases := []struct {
		name                      string
		firstAccess, firstShare   uint32
		secondAccess, secondShare uint32
		want                      uint32
	}{
		{"two readers", read, wire.ShareRead, read, wire.ShareRead, wire.StatusOK},
		{"reader then writer, no share", read, wire.ShareRead, write, all, wire.StatusSharingViolation},
		{"reader allows writer", read, all, write, all, wire.StatusOK},
		{"writer excludes reader", write, 0, read, all, wire.StatusSharingViolation},
		{"second must share the first", read, all, write, 0, wire.StatusSharingViolation},
		{"delete needs share delete", read, wire.ShareRead, del, all, wire.StatusSharingViolation},
		{"delete with share delete", read, all, del, all, wire.StatusOK},
		{"attributes never conflict", write, 0, attrs, 0, wire.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tbl := NewTable()
			if _, st := tbl.Open("f", "f", c.firstAccess, c.firstShare); st != wire.StatusOK {
				t.Fatalf("first open: %x", st)
			}
			if _, st := tbl.Open("f", "f", c.secondAccess, c.secondShare); st != c.want {
				t.Errorf("second open: %x want %x", st, c.want)
			}
		})
	}
}

func TestCloseFreesTheFile(t *testing.T) {
	tbl := NewTable()
	h, _ := tbl.Open("f", "f", wire.FileWriteData, 0)
	if _, st := tbl.Open("f", "f", wire.FileReadData, 0); st != wire.StatusSharingViolation {
		t.Fatalf("expected a violation, got %x", st)
	}
	h.Close()
	if _, st := tbl.Open("f", "f", wire.FileReadData, 0); st != wire.StatusOK {
		t.Errorf("after close: %x", st)
	}
}

func TestDeleteFlow(t *testing.T) {
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	a, _ := tbl.Open("f", "f", wire.AccessDelete, all)
	b, _ := tbl.Open("f", "f", wire.FileReadData, all)

	a.SetDisposition(true)
	if _, st := tbl.Open("f", "f", wire.FileReadData, all); st != wire.StatusDeletePending {
		t.Errorf("new open during delete: %x", st)
	}
	if a.Close() {
		t.Error("the file goes only at the last close")
	}
	if !b.Close() {
		t.Error("the last close must report the delete")
	}
	if len(tbl.entries) != 0 {
		t.Error("a closed entry must not linger")
	}
}

func TestDeleteOnCloseFlag(t *testing.T) {
	tbl := NewTable()
	h, _ := tbl.Open("f", "f", wire.AccessDelete, wire.ShareDelete)
	h.SetDeleteOnClose()
	if !h.DeletePending() {
		t.Error("the handle must report the pending delete")
	}
	if !h.Close() {
		t.Error("closing the only handle must delete")
	}
}

func TestDispositionCanBeCleared(t *testing.T) {
	tbl := NewTable()
	h, _ := tbl.Open("f", "f", wire.AccessDelete, 0)
	h.SetDisposition(true)
	h.SetDisposition(false)
	if h.Close() {
		t.Error("a cleared disposition must not delete")
	}
}

func TestDoubleCloseIsHarmless(t *testing.T) {
	tbl := NewTable()
	h, _ := tbl.Open("f", "f", wire.FileReadData, wire.ShareRead)
	h.SetDisposition(true)
	if !h.Close() {
		t.Fatal("first close should delete")
	}
	if h.Close() {
		t.Error("a second close must not delete again")
	}
}

func TestRename(t *testing.T) {
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite | wire.ShareDelete

	dir, _ := tbl.Open("s\x00dir", "s/dir", wire.AccessDelete, all)
	child, _ := tbl.Open("s\x00dir/child", "s/dir/child", wire.FileReadData, all)
	if st := dir.CanRename("s\x00other"); st != wire.StatusAccessDenied {
		t.Errorf("rename with an open child: %x", st)
	}
	child.Close()
	if st := dir.CanRename("s\x00other"); st != wire.StatusOK {
		t.Errorf("rename after the child closed: %x", st)
	}

	target, _ := tbl.Open("s\x00busy", "s/busy", wire.FileReadData, all)
	if st := dir.CanRename("s\x00busy"); st != wire.StatusAccessDenied {
		t.Errorf("replacing an open file: %x", st)
	}
	target.Close()

	dir.Rename("s\x00other", "other")
	if got := dir.Key(); got != "s\x00other" {
		t.Errorf("key = %q", got)
	}
	if _, st := tbl.Open("s\x00other", "s/other", wire.FileReadData, 0); st != wire.StatusSharingViolation {
		t.Errorf("the handle must follow the rename: %x", st)
	}
}

func TestRenameUpdatesEveryHandleOfTheFile(t *testing.T) {
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	writer, _ := tbl.Open("s\x00a.tmp", "a.tmp", wire.FileWriteData, all)
	mover, _ := tbl.Open("s\x00a.tmp", "a.tmp", wire.AccessDelete, all)

	mover.Rename("s\x00doc.docx", "doc.docx")
	if got := writer.Path(); got != "doc.docx" {
		t.Errorf("the other handle still points at %q", got)
	}
	if got := mover.Path(); got != "doc.docx" {
		t.Errorf("the renaming handle points at %q", got)
	}
}

func TestRenameLeavesAFileOfAnotherCaseAlone(t *testing.T) {
	//On a case sensitive drive a and A are two files in one entry
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	lower, _ := tbl.Open("s\x00a", "a", wire.AccessDelete, all)
	upper, _ := tbl.Open("s\x00a", "A", wire.FileReadData, all)
	lower.SetFileID(1)
	upper.SetFileID(2)

	lower.Rename("s\x00b", "b")
	if got := upper.Path(); got != "A" {
		t.Errorf("a different file moved with it: %q", got)
	}
}

func lock(offset, length uint64, flags uint32) wire.LockElement {
	return wire.LockElement{Offset: offset, Length: length, Flags: flags}
}

func TestLocks(t *testing.T) {
	all := wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	cases := []struct {
		name  string
		first []wire.LockElement
		next  []wire.LockElement
		want  uint32
	}{
		{"shared with shared", []wire.LockElement{lock(0, 10, wire.LockShared)}, []wire.LockElement{lock(5, 10, wire.LockShared)}, wire.StatusOK},
		{"exclusive with shared", []wire.LockElement{lock(0, 10, wire.LockExclusive)}, []wire.LockElement{lock(5, 10, wire.LockShared)}, wire.StatusLockNotGranted},
		{"shared with exclusive", []wire.LockElement{lock(0, 10, wire.LockShared)}, []wire.LockElement{lock(5, 10, wire.LockExclusive)}, wire.StatusLockNotGranted},
		{"disjoint", []wire.LockElement{lock(0, 10, wire.LockExclusive)}, []wire.LockElement{lock(10, 10, wire.LockExclusive)}, wire.StatusOK},
		{"zero length never conflicts", []wire.LockElement{lock(0, 10, wire.LockExclusive)}, []wire.LockElement{lock(5, 0, wire.LockExclusive)}, wire.StatusOK},
		{"end of the range", []wire.LockElement{lock(^uint64(0)-5, 6, wire.LockExclusive)}, []wire.LockElement{lock(^uint64(0), 1, wire.LockExclusive)}, wire.StatusLockNotGranted},
		{"wrapping range", nil, []wire.LockElement{lock(^uint64(0), 2, wire.LockExclusive)}, wire.StatusInvalidParameter},
		{"a set conflicting with itself", nil, []wire.LockElement{lock(0, 10, wire.LockExclusive), lock(5, 10, wire.LockExclusive)}, wire.StatusLockNotGranted},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tbl := NewTable()
			a, _ := tbl.Open("f", "f", wire.FileReadData, all)
			b, _ := tbl.Open("f", "f", wire.FileReadData, all)
			if c.first != nil {
				if st := a.LockSet(c.first); st != wire.StatusOK {
					t.Fatalf("first lock: %x", st)
				}
			}
			if st := b.LockSet(c.next); st != c.want {
				t.Errorf("second lock: %x want %x", st, c.want)
			}
		})
	}
}

func TestLockSetIsAllOrNothing(t *testing.T) {
	all := wire.ShareRead | wire.ShareWrite
	tbl := NewTable()
	a, _ := tbl.Open("f", "f", wire.FileReadData, all)
	b, _ := tbl.Open("f", "f", wire.FileReadData, all)
	a.LockSet([]wire.LockElement{lock(100, 10, wire.LockExclusive)})

	st := b.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive), lock(100, 10, wire.LockExclusive)})
	if st != wire.StatusLockNotGranted {
		t.Fatalf("status %x", st)
	}
	if st := a.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive)}); st != wire.StatusOK {
		t.Errorf("the failed set must have taken nothing: %x", st)
	}
}

func TestUnlock(t *testing.T) {
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite
	a, _ := tbl.Open("f", "f", wire.FileReadData, all)
	b, _ := tbl.Open("f", "f", wire.FileReadData, all)
	a.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive)})

	if st := b.Unlock([]wire.LockElement{lock(0, 10, 0)}); st != wire.StatusRangeNotLocked {
		t.Errorf("unlocking another handle's lock: %x", st)
	}
	if st := a.Unlock([]wire.LockElement{lock(0, 5, 0)}); st != wire.StatusRangeNotLocked {
		t.Errorf("unlocking part of a range: %x", st)
	}

	changed := a.Changed()
	if st := a.Unlock([]wire.LockElement{lock(0, 10, 0)}); st != wire.StatusOK {
		t.Fatalf("unlock: %x", st)
	}
	select {
	case <-changed:
	default:
		t.Error("waiters must be woken by an unlock")
	}
	if st := b.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive)}); st != wire.StatusOK {
		t.Errorf("after unlock: %x", st)
	}
}

func TestCloseReleasesLocks(t *testing.T) {
	tbl := NewTable()
	all := wire.ShareRead | wire.ShareWrite
	a, _ := tbl.Open("f", "f", wire.FileReadData, all)
	b, _ := tbl.Open("f", "f", wire.FileReadData, all)
	a.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive)})
	a.Close()
	if st := b.LockSet([]wire.LockElement{lock(0, 10, wire.LockExclusive)}); st != wire.StatusOK {
		t.Errorf("a closed handle must not hold locks: %x", st)
	}
}

func TestCheckIO(t *testing.T) {
	all := wire.ShareRead | wire.ShareWrite
	cases := []struct {
		name    string
		flags   uint32
		byOwner bool
		write   bool
		want    uint32
	}{
		{"read under another's exclusive", wire.LockExclusive, false, false, wire.StatusFileLockConflict},
		{"write under another's exclusive", wire.LockExclusive, false, true, wire.StatusFileLockConflict},
		{"read under another's shared", wire.LockShared, false, false, wire.StatusOK},
		{"write under another's shared", wire.LockShared, false, true, wire.StatusFileLockConflict},
		{"owner writes under exclusive", wire.LockExclusive, true, true, wire.StatusOK},
		{"owner writes under shared", wire.LockShared, true, true, wire.StatusFileLockConflict},
		{"owner reads under shared", wire.LockShared, true, false, wire.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tbl := NewTable()
			a, _ := tbl.Open("f", "f", wire.FileReadData, all)
			b, _ := tbl.Open("f", "f", wire.FileReadData, all)
			a.LockSet([]wire.LockElement{lock(0, 10, c.flags)})
			h := b
			if c.byOwner {
				h = a
			}
			if st := h.CheckIO(5, 2, c.write); st != c.want {
				t.Errorf("status %x want %x", st, c.want)
			}
			if st := h.CheckIO(20, 2, c.write); st != wire.StatusOK {
				t.Errorf("outside the range: %x", st)
			}
		})
	}
}
