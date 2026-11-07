package smbserver

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

var (
	shareAll = wire.ShareRead | wire.ShareWrite | wire.ShareDelete
	openRW   = createOpts{access: wire.FileReadData | wire.FileWriteData, share: shareAll, disposition: wire.DispositionOpenIf}
)

func mustCreate(t *testing.T, c *rawClient, name string, o createOpts) wire.FileID {
	t.Helper()
	id, st := c.create(name, o)
	if st != 0 {
		t.Fatalf("create %s: %x", name, st)
	}
	return id
}

func TestDispositions(t *testing.T) {
	cases := []struct {
		name        string
		exists      bool
		disposition uint32
		wantStatus  uint32
		wantAction  uint32
		wantSize    int
	}{
		{"open existing", true, wire.DispositionOpen, 0, wire.ActionOpened, 5},
		{"open missing", false, wire.DispositionOpen, wire.StatusObjectNameNotFound, 0, 0},
		{"create new", false, wire.DispositionCreate, 0, wire.ActionCreated, 0},
		{"create existing", true, wire.DispositionCreate, wire.StatusObjectNameCollision, 0, 0},
		{"open if existing", true, wire.DispositionOpenIf, 0, wire.ActionOpened, 5},
		{"open if missing", false, wire.DispositionOpenIf, 0, wire.ActionCreated, 0},
		{"overwrite existing", true, wire.DispositionOverwrite, 0, wire.ActionOverwritten, 0},
		{"overwrite missing", false, wire.DispositionOverwrite, wire.StatusObjectNameNotFound, 0, 0},
		{"overwrite if existing", true, wire.DispositionOverwriteIf, 0, wire.ActionOverwritten, 0},
		{"overwrite if missing", false, wire.DispositionOverwriteIf, 0, wire.ActionCreated, 0},
		{"supersede existing", true, wire.DispositionSupersede, 0, wire.ActionSuperseded, 0},
		{"supersede missing", false, wire.DispositionSupersede, 0, wire.ActionCreated, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			c := newRawClient(t, h)
			target := filepath.Join(h.share.root, "f.txt")
			if tc.exists {
				os.WriteFile(target, []byte("hello"), 0644)
			}
			r := c.call(wire.CmdCreate, createBody("f.txt", createOpts{access: wire.FileReadData | wire.FileWriteData, share: shareAll, disposition: tc.disposition}))
			if r.hdr.Status != tc.wantStatus {
				t.Fatalf("status %x want %x", r.hdr.Status, tc.wantStatus)
			}
			if tc.wantStatus != 0 {
				return
			}
			if got := binary.LittleEndian.Uint32(r.body[4:]); got != tc.wantAction {
				t.Errorf("action %d want %d", got, tc.wantAction)
			}
			info, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			if int(info.Size()) != tc.wantSize {
				t.Errorf("size %d want %d", info.Size(), tc.wantSize)
			}
		})
	}
}

func TestDirectoryVersusFileOptions(t *testing.T) {
	h := newHarness(t)
	os.Mkdir(filepath.Join(h.share.root, "d"), 0755)
	os.WriteFile(filepath.Join(h.share.root, "f"), nil, 0644)
	c := newRawClient(t, h)

	if _, st := c.create("d", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionNonDirectory}); st != wire.StatusFileIsADirectory {
		t.Errorf("folder opened as a file: %x", st)
	}
	if _, st := c.create("f", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory}); st != wire.StatusNotADirectory {
		t.Errorf("file opened as a folder: %x", st)
	}
	if _, st := c.create(`missing\x`, createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionCreate}); st != wire.StatusObjectPathNotFound {
		t.Errorf("create under a missing folder: %x", st)
	}
	if _, st := c.create(`f\x`, createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusObjectPathNotFound {
		t.Errorf("path through a file: %x", st)
	}
}

func TestShareModeConflict(t *testing.T) {
	h := newHarness(t)
	a := newRawClient(t, h)
	b := newRawClient(t, h)

	id := mustCreate(t, a, "f.txt", createOpts{access: wire.FileWriteData, share: 0, disposition: wire.DispositionOpenIf})
	if _, st := b.create("f.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusSharingViolation {
		t.Errorf("second open: %x", st)
	}
	if _, st := b.create("F.TXT", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusSharingViolation {
		t.Errorf("another spelling of the same file: %x", st)
	}
	a.close(id)
	if _, st := b.create("f.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != 0 {
		t.Errorf("after close: %x", st)
	}
}

func TestDeleteOnClose(t *testing.T) {
	h := newHarness(t)
	target := filepath.Join(h.share.root, "f.txt")
	os.WriteFile(target, []byte("x"), 0644)
	c := newRawClient(t, h)

	id := mustCreate(t, c, "f.txt", createOpts{access: wire.AccessDelete | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDeleteOnCLS})
	if _, err := os.Stat(target); err != nil {
		t.Fatal("the file must stay until the close")
	}
	c.close(id)
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Errorf("after close: %v", err)
	}
}

func TestDispositionInfoAndPendingDelete(t *testing.T) {
	h := newHarness(t)
	target := filepath.Join(h.share.root, "f.txt")
	os.WriteFile(target, []byte("x"), 0644)
	a := newRawClient(t, h)
	b := newRawClient(t, h)

	id := mustCreate(t, a, "f.txt", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})
	if r := a.call(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1})); r.hdr.Status != 0 {
		t.Fatalf("set info: %x", r.hdr.Status)
	}
	if _, st := b.create("f.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusDeletePending {
		t.Errorf("open during delete: %x", st)
	}
	a.close(id)
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Errorf("after close: %v", err)
	}
}

func TestDeleteRefusedForNonEmptyFolder(t *testing.T) {
	h := newHarness(t)
	os.MkdirAll(filepath.Join(h.share.root, "d", "sub"), 0755)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "d", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1})); r.hdr.Status != wire.StatusDirectoryNotEmpty {
		t.Errorf("status %x", r.hdr.Status)
	}
}

func renameData(name string, replace bool) []byte {
	encoded := wire.EncodeUTF16(name)
	w := wire.NewWriter(20 + len(encoded))
	if replace {
		w.U8(1)
	} else {
		w.U8(0)
	}
	w.Zero(7)
	w.U64(0)
	w.U32(uint32(len(encoded)))
	w.Bytes(encoded)
	return w.B
}

