package smbserver

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func decodeStreamInfo(t *testing.T, b []byte) map[string]uint64 {
	t.Helper()
	out := map[string]uint64{}
	for len(b) >= 24 {
		next := binary.LittleEndian.Uint32(b)
		n := binary.LittleEndian.Uint32(b[4:])
		size := binary.LittleEndian.Uint64(b[8:])
		name, _ := wire.DecodeUTF16(b[24 : 24+n])
		out[name] = size
		if next == 0 {
			break
		}
		if next%8 != 0 {
			t.Errorf("entry offset %d is not 8 aligned", next)
		}
		b = b[next:]
	}
	return out
}

func queryStreams(t *testing.T, c *rawClient, id wire.FileID) map[string]uint64 {
	t.Helper()
	r := c.call(wire.CmdQueryInfo, queryInfoBody(id, wire.InfoFile, wire.FileStreamInformation, 0))
	if r.hdr.Status != 0 {
		t.Fatalf("stream query: %x", r.hdr.Status)
	}
	off := binary.LittleEndian.Uint16(r.body[2:]) - wire.HeaderSize
	n := binary.LittleEndian.Uint32(r.body[4:])
	return decodeStreamInfo(t, r.body[off:uint32(off)+n])
}

func TestNamedStreams(t *testing.T) {
	h := newHarness(t, noPoll)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), []byte("hello"), 0644)
	c := newRawClient(t, h)

	//Windows writes where a download came from
	id := mustCreate(t, c, "doc.txt:Zone.Identifier:$DATA", openRW)
	if r := c.call(wire.CmdWrite, writeBodyOf(id, 0, []byte("[ZoneTransfer]\r\nZoneId=3\r\n"))); r.hdr.Status != 0 {
		t.Fatalf("write: %x", r.hdr.Status)
	}
	c.close(id)
	if got, _ := os.ReadFile(filepath.Join(h.share.root, "doc.txt")); string(got) != "hello" {
		t.Errorf("the stream changed the file: %q", got)
	}

	file := mustCreate(t, c, "doc.txt", openRead)
	streams := queryStreams(t, c, file)
	if streams["::$DATA"] != 5 || streams[":Zone.Identifier:$DATA"] != 26 || len(streams) != 2 {
		t.Errorf("streams %v", streams)
	}

	//Read it back by its short name
	id = mustCreate(t, c, "doc.txt:Zone.Identifier", openRead)
	r := c.call(wire.CmdRead, readBodyOf(id, 0, 64))
	if r.hdr.Status != 0 || string(r.body[16:16+26]) != "[ZoneTransfer]\r\nZoneId=3\r\n" {
		t.Errorf("read %x %q", r.hdr.Status, r.body)
	}
	c.close(id)

	//Delete the stream alone
	id = mustCreate(t, c, "doc.txt:Zone.Identifier", createOpts{access: wire.AccessDelete, share: shareAll, disposition: wire.DispositionOpen})
	c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1}))
	c.close(id)
	if streams := queryStreams(t, c, file); len(streams) != 1 {
		t.Errorf("after the delete: %v", streams)
	}
	if _, err := os.Stat(filepath.Join(h.share.root, "doc.txt")); err != nil {
		t.Error("deleting a stream must keep the file")
	}
}

func TestStreamRules(t *testing.T) {
	h := newHarness(t, noPoll)
	os.WriteFile(filepath.Join(h.share.root, "doc.txt"), nil, 0644)
	c := newRawClient(t, h)
	cases := []struct {
		name string
		opts createOpts
		want uint32
	}{
		{"missing.txt:s", openRW, wire.StatusObjectNameNotFound},
		{"nowhere\\missing.txt:s", openRW, wire.StatusObjectPathNotFound},
		{"doc.txt:s:$INDEX_ALLOCATION", openRW, wire.StatusObjectNameInvalid},
		{"doc.txt:s", createOpts{access: wire.FileReadData, share: shareAll, disposition: wire.DispositionOpenIf, options: wire.OptionDirectory}, wire.StatusNotADirectory},
		{"doc.txt:", openRead, 0},
		{"doc.txt::$DATA", openRead, 0},
	}
	for _, tc := range cases {
		if _, st := c.create(tc.name, tc.opts); st != tc.want {
			t.Errorf("%s: %x, want %x", tc.name, st, tc.want)
		}
	}
	//A stream handle cannot be renamed
	id := mustCreate(t, c, "doc.txt:s", createOpts{access: wire.AccessDelete | wire.FileWriteData, share: shareAll, disposition: wire.DispositionOpenIf})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileRenameInformation, renameData("other.txt", false))); r.hdr.Status != wire.StatusInvalidParameter {
		t.Errorf("rename of a stream: %x", r.hdr.Status)
	}
}

