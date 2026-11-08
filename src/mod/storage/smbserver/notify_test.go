package smbserver

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

const allNameChanges = notifyFileName | notifyDirName | notifyAttributes | notifySize | notifyLastWrite

func watchBody(id wire.FileID, filter uint32, tree bool, maxOut uint32) []byte {
	w := wire.NewWriter(32)
	w.U16(32)
	if tree {
		w.U16(notifyWatchTree)
	} else {
		w.U16(0)
	}
	w.U32(maxOut)
	w.Bytes(id[:])
	w.U32(filter)
	w.U32(0)
	return w.B
}

// sendWatch sends a CHANGE_NOTIFY and returns the reply that is not interim:
// at once when changes were waiting, else after the next one.
func sendWatch(t *testing.T, c *rawClient, body []byte) {
	t.Helper()
	msg := c.message(wire.CmdChangeNotify, body, 0)
	c.signer.Sign(msg)
	c.writeFrame(msg)
}

type change struct {
	action uint32
	name   string
}

func readChanges(t *testing.T, c *rawClient) (uint32, []change) {
	t.Helper()
	for {
		r := parseReplies(t, c.readFrame())[0]
		if r.hdr.Status == wire.StatusPending {
			continue
		}
		c.verify(r)
		if r.hdr.Command != wire.CmdChangeNotify {
			t.Fatalf("got command %d while waiting for a notify", r.hdr.Command)
		}
		return r.hdr.Status, decodeChanges(t, r.body)
	}
}

func decodeChanges(t *testing.T, body []byte) []change {
	t.Helper()
	off := int(binary.LittleEndian.Uint16(body[2:]))
	n := int(binary.LittleEndian.Uint32(body[4:]))
	if n == 0 {
		return nil
	}
	data := body[off-wire.HeaderSize : off-wire.HeaderSize+n]
	out := []change{}
	for {
		next := binary.LittleEndian.Uint32(data)
		action := binary.LittleEndian.Uint32(data[4:])
		length := binary.LittleEndian.Uint32(data[8:])
		name, _ := wire.DecodeUTF16(data[12 : 12+length])
		out = append(out, change{action, name})
		if next == 0 {
			return out
		}
		if next%4 != 0 {
			t.Errorf("entry offset %d is not aligned", next)
		}
		data = data[next:]
	}
}

func openFolder(t *testing.T, c *rawClient, name string) wire.FileID {
	t.Helper()
	return mustCreate(t, c, name, createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})
}

func noPoll(c *Config) { c.NotifyPoll = -1 }

func TestNotifyReportsChangesFromAnotherClient(t *testing.T) {
	h := newHarness(t, noPoll)
	watcher := newRawClient(t, h)
	other := newRawClient(t, h)
	dir := openFolder(t, watcher, "")
	sendWatch(t, watcher, watchBody(dir, allNameChanges, false, 4096))
	if r := parseReplies(t, watcher.readFrame())[0]; r.hdr.Status != wire.StatusPending {
		t.Fatalf("interim: %x", r.hdr.Status)
	}

	id := mustCreate(t, other, "new.txt", openRW)
	status, got := readChanges(t, watcher)
	if status != 0 || len(got) != 1 || got[0] != (change{actionAdded, "new.txt"}) {
		t.Fatalf("status %x, changes %v", status, got)
	}

	//Changes while no request waits are kept for the next one
	other.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("hello")))
	other.close(id)
	sendWatch(t, watcher, watchBody(dir, allNameChanges, false, 4096))
	status, got = readChanges(t, watcher)
	if status != 0 || len(got) != 1 || got[0] != (change{actionModified, "new.txt"}) {
		t.Errorf("status %x, changes %v", status, got)
	}
}

func TestNotifyRenameAndDelete(t *testing.T) {
	h := newHarness(t, noPoll)
	os.WriteFile(filepath.Join(h.share.root, "a.txt"), []byte("x"), 0644)
	watcher := newRawClient(t, h)
	other := newRawClient(t, h)
	dir := openFolder(t, watcher, "")
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 4096))
	parseReplies(t, watcher.readFrame())

	id := mustCreate(t, other, "a.txt", createOpts{access: wire.AccessDelete | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen})
	if r := other.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("b.txt", false))); r.hdr.Status != 0 {
		t.Fatalf("rename: %x", r.hdr.Status)
	}
	status, got := readChanges(t, watcher)
	want := []change{{actionRenamedOld, "a.txt"}, {actionRenamedNew, "b.txt"}}
	if status != 0 || len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("status %x, changes %v", status, got)
	}

	if r := other.call(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1})); r.hdr.Status != 0 {
		t.Fatalf("delete: %x", r.hdr.Status)
	}
	other.close(id)
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 4096))
	status, got = readChanges(t, watcher)
	if status != 0 || len(got) != 1 || got[0] != (change{actionRemoved, "b.txt"}) {
		t.Errorf("status %x, changes %v", status, got)
	}
}