func TestRenameKeepsTheHandle(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "old.txt", createOpts{access: wire.FileWriteData | wire.AccessDelete, share: shareAll, disposition: wire.DispositionCreate})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("new.txt", false))); r.hdr.Status != 0 {
		t.Fatalf("rename: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("after"))); r.hdr.Status != 0 {
		t.Fatalf("write: %x", r.hdr.Status)
	}
	c.close(id)
	got, err := os.ReadFile(filepath.Join(h.share.root, "new.txt"))
	if err != nil || string(got) != "after" {
		t.Errorf("new.txt = %q, %v", got, err)
	}
}

func TestRenameChangingOnlyCase(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "name.txt"), []byte("x"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "name.txt", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("NAME.TXT", false))); r.hdr.Status != 0 {
		t.Fatalf("rename: %x", r.hdr.Status)
	}
	c.close(id)
	entries, _ := os.ReadDir(h.share.root)
	if len(entries) != 1 || entries[0].Name() != "NAME.TXT" {
		t.Errorf("entries = %v", entries)
	}
}

func TestRenameReplaceAndCollision(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "a"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(h.share.root, "b"), []byte("b"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "a", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})

	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("b", false))); r.hdr.Status != wire.StatusObjectNameCollision {
		t.Errorf("without replace: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("b", true))); r.hdr.Status != 0 {
		t.Errorf("with replace: %x", r.hdr.Status)
	}
	c.close(id)
	if got, _ := os.ReadFile(filepath.Join(h.share.root, "b")); string(got) != "a" {
		t.Errorf("b = %q", got)
	}
}

func TestRenameNeedsDeleteAccess(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "a"), []byte("a"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "a", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("b", false))); r.hdr.Status != wire.StatusAccessDenied {
		t.Errorf("status %x", r.hdr.Status)
	}
}

func TestLocksBetweenClients(t *testing.T) {
	h := newHarness(t)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	ida := mustCreate(t, a, "f", openRW)
	idb := mustCreate(t, b, "f", openRW)
	a.call(wire.CmdWrite, writeBodyOf(ida, 0, make([]byte, 100)))

	if r := a.call(wire.CmdLock, lockBody(ida, 0, 10, wire.LockExclusive|wire.LockFailImmediately)); r.hdr.Status != 0 {
		t.Fatalf("lock: %x", r.hdr.Status)
	}
	if r := b.call(wire.CmdLock, lockBody(idb, 5, 2, wire.LockExclusive|wire.LockFailImmediately)); r.hdr.Status != wire.StatusLockNotGranted {
		t.Errorf("conflicting lock: %x", r.hdr.Status)
	}
	if r := b.call(wire.CmdRead, readBodyOf(idb, 0, 4)); r.hdr.Status != wire.StatusFileLockConflict {
		t.Errorf("read under a lock: %x", r.hdr.Status)
	}
	if r := b.call(wire.CmdWrite, writeBodyOf(idb, 0, []byte{1})); r.hdr.Status != wire.StatusFileLockConflict {
		t.Errorf("write under a lock: %x", r.hdr.Status)
	}
	if r := a.call(wire.CmdRead, readBodyOf(ida, 0, 4)); r.hdr.Status != 0 {
		t.Errorf("the owner must still read: %x", r.hdr.Status)
	}
	if r := b.call(wire.CmdRead, readBodyOf(idb, 50, 4)); r.hdr.Status != 0 {
		t.Errorf("outside the range: %x", r.hdr.Status)
	}
	if r := a.call(wire.CmdLock, lockBody(ida, 0, 10, wire.LockUnlock)); r.hdr.Status != 0 {
		t.Fatalf("unlock: %x", r.hdr.Status)
	}
	if r := b.call(wire.CmdRead, readBodyOf(idb, 0, 4)); r.hdr.Status != 0 {
		t.Errorf("after unlock: %x", r.hdr.Status)
	}
}

func TestBlockingLockWaitsForTheHolder(t *testing.T) {
	h := newHarness(t)
	a := newRawClient(t, h)
	b := newRawClient(t, h)
	ida := mustCreate(t, a, "f", openRW)
	idb := mustCreate(t, b, "f", openRW)
	a.call(wire.CmdLock, lockBody(ida, 0, 10, wire.LockExclusive|wire.LockFailImmediately))

	msg := b.message(wire.CmdLock, lockBody(idb, 0, 10, wire.LockExclusive), 0)
	b.signer.Sign(msg)
	b.writeFrame(msg)
	interim := parseReplies(t, b.readFrame())[0]
	if interim.hdr.Status != wire.StatusPending || interim.hdr.Flags&wire.FlagAsync == 0 {
		t.Fatalf("interim: %+v", interim.hdr)
	}

	a.call(wire.CmdLock, lockBody(ida, 0, 10, wire.LockUnlock))
	final := parseReplies(t, b.readFrame())[0]
	if final.hdr.Status != 0 {
		t.Errorf("final: %x", final.hdr.Status)
	}
	if final.hdr.AsyncID != interim.hdr.AsyncID {
		t.Error("the final reply must carry the async id")
	}
	b.verify(final)
}

func TestChangeNotifyPendsAndCancels(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	msg := c.message(wire.CmdChangeNotify, notifyBody(id), 0)
	mid := binary.LittleEndian.Uint64(msg[24:])
	c.signer.Sign(msg)
	c.writeFrame(msg)
	interim := parseReplies(t, c.readFrame())[0]
	if interim.hdr.Status != wire.StatusPending {
		t.Fatalf("interim: %x", interim.hdr.Status)
	}
	if interim.hdr.Flags&wire.FlagSigned != 0 {
		t.Error("an interim response is not signed, as Samba and Windows do")
	}

	//CANCEL reuses the message id and takes no credit
	h2 := wire.Header{Command: wire.CmdCancel, MessageID: mid, SessionID: c.session, Flags: wire.FlagAsync, AsyncID: interim.hdr.AsyncID}
	cancel := make([]byte, wire.HeaderSize+4)
	h2.Put(cancel)
	cancel[wire.HeaderSize] = 4
	c.signer.Sign(cancel)
	c.writeFrame(cancel)

	final := parseReplies(t, c.readFrame())[0]
	if final.hdr.Status != wire.StatusCancelled {
		t.Errorf("final: %x", final.hdr.Status)
	}
	c.verify(final)
}