func TestVolumeClaimsNamedStreams(t *testing.T) {
	h := newHarness(t, noPoll)
	c := newRawClient(t, h)
	root := openFolder(t, c, "")
	r := c.call(wire.CmdQueryInfo, queryInfoBody(root, wire.InfoFilesystem, wire.FileFsAttributeInformation, 0))
	if r.hdr.Status != 0 {
		t.Fatalf("status %x", r.hdr.Status)
	}
	off := binary.LittleEndian.Uint16(r.body[2:]) - wire.HeaderSize
	if flags := binary.LittleEndian.Uint32(r.body[off:]); flags&fsNamedStreams == 0 {
		t.Errorf("flags %x: a share with streams must say so, or macOS writes ._ files", flags)
	}
}

func TestParsePathStream(t *testing.T) {
	cases := []struct {
		in, path, stream string
		ok               bool
	}{
		{`a\b.txt:Zone.Identifier:$DATA`, "a/b.txt", "Zone.Identifier", true},
		{`a\b.txt:s`, "a/b.txt", "s", true},
		{`a\b.txt::$DATA`, "a/b.txt", "", true},
		{"b.txt:com.apple.metadata_kMDItemUserTags", "b.txt", "com.apple.metadata:_kMDItemUserTags", true},
		{`a:s\b.txt`, "", "", false},
		{`b.txt:s:$INDEX_ALLOCATION`, "", "", false},
		{`:AFP_AfpInfo`, "", "AFP_AfpInfo", true},
	}
	for _, tc := range cases {
		p, s, st := parsePathStream(tc.in)
		if (st == wire.StatusOK) != tc.ok || tc.ok && (p != tc.path || s != tc.stream) {
			t.Errorf("%q: %q %q %x", tc.in, p, s, st)
		}
	}
	if _, st := parsePath(`b.txt:s`); st == wire.StatusOK {
		t.Error("parsePath must still refuse streams")
	}
}

func TestInternalFolderIsNotListed(t *testing.T) {
	h := newHarness(t, noPoll)
	os.MkdirAll(filepath.Join(h.share.root, "docs", ".metadata", ".streams"), 0755)
	os.WriteFile(filepath.Join(h.share.root, "docs", "a.txt"), nil, 0644)
	c := newRawClient(t, h)
	dir := openFolder(t, c, "docs")
	r := c.call(wire.CmdQueryDirectory, queryDirBody(dir, wire.FileNamesInformation, 0, "*"))
	if bytes.Contains(r.body, wire.EncodeUTF16(".metadata")) || !bytes.Contains(r.body, wire.EncodeUTF16("a.txt")) {
		t.Error("the listing must show a.txt and leave .metadata out")
	}
	//Asked for by name it is not there either, yet paths into it still work
	r = c.call(wire.CmdQueryDirectory, queryDirBody(dir, wire.FileNamesInformation, wire.RestartScans, ".metadata"))
	if bytes.Contains(r.body, wire.EncodeUTF16(".metadata")) {
		t.Error("a lookup by name must not find it")
	}

	//A folder holding nothing but ArozOS's own folder counts as empty
	os.Remove(filepath.Join(h.share.root, "docs", "a.txt"))
	id := mustCreate(t, c, "docs", createOpts{access: wire.AccessDelete | wire.FileReadAttributes, share: shareAll, disposition: wire.DispositionOpen, options: wire.OptionDirectory})
	if r := c.call(wire.CmdSetInfo, setInfoBody(id, wire.FileDispositionInformation, []byte{1})); r.hdr.Status != 0 {
		t.Errorf("delete: %x", r.hdr.Status)
	}
}