func TestNotifyFilterAndTree(t *testing.T) {
	h := newHarness(t, noPoll)
	os.MkdirAll(filepath.Join(h.share.root, "sub", "deep"), 0755)
	watcher := newRawClient(t, h)
	other := newRawClient(t, h)

	flat := openFolder(t, watcher, "")
	tree := openFolder(t, watcher, "sub")
	sendWatch(t, watcher, watchBody(flat, notifyFileName, false, 4096))
	parseReplies(t, watcher.readFrame())
	sendWatch(t, watcher, watchBody(tree, notifyFileName, true, 4096))
	parseReplies(t, watcher.readFrame())

	//A folder does not match a file name filter, and a file two levels
	//down reaches only the tree watch
	other.close(mustCreate(t, other, "sub\\deep\\folder", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionCreate, options: wire.OptionDirectory}))
	other.close(mustCreate(t, other, "sub\\deep\\f.txt", openRW))
	status, got := readChanges(t, watcher)
	if status != 0 || len(got) != 1 || got[0] != (change{actionAdded, `deep\f.txt`}) {
		t.Fatalf("tree watch: status %x, changes %v", status, got)
	}

	other.close(mustCreate(t, other, "top.txt", openRW))
	status, got = readChanges(t, watcher)
	if status != 0 || len(got) != 1 || got[0] != (change{actionAdded, "top.txt"}) {
		t.Errorf("flat watch: status %x, changes %v", status, got)
	}
}

func TestNotifyOverflowAsksForAListing(t *testing.T) {
	h := newHarness(t, noPoll)
	watcher := newRawClient(t, h)
	other := newRawClient(t, h)
	dir := openFolder(t, watcher, "")
	//The first request starts the watch, and is answered by the first file
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 4096))
	parseReplies(t, watcher.readFrame())
	other.close(mustCreate(t, other, "first.txt", openRW))
	readChanges(t, watcher)

	for i := 0; i < 20; i++ {
		other.close(mustCreate(t, other, "file-with-a-long-name-"+strings.Repeat("x", i)+".txt", openRW))
	}
	//Twenty names do not fit in 64 bytes
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 64))
	status, got := readChanges(t, watcher)
	if status != wire.StatusNotifyEnumDir || len(got) != 0 {
		t.Errorf("status %x, changes %v", status, got)
	}
}

func TestNotifySeesChangesMadeAroundTheServer(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.NotifyPoll = 50 * time.Millisecond })
	os.WriteFile(filepath.Join(h.share.root, "old.txt"), []byte("1"), 0644)
	watcher := newRawClient(t, h)
	dir := openFolder(t, watcher, "")
	sendWatch(t, watcher, watchBody(dir, allNameChanges, false, 4096))
	parseReplies(t, watcher.readFrame())
	time.Sleep(200 * time.Millisecond) //The first listing is the baseline

	//The File Manager writes straight to the drive
	os.WriteFile(filepath.Join(h.share.root, "web.txt"), []byte("from the browser"), 0644)
	os.Remove(filepath.Join(h.share.root, "old.txt"))
	seen := map[change]bool{}
	want := []change{{actionRemoved, "old.txt"}, {actionAdded, "web.txt"}}
	deadline := time.Now().Add(3 * time.Second)
	for !(seen[want[0]] && seen[want[1]]) && time.Now().Before(deadline) {
		_, more := readChanges(t, watcher)
		for _, c := range more {
			seen[c] = true
		}
		if !(seen[want[0]] && seen[want[1]]) {
			sendWatch(t, watcher, watchBody(dir, allNameChanges, false, 4096))
		}
	}
	//A write caught halfway may add a "modified" too, which is fine
	for _, w := range want {
		if !seen[w] {
			t.Errorf("missing %v, saw %v", w, seen)
		}
	}
}

func TestNotifyOwnChangesAreNotReportedTwice(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.NotifyPoll = 50 * time.Millisecond })
	watcher := newRawClient(t, h)
	other := newRawClient(t, h)
	dir := openFolder(t, watcher, "")
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 4096))
	parseReplies(t, watcher.readFrame())
	time.Sleep(200 * time.Millisecond)

	other.close(mustCreate(t, other, "mine.txt", openRW))
	if _, got := readChanges(t, watcher); len(got) != 1 {
		t.Fatalf("changes %v", got)
	}
	sendWatch(t, watcher, watchBody(dir, notifyFileName, false, 4096))
	parseReplies(t, watcher.readFrame()) //Interim
	watcher.nc.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	head := make([]byte, 4)
	if _, err := watcher.nc.Read(head); err == nil {
		t.Error("the poll reported a change this server made and already reported")
	}
}

func TestRelativeName(t *testing.T) {
	cases := []struct {
		dir, p string
		tree   bool
		want   string
		ok     bool
	}{
		{"", "a.txt", false, "a.txt", true},
		{"", "sub/a.txt", false, "", false},
		{"", "sub/a.txt", true, `sub\a.txt`, true},
		{"Docs", "docs/a.txt", false, "a.txt", true},
		{"docs", "docsx/a.txt", true, "", false},
		{"docs", "docs", true, "", false},
	}
	for _, c := range cases {
		got, ok := relativeName(c.dir, c.p, c.tree)
		if got != c.want || ok != c.ok {
			t.Errorf("relativeName(%q, %q, %v) = %q, %v", c.dir, c.p, c.tree, got, ok)
		}
	}
}