func TestClosingAFolderEndsItsNotify(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	msg := c.message(wire.CmdChangeNotify, notifyBody(id), 0)
	c.signer.Sign(msg)
	c.writeFrame(msg)
	parseReplies(t, c.readFrame())

	closeMsg := c.message(wire.CmdClose, closeBody(id), 0)
	c.signer.Sign(closeMsg)
	c.writeFrame(closeMsg)

	seen := map[uint32]bool{}
	for i := 0; i < 2; i++ {
		r := parseReplies(t, c.readFrame())[0]
		seen[r.hdr.Status] = true
		c.verify(r)
	}
	if !seen[wire.StatusNotifyCleanup] || !seen[0] {
		t.Errorf("statuses = %v", seen)
	}
}

// compound links messages the way Windows does.
func (c *rawClient) compound(related bool, parts ...struct {
	cmd  uint16
	body []byte
}) []rawReply {
	c.t.Helper()
	msgs := [][]byte{}
	for i, p := range parts {
		flags := uint32(0)
		if related && i > 0 {
			flags = wire.FlagRelated
		}
		m := c.message(p.cmd, p.body, flags)
		if related && i > 0 {
			binary.LittleEndian.PutUint64(m[40:], ^uint64(0))
			binary.LittleEndian.PutUint32(m[36:], ^uint32(0))
		}
		if i < len(parts)-1 {
			for len(m)%8 != 0 {
				m = append(m, 0)
			}
			binary.LittleEndian.PutUint32(m[20:], uint32(len(m)))
		}
		msgs = append(msgs, m)
	}
	frame := []byte{}
	for _, m := range msgs {
		c.signer.Sign(m)
		frame = append(frame, m...)
	}
	c.writeFrame(frame)
	return parseReplies(c.t, c.readFrame())
}

func previous() wire.FileID {
	var id wire.FileID
	for i := range id {
		id[i] = 0xFF
	}
	return id
}

type compoundPart = struct {
	cmd  uint16
	body []byte
}

func TestCompoundCreateQueryClose(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), []byte("hello"), 0644)
	c := newRawClient(t, h)

	replies := c.compound(true,
		compoundPart{wire.CmdCreate, createBody("f.txt", createOpts{access: wire.FileReadAttributes | wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})},
		compoundPart{wire.CmdQueryInfo, queryInfoBody(previous(), wire.InfoFile, wire.FileStandardInformation, 0)},
		compoundPart{wire.CmdClose, closeBody(previous())},
	)
	if len(replies) != 3 {
		t.Fatalf("%d replies", len(replies))
	}
	for i, r := range replies {
		if r.hdr.Status != 0 {
			t.Errorf("part %d: %x", i, r.hdr.Status)
		}
		c.verify(r)
		if i > 0 && r.hdr.Flags&wire.FlagRelated == 0 {
			t.Errorf("part %d: the related flag must come back", i)
		}
	}
	if got := binary.LittleEndian.Uint64(replies[1].body[8+8:]); got != 5 {
		t.Errorf("size = %d", got)
	}
}

func TestCompoundFailedCreatePassesItsErrorOn(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	replies := c.compound(true,
		compoundPart{wire.CmdCreate, createBody("missing.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})},
		compoundPart{wire.CmdQueryInfo, queryInfoBody(previous(), wire.InfoFile, wire.FileStandardInformation, 0)},
		compoundPart{wire.CmdClose, closeBody(previous())},
	)
	for i, r := range replies {
		if r.hdr.Status != wire.StatusObjectNameNotFound {
			t.Errorf("part %d: %x", i, r.hdr.Status)
		}
	}
}

// Windows 11 asks for directory class 81 twice in one compound, and falls back
// to class 37 when both are refused. Seen in a real session.
func TestWindows11DirectoryFallback(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), nil, 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	const class81 = 81
	replies := c.compound(false,
		compoundPart{wire.CmdQueryDirectory, queryDirBody(id, class81, 0, "*")},
		compoundPart{wire.CmdQueryDirectory, queryDirBody(id, class81, 0, "*")},
	)
	for i, r := range replies {
		if r.hdr.Status != wire.StatusInvalidInfoClass {
			t.Errorf("class 81 part %d: %x", i, r.hdr.Status)
		}
	}
	replies = c.compound(false,
		compoundPart{wire.CmdQueryDirectory, queryDirBody(id, wire.FileIdBothDirectoryInformation, 0, "*")},
		compoundPart{wire.CmdQueryDirectory, queryDirBody(id, wire.FileIdBothDirectoryInformation, 0, "*")},
	)
	if replies[0].hdr.Status != 0 || replies[1].hdr.Status != wire.StatusNoMoreFiles {
		t.Errorf("class 37: %x %x", replies[0].hdr.Status, replies[1].hdr.Status)
	}
	if !bytes.Contains(replies[0].body, wire.EncodeUTF16("f.txt")) {
		t.Error("the listing must hold the file")
	}
}

func TestDirectoryStatuses(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "a.txt"), nil, 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	cls := wire.FileBothDirectoryInformation
	if r := c.call(wire.CmdQueryDirectory, queryDirBody(id, cls, wire.RestartScans, "nothing-matches")); r.hdr.Status != wire.StatusNoSuchFile {
		t.Errorf("no match: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdQueryDirectory, queryDirBody(id, cls, wire.RestartScans, "A.TXT")); r.hdr.Status != 0 {
		t.Errorf("exact name in another case: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdQueryDirectory, queryDirBody(id, cls, 0, "")); r.hdr.Status != wire.StatusNoMoreFiles {
		t.Errorf("end of listing: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdQueryDirectory, queryDirBody(id, cls, wire.RestartScans, "*.txt")); r.hdr.Status != 0 {
		t.Errorf("after restart: %x", r.hdr.Status)
	}
}

func TestEveryDirectoryClassLists(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "abc.txt"), nil, 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	for _, class := range []uint8{
		wire.FileDirectoryInformation, wire.FileFullDirectoryInformation, wire.FileBothDirectoryInformation,
		wire.FileNamesInformation, wire.FileIdBothDirectoryInformation, wire.FileIdFullDirectoryInformation,
	} {
		r := c.call(wire.CmdQueryDirectory, queryDirBody(id, class, wire.RestartScans, "abc.txt"))
		if r.hdr.Status != 0 {
			t.Errorf("class %d: %x", class, r.hdr.Status)
			continue
		}
		data := r.body[8:]
		fixed := entrySize(class)
		want := wire.EncodeUTF16("abc.txt")
		if len(data) != fixed+len(want) || !bytes.Equal(data[fixed:], want) {
			t.Errorf("class %d: the name is not where the layout says, %d bytes", class, len(data))
		}
	}
}

func TestStreamOpensAreRefusedCleanly(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "sample.bin"), []byte("x"), 0644)
	c := newRawClient(t, h)

	o := createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}
	if _, st := c.create("sample.bin:Zone.Identifier", o); st != wire.StatusObjectNameInvalid {
		t.Errorf("named stream: %x", st)
	}
	id, st := c.create("sample.bin::$DATA", o)
	if st != 0 {
		t.Fatalf("default stream: %x", st)
	}
	c.close(id)
}

func TestInfoClassLayouts(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), []byte("12345"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.FileReadData | wire.FileReadAttributes | wire.ReadControl, share: shareAll, disposition: wire.DispositionOpen})

	cases := []struct {
		name  string
		class uint8
		size  int
	}{
		{"basic", wire.FileBasicInformation, 40},
		{"standard", wire.FileStandardInformation, 24},
		{"internal", wire.FileInternalInformation, 8},
		{"ea", wire.FileEaInformation, 4},
		{"access", wire.FileAccessInformation, 4},
		{"network open", wire.FileNetworkOpenInformation, 56},
		{"attribute tag", wire.FileAttributeTagInformation, 8},
		{"position", wire.FilePositionInformation, 8},
		{"mode", wire.FileModeInformation, 4},
		{"alignment", wire.FileAlignmentInformation, 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, tc.class, 0))
			if r.hdr.Status != 0 {
				t.Fatalf("status %x", r.hdr.Status)
			}
			if got := int(binary.LittleEndian.Uint32(r.body[4:])); got != tc.size {
				t.Errorf("size %d want %d", got, tc.size)
			}
		})
	}

	r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileAllInformation, 0))
	data := r.body[8:]
	nameLen := binary.LittleEndian.Uint32(data[96:])
	if got, _ := wire.DecodeUTF16(data[100 : 100+nameLen]); got != `\f.txt` {
		t.Errorf("all information name = %q", got)
	}

	r = c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileStreamInformation, 0))
	if !bytes.Contains(r.body, wire.EncodeUTF16("::$DATA")) {
		t.Error("a file has a default stream")
	}

	r = c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, 200, 0))
	if r.hdr.Status != wire.StatusInvalidInfoClass {
		t.Errorf("unknown class: %x", r.hdr.Status)
	}
}

func TestCreditsLetAClientGrow(t *testing.T) {
	w := creditWindow{high: 1, used: map[uint64]struct{}{}}
	cases := []struct {
		name              string
		requested, charge uint16
		loggedIn          bool
		want              uint16
	}{
		//What Windows sent during a copy, and what Samba answered
		{"1 MiB read", 16, 16, false, 31},
		{"small request", 1, 1, false, 1},
		{"asks for nothing", 0, 1, false, 1},
		{"asks for a little more", 8, 1, false, 8},
		{"a request is capped", 500, 1, false, 33},
		{"end of a login", 512, 1, true, 512},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := w.grant(c.requested, c.charge, c.loggedIn); got != c.want {
				t.Errorf("got %d want %d", got, c.want)
			}
		})
	}
}

// A copy must be able to reach many reads in flight. With a balance that only
// repays what was spent, Windows has one read on the wire at a time.
func TestCreditBalanceGrowsDuringACopy(t *testing.T) {
	w := creditWindow{high: 1, used: map[uint64]struct{}{}}
	balance := func() uint64 { return w.high - w.low - uint64(len(w.used)) }
	w.grant(1, 1, true)

	mid := w.low
	reachedPipeline := false
	for i := 0; i < 400; i++ {
		if balance() < 16 {
			w.grant(16, 1, false) //Not yet enough for a large read
			continue
		}
		if !w.consume(mid, 16) {
			t.Fatalf("read %d refused at balance %d", i, balance())
		}
		mid += 16
		w.grant(16, 16, false)
		if balance() >= 16*8 {
			reachedPipeline = true
		}
	}
	if !reachedPipeline {
		t.Errorf("the balance stopped at %d, under 8 reads in flight", balance())
	}
	if balance() > maxCredits {
		t.Errorf("the balance %d passed the limit", balance())
	}
}

func TestCreditLimitIsHeld(t *testing.T) {
	w := creditWindow{high: maxCredits, used: map[uint64]struct{}{}}
	if got := w.grant(100, 1, false); got != 0 {
		t.Errorf("granted %d past the limit", got)
	}
}

// A client that behaves like Windows during a copy: 1 MiB reads, asking for
// exactly the 16 credits each one costs, with as many in flight as its balance
// allows. Before the credit fix this stayed at one read in flight, which held a
// real copy to 20 MiB/s on a link with a 33 ms round trip.
func TestWindowsStyleCopyPipelines(t *testing.T) {
	h := newHarness(t)
	const fileSize = 64 << 20
	f, err := os.Create(filepath.Join(h.share.root, "big.bin"))
	if err != nil {
		t.Fatal(err)
	}
	f.Truncate(fileSize)
	f.Close()

	c := newRawClient(t, h)
	id := mustCreate(t, c, "big.bin", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})

	const (
		readSize = 1 << 20
		cost     = 16
		reads    = 300
	)
	balance := 8 //What the last reply in newRawClient granted
	inFlight, peak, sent, done := 0, 0, 0, 0
	for done < reads {
		for balance >= cost && sent < reads {
			hdr := wire.Header{Command: wire.CmdRead, Credits: cost, CreditCharge: cost, MessageID: c.mid, SessionID: c.session, TreeID: c.tree}
			c.mid += cost
			body := readBodyOf(id, uint64(sent%64)*readSize, readSize)
			msg := make([]byte, wire.HeaderSize+len(body))
			hdr.Put(msg)
			copy(msg[wire.HeaderSize:], body)
			c.signer.Sign(msg)
			c.writeFrame(msg)
			balance -= cost
			sent++
			inFlight++
		}
		if inFlight > peak {
			peak = inFlight
		}
		if inFlight == 0 {
			//Too poor for one read: a small request tops the balance up
			r := c.call(wire.CmdEcho, []byte{4, 0, 0, 0})
			balance += int(r.hdr.Credits) - 1
			continue
		}
		r := parseReplies(t, c.readFrame())[0]
		if r.hdr.Status != 0 {
			t.Fatalf("read %d: %x", done, r.hdr.Status)
		}
		balance += int(r.hdr.Credits)
		inFlight--
		done++
	}
	if peak < 16 {
		t.Errorf("only %d reads in flight, a copy would be held to a few per round trip", peak)
	}
	t.Logf("peak %d reads in flight, final balance %d", peak, balance)
}

func TestRenameThroughOneHandleReachesTheOther(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	writer := mustCreate(t, c, "a.tmp", createOpts{access: wire.FileWriteData | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionCreate})
	mover := mustCreate(t, c, "a.tmp", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})
	if r := c.call(wire.CmdSetInfo, setInfoBody(mover, wire.FileRenameInformation, renameData("doc.docx", false))); r.hdr.Status != 0 {
		t.Fatalf("rename: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdQueryInfo, queryInfoBody(writer, wire.InfoFile, wire.FileStandardInformation, 0)); r.hdr.Status != 0 {
		t.Errorf("the first handle lost its file: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdWrite, writeBodyOf(writer, 0, []byte("still here"))); r.hdr.Status != 0 {
		t.Errorf("write after rename: %x", r.hdr.Status)
	}
	c.close(mover)
	c.close(writer)
	if got, _ := os.ReadFile(filepath.Join(h.share.root, "doc.docx")); string(got) != "still here" {
		t.Errorf("doc.docx = %q", got)
	}
}

func ioctlBody(id wire.FileID, code uint32, maxOut uint32) []byte {
	w := wire.NewWriter(56)
	w.U16(57)
	w.U16(0)
	w.U32(code)
	w.Bytes(id[:])
	w.U32(wire.HeaderSize + 56)
	w.U32(0)
	w.U32(0)
	w.U32(wire.HeaderSize + 56)
	w.U32(0)
	w.U32(maxOut)
	w.U32(wire.IoctlIsFsctl)
	w.U32(0)
	return w.B
}

func TestObjectIDs(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "a.txt"), nil, 0644)
	os.WriteFile(filepath.Join(h.share.root, "b.txt"), nil, 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "a.txt", createOpts{access: wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})
	other := mustCreate(t, c, "b.txt", createOpts{access: wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})

	object := func(f wire.FileID) []byte {
		t.Helper()
		r := c.call(wire.CmdIoctl, ioctlBody(f, wire.FsctlCreateOrGetObjectID, 64))
		if r.hdr.Status != 0 {
			t.Fatalf("status %x", r.hdr.Status)
		}
		if got := binary.LittleEndian.Uint32(r.body[36:]); got != 64 {
			t.Fatalf("output %d bytes", got)
		}
		return r.body[48:]
	}
	first := object(id)
	if !bytes.Equal(first, object(id)) {
		t.Error("an object id must be stable")
	}
	if bytes.Equal(first[:16], object(other)[:16]) {
		t.Error("two files must differ")
	}
	if !bytes.Equal(first[:16], first[32:48]) {
		t.Error("the birth id starts as the object id")
	}

	root := mustCreate(t, c, "", createOpts{access: wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})
	r := c.call(wire.CmdQueryInfo, queryInfoBody(root, wire.InfoFilesystem, wire.FileFsObjectIdInformation, 0))
	if r.hdr.Status != 0 || binary.LittleEndian.Uint32(r.body[4:]) != 64 {
		t.Errorf("volume id: %x", r.hdr.Status)
	}
	if !bytes.Equal(first[16:32], r.body[8:24]) {
		t.Error("the volume ids must agree")
	}
}

func TestFilesystemInfo(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFilesystem, wire.FileFsFullSizeInformation, 0))
	if r.hdr.Status != 0 {
		t.Fatalf("full size: %x", r.hdr.Status)
	}
	data := r.body[8:]
	if got := binary.LittleEndian.Uint64(data) * clusterSize; got != 1<<40 {
		t.Errorf("total = %d", got)
	}
	if got := binary.LittleEndian.Uint64(data[8:]) * clusterSize; got != 1<<39 {
		t.Errorf("free = %d", got)
	}

	r = c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFilesystem, wire.FileFsAttributeInformation, 0))
	data = r.body[8:]
	flags := binary.LittleEndian.Uint32(data)
	const namedStreams = 0x00040000
	if flags&namedStreams != 0 {
		t.Errorf("flags %x claim streams, which the server lacks", flags)
	}
	if flags&fsObjectIDs == 0 {
		t.Error("link tracking needs object ids")
	}
	if flags&fsPersistentACLs == 0 {
		t.Error("without persistent ACLs Explorer hides the Security tab")
	}

	for _, class := range []uint8{wire.FileFsVolumeInformation, wire.FileFsSizeInformation, wire.FileFsDeviceInformation, wire.FileFsSectorSizeInformation} {
		if r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFilesystem, class, 0)); r.hdr.Status != 0 {
			t.Errorf("class %d: %x", class, r.hdr.Status)
		}
	}
}

func TestSecurityDescriptor(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), nil, 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.ReadControl, share: shareAll, disposition: wire.DispositionOpen})

	r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoSecurity, 0, secOwner|secGroup|secDACL))
	if r.hdr.Status != 0 {
		t.Fatalf("status %x", r.hdr.Status)
	}
	sd := r.body[8:]
	owner := wire.UserSID(h.srv.machineSID, testUserName).Bytes()
	ownerAt := binary.LittleEndian.Uint32(sd[4:])
	if !bytes.Equal(sd[ownerAt:int(ownerAt)+len(owner)], owner) {
		t.Error("the owner must be the connected user")
	}
	daclAt := binary.LittleEndian.Uint32(sd[16:])
	if mask := binary.LittleEndian.Uint32(sd[daclAt+8+4:]); mask != wire.FileAllAccess {
		t.Errorf("mask = %x", mask)
	}

	//Windows reads the DACL alone too, and then there is no owner
	r = c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoSecurity, 0, secDACL))
	sd = r.body[8:]
	if binary.LittleEndian.Uint32(sd[4:]) != 0 {
		t.Error("an owner that was not asked for")
	}
}

func TestMaximalAccessContext(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), nil, 0644)
	c := newRawClient(t, h)

	ctx := wire.NewWriter(32)
	ctx.U32(0)
	ctx.U16(16)
	ctx.U16(4)
	ctx.U16(0)
	ctx.U16(0)
	ctx.U32(0)
	ctx.Bytes([]byte("MxAc"))
	ctx.Zero(4)

	build := func() []byte {
		body := createBody("f.txt", createOpts{access: wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})
		for len(body)%8 != 0 {
			body = append(body, 0)
		}
		binary.LittleEndian.PutUint32(body[48:], uint32(wire.HeaderSize+len(body)))
		binary.LittleEndian.PutUint32(body[52:], uint32(ctx.Len()))
		return append(body, ctx.B...)
	}
	maximal := func() uint32 {
		t.Helper()
		r := c.call(wire.CmdCreate, build())
		if r.hdr.Status != 0 {
			t.Fatalf("create: %x", r.hdr.Status)
		}
		return binary.LittleEndian.Uint32(r.body[88+24+4:])
	}

	if got := maximal(); got != wire.FileAllAccess {
		t.Errorf("writable: %x", got)
	}
	h.share.mu.Lock()
	h.share.denyWrite["f.txt"] = true
	h.share.mu.Unlock()
	if got := maximal(); got != wire.ReadOnlyAccess {
		t.Errorf("read only: %x", got)
	}
}

func TestSystemSecurityIsRefused(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), nil, 0644)
	c := newRawClient(t, h)
	if _, st := c.create("f.txt", createOpts{access: wire.AccessSystemSec, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusPrivilegeNotHeld {
		t.Errorf("status %x", st)
	}
}

func TestReadAtEndOfFile(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), []byte("abc"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})
	if r := c.call(wire.CmdRead, readBodyOf(id, 3, 10)); r.hdr.Status != wire.StatusEndOfFile {
		t.Errorf("at the end: %x", r.hdr.Status)
	}
	r := c.call(wire.CmdRead, readBodyOf(id, 1, 10))
	if r.hdr.Status != 0 {
		t.Fatalf("short read: %x", r.hdr.Status)
	}
	if got := binary.LittleEndian.Uint32(r.body[4:]); got != 2 {
		t.Errorf("length %d", got)
	}
	if !bytes.Equal(r.body[16:], []byte("bc")) {
		t.Errorf("data %q", r.body[16:])
	}
}

func TestReadWithoutReadAccess(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.FileWriteData, share: shareAll, disposition: wire.DispositionCreate})
	if r := c.call(wire.CmdRead, readBodyOf(id, 0, 1)); r.hdr.Status != wire.StatusAccessDenied {
		t.Errorf("status %x", r.hdr.Status)
	}
}

func TestSetTimeSurvivesClose(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.FileWriteData | wire.FileWriteAttributes, share: shareAll, disposition: wire.DispositionCreate})

	when := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	basic := wire.NewWriter(40)
	basic.U64(0)
	basic.U64(0)
	basic.U64(wire.Filetime(when))
	basic.U64(0)
	basic.U32(0)
	basic.U32(0)
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileBasicInformation, basic.B)); r.hdr.Status != 0 {
		t.Fatalf("set info: %x", r.hdr.Status)
	}
	c.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("later write")))
	c.close(id)

	info, err := os.Stat(filepath.Join(h.share.root, "f.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(when) {
		t.Errorf("mod time = %v, a copy must keep the source's date", info.ModTime())
	}
}

func TestChangedFilesAreReported(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", openRW)
	c.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("x")))
	c.close(id)
	h.share.mu.Lock()
	defer h.share.mu.Unlock()
	if len(h.share.changed) != 1 || h.share.changed[0] != "f.txt" {
		t.Errorf("changed = %v", h.share.changed)
	}
}

func TestDeletedFileAccountsBeforeItGoes(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "temp.tmp", createOpts{access: wire.FileWriteData | wire.AccessDelete, share: shareAll, disposition: wire.DispositionCreate, options: wire.OptionDeleteOnCLS})
	c.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("x")))
	c.close(id)
	h.share.mu.Lock()
	defer h.share.mu.Unlock()
	if len(h.share.changed) != 1 {
		t.Errorf("a temp file must be accounted for, or removing it gives back space it never took: %v", h.share.changed)
	}
}

func TestDeleteOnlyHandleCanQueryStandardInfo(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), []byte("x"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})
	if r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileStandardInformation, 0)); r.hdr.Status != 0 {
		t.Errorf("standard: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileBasicInformation, 0)); r.hdr.Status != wire.StatusAccessDenied {
		t.Errorf("basic needs read attributes: %x", r.hdr.Status)
	}
}

// countingShare counts folder reads, to prove the cache is doing its job.
type countingShare struct {
	*testShare
	reads int
}

func (s *countingShare) ReadDir(p string) ([]FileInfo, error) {
	s.reads++
	return s.testShare.ReadDir(p)
}

func TestNameCache(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "Real.txt"), []byte("x"), 0644)
	s := &countingShare{testShare: &testShare{name: "d", root: root, denyRead: map[string]bool{}, denyWrite: map[string]bool{}}}
	names := newNameCache()

	res, err := resolve(s, names, "missing.txt")
	if err != nil || res.exists || !res.parentExists {
		t.Fatalf("missing: %+v %v", res, err)
	}
	reads := s.reads
	for i := 0; i < 50; i++ {
		resolve(s, names, "desktop.ini")
	}
	if s.reads != reads {
		t.Errorf("repeated misses read the folder %d more times", s.reads-reads)
	}

	//A stale spelling must never produce a file that is gone
	names.forget(s, "")
	res, _ = resolve(s, names, "NOT-THERE")
	os.Remove(filepath.Join(root, "Real.txt"))
	res, err = resolve(s, names, "REAL.TXT")
	if err != nil || res.exists {
		t.Errorf("a removed file resolved: %+v %v", res, err)
	}
}

func TestNameCacheForgetsWhatTheServerChanges(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)

	//Fill the cache with a miss, then create the file in another case
	if _, st := c.create("New.TXT", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen}); st != wire.StatusObjectNameNotFound {
		t.Fatalf("expected a miss: %x", st)
	}
	id := mustCreate(t, c, "new.txt", createOpts{access: wire.FileWriteData, share: shareAll, disposition: wire.DispositionCreate})
	c.close(id)
	got, st := c.create("NEW.txt", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})
	if st != 0 {
		t.Fatalf("a file just created must be found in any case: %x", st)
	}
	c.close(got)
}

func TestRevokedDriveStopsAnsweringQueries(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f.txt"), []byte("x"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", createOpts{access: wire.FileReadData | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})
	h.share.mu.Lock()
	h.share.denyRead["f.txt"] = true
	h.share.mu.Unlock()
	if r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileStandardInformation, 0)); r.hdr.Status != wire.StatusAccessDenied {
		t.Errorf("query: %x", r.hdr.Status)
	}
	if r := c.call(wire.CmdRead, readBodyOf(id, 0, 1)); r.hdr.Status != wire.StatusAccessDenied {
		t.Errorf("read: %x", r.hdr.Status)
	}
}

func TestUnsignedRequestDropsTheConnection(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	msg := c.message(wire.CmdEcho, []byte{4, 0, 0, 0}, 0)
	c.writeFrame(msg)
	c.nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.nc.Read(make([]byte, 1)); err == nil {
		t.Error("an unsigned request on a signed session must end the connection")
	}
}

func TestForgedSignatureDropsTheConnection(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	msg := c.message(wire.CmdEcho, []byte{4, 0, 0, 0}, 0)
	c.signer.Sign(msg)
	msg[wire.SignatureAt] ^= 1
	c.writeFrame(msg)
	c.nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.nc.Read(make([]byte, 1)); err == nil {
		t.Error("a forged signature must end the connection")
	}
}

func TestReusedMessageIDDropsTheConnection(t *testing.T) {
	h := newHarness(t)
	c := newRawClient(t, h)
	if r := c.call(wire.CmdEcho, []byte{4, 0, 0, 0}); r.hdr.Status != 0 {
		t.Fatal(r.hdr.Status)
	}
	c.mid--
	msg := c.message(wire.CmdEcho, []byte{4, 0, 0, 0}, 0)
	c.signer.Sign(msg)
	c.writeFrame(msg)
	c.nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.nc.Read(make([]byte, 1)); err == nil {
		t.Error("a replayed message id must end the connection")
	}
}

func TestUnderchargedReadIsRefused(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "f"), make([]byte, 1<<20), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})
	//message() charges one credit, which covers 64 KiB
	if r := c.call(wire.CmdRead, readBodyOf(id, 0, 1<<20)); r.hdr.Status != wire.StatusInvalidParameter {
		t.Errorf("status %x", r.hdr.Status)
	}
}

func TestSMB1OpeningMovesToSMB2(t *testing.T) {
	h := newHarness(t)
	nc, err := netDial(h)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	c := &rawClient{t: t, nc: nc}

	smb1 := make([]byte, 32)
	copy(smb1, []byte{0xFF, 'S', 'M', 'B', 0x72})
	data := []byte("\x02NT LM 0.12\x00\x02SMB 2.002\x00\x02SMB 2.???\x00")
	smb1 = append(smb1, 0, byte(len(data)), 0)
	smb1 = append(smb1, data...)
	c.writeFrame(smb1)

	r := parseReplies(t, c.readFrame())[0]
	if got := binary.LittleEndian.Uint16(r.body[4:]); got != wire.DialectWildcard {
		t.Fatalf("dialect %x", got)
	}

	c.mid = 1
	c.writeFrame(c.message(wire.CmdNegotiate, negotiateBody(wire.Dialect311), 0))
	r = parseReplies(t, c.readFrame())[0]
	if got := binary.LittleEndian.Uint16(r.body[4:]); got != wire.Dialect311 {
		t.Errorf("dialect %x", got)
	}
}

func TestSMB1WithoutSMB2IsDropped(t *testing.T) {
	h := newHarness(t)
	nc, err := netDial(h)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	c := &rawClient{t: t, nc: nc}
	smb1 := make([]byte, 32)
	copy(smb1, []byte{0xFF, 'S', 'M', 'B', 0x72})
	data := []byte("\x02NT LM 0.12\x00")
	smb1 = append(smb1, 0, byte(len(data)), 0)
	smb1 = append(smb1, data...)
	c.writeFrame(smb1)
	c.nc.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.nc.Read(make([]byte, 1)); err == nil {
		t.Error("an SMB1 only client gets no session")
	}
}

func TestDialectSelection(t *testing.T) {
	cases := []struct {
		offered []uint16
		want    uint16
	}{
		{[]uint16{wire.Dialect202, wire.Dialect210, wire.Dialect300, wire.Dialect302, wire.Dialect311}, wire.Dialect311},
		{[]uint16{wire.Dialect210, wire.Dialect302}, wire.Dialect302},
		{[]uint16{wire.Dialect210}, wire.Dialect210},
		{[]uint16{wire.Dialect202}, 0},
	}
	for _, tc := range cases {
		if got := pickDialect(tc.offered); got != tc.want {
			t.Errorf("%x: got %x want %x", tc.offered, got, tc.want)
		}
	}
}

func TestParsePath(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		status uint32
	}{
		{"", "", 0},
		{`folder\file.txt`, "folder/file.txt", 0},
		{`\leading`, "leading", 0},
		{`trailing\`, "trailing", 0},
		{`file.txt::$DATA`, "file.txt", 0},
		{`FILE.TXT::$data`, "FILE.TXT", 0},
		{`file.txt:Zone.Identifier`, "", wire.StatusObjectNameInvalid},
		{`file.txt:Zone.Identifier:$DATA`, "", wire.StatusObjectNameInvalid},
		{`a:b\c`, "", wire.StatusObjectNameInvalid},
		{`..\etc\passwd`, "", wire.StatusObjectPathSyntaxBad},
		{`a\..\..\b`, "", wire.StatusObjectPathSyntaxBad},
		{`.`, "", wire.StatusObjectPathSyntaxBad},
		{`a\\b`, "", wire.StatusObjectNameInvalid},
		{`wild*card`, "", wire.StatusObjectNameInvalid},
		{`qu?ry`, "", wire.StatusObjectNameInvalid},
		{"nul\x00byte", "", wire.StatusObjectNameInvalid},
		{"tab\tname", "", wire.StatusObjectNameInvalid},
		{`a/b`, "", wire.StatusObjectNameInvalid},
		{strings.Repeat("x", 256), "", wire.StatusObjectNameInvalid},
		{strings.Repeat("x", 255), strings.Repeat("x", 255), 0},
		{"name", ":name", 0},
	}
	for _, tc := range cases {
		got, st := parsePath(tc.in)
		if st != tc.status || got != tc.want {
			t.Errorf("%q: got %q %x, want %q %x", tc.in, got, st, tc.want, tc.status)
		}
	}
}

func TestNameMapping(t *testing.T) {
	cases := []string{"plain.txt", "colon:name", `what?.txt`, "star*", "trailing.", "trailing ", `a"b<c>d|e`, ".", ".."}
	for _, name := range cases {
		wireName := toWireName(name)
		if name != "." && name != ".." && strings.ContainsAny(wireName, `:?*"<>|`) {
			t.Errorf("%q still has a forbidden character: %q", name, wireName)
		}
		if got := fromWireName(wireName); got != name {
			t.Errorf("%q round trip gave %q", name, got)
		}
	}
	if got := toWireName("."); got != "." {
		t.Errorf("the current folder entry changed: %q", got)
	}
}

func TestMappedNamesAreReachable(t *testing.T) {
	h := newHarness(t)
	os.WriteFile(filepath.Join(h.share.root, "a:b.txt"), []byte("mapped"), 0644)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})

	r := c.call(wire.CmdQueryDirectory, queryDirBody(id, wire.FileNamesInformation, 0, "*"))
	listed := toWireName("a:b.txt")
	if !bytes.Contains(r.body, wire.EncodeUTF16(listed)) {
		t.Fatal("the mapped name must be listed")
	}
	f := mustCreate(t, c, listed, createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen})
	rr := c.call(wire.CmdRead, readBodyOf(f, 0, 6))
	if rr.hdr.Status != 0 || string(rr.body[16:]) != "mapped" {
		t.Errorf("read: %x %q", rr.hdr.Status, rr.body)
	}
}

func TestMatchPattern(t *testing.T) {
	cases := []struct {
		pattern, name string
		want          bool
	}{
		{"*", "anything", true},
		{"*.*", "noext", true},
		{"*.txt", "a.TXT", true},
		{"*.txt", "a.txt.bak", false},
		{"a?c", "abc", true},
		{"a?c", "ac", false},
		{"A.TXT", "a.txt", true},
		{"<.txt", "a.b.txt", true},
		{"<.TXT", "a.doc", false},
		{`DESKTOP.INI`, "desktop.ini", true},
		{`file"txt`, "file.txt", true},
		{`file>`, "file1", true},
		{`file>`, "file", true},
	}
	for _, tc := range cases {
		if got := matchPattern(tc.pattern, tc.name); got != tc.want {
			t.Errorf("%q vs %q: %v", tc.pattern, tc.name, got)
		}
	}
}

func TestCapture(t *testing.T) {
	dir := t.TempDir()
	h := newHarness(t, func(c *Config) { c.CaptureDir = dir })
	c := newRawClient(t, h)
	id := mustCreate(t, c, "f.txt", openRW)
	secret := bytes.Repeat([]byte("SECRETCONTENT"), 1000)
	c.call(wire.CmdWrite, writeBodyOf(id, 0, secret))
	c.close(id)
	h.srv.Close()

	pcaps, _ := filepath.Glob(filepath.Join(dir, "*.pcap"))
	logs, _ := filepath.Glob(filepath.Join(dir, "*.log"))
	if len(pcaps) != 1 || len(logs) != 1 {
		t.Fatalf("files: %v %v", pcaps, logs)
	}
	data, _ := os.ReadFile(pcaps[0])
	if !bytes.Equal(data[:4], []byte{0xd4, 0xc3, 0xb2, 0xa1}) {
		t.Error("not a pcap")
	}
	if bytes.Contains(data, secret[:4000]) {
		t.Error("file contents must be cut unless asked for")
	}
	trace, _ := os.ReadFile(logs[0])
	for _, want := range []string{"CREATE", "WRITE", `"f.txt"`, "SESSION_SETUP"} {
		if !strings.Contains(string(trace), want) {
			t.Errorf("trace lacks %s", want)
		}
	}
}

func TestCaptureRedactsLogins(t *testing.T) {
	dir := t.TempDir()
	h := newHarness(t, func(c *Config) { c.CaptureDir = dir })
	c := newRawClient(t, h)
	c.nc.Close()
	h.srv.Close()

	pcaps, _ := filepath.Glob(filepath.Join(dir, "*.pcap"))
	data, _ := os.ReadFile(pcaps[0])
	at := bytes.Index(data, []byte("NTLMSSP\x00\x03\x00\x00\x00"))
	if at < 0 {
		t.Fatal("the capture has no AUTHENTICATE")
	}
	msg := data[at:]
	length := binary.LittleEndian.Uint16(msg[20:])
	offset := binary.LittleEndian.Uint32(msg[24:])
	if !bytes.Equal(msg[offset:offset+uint32(length)], make([]byte, length)) {
		t.Error("the NT response must never reach a capture")
	}
}
