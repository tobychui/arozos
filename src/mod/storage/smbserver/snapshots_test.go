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

var versionTime1 = time.Date(2026, 11, 8, 2, 0, 0, 0, time.UTC)
var versionTime2 = time.Date(2026, 11, 7, 1, 30, 15, 0, time.UTC)

func versionHarness(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t, noPoll)
	root := h.share.root
	os.MkdirAll(filepath.Join(root, ".metadata", "v1"), 0755)
	os.WriteFile(filepath.Join(root, "report.txt"), []byte("current text"), 0644)
	os.WriteFile(filepath.Join(root, ".metadata", "v1", "report.txt"), []byte("older text"), 0644)
	h.share.versions = map[string]map[time.Time]string{
		"report.txt": {versionTime1: ".metadata/v1/report.txt", versionTime2: ".metadata/v1/report.txt"},
	}
	return h
}

func snapshotTokens(t *testing.T, out []byte) (int, int, []string) {
	t.Helper()
	total := int(binary.LittleEndian.Uint32(out))
	returned := int(binary.LittleEndian.Uint32(out[4:]))
	size := int(binary.LittleEndian.Uint32(out[8:]))
	tokens := []string{}
	if returned > 0 {
		text, _ := wire.DecodeUTF16(out[12 : 12+size])
		for _, tok := range strings.Split(text, "\x00") {
			if tok != "" {
				tokens = append(tokens, tok)
			}
		}
	}
	return total, returned, tokens
}

func TestEnumerateSnapshots(t *testing.T) {
	h := versionHarness(t)
	c := newRawClient(t, h)
	id := mustCreate(t, c, "report.txt", openRead)

	//Windows first asks with room for the counts only
	r := c.call(wire.CmdIoctl, ioctlBody(id, wire.FsctlEnumerateSnapshots, 16))
	if r.hdr.Status != 0 {
		t.Fatalf("status %x", r.hdr.Status)
	}
	total, returned, _ := snapshotTokens(t, ioctlOutput(t, r))
	if total != 2 || returned != 0 {
		t.Errorf("small buffer: %d total, %d returned", total, returned)
	}
	r = c.call(wire.CmdIoctl, ioctlBody(id, wire.FsctlEnumerateSnapshots, 4096))
	total, returned, tokens := snapshotTokens(t, ioctlOutput(t, r))
	want := []string{"@GMT-2026.11.08-02.00.00", "@GMT-2026.11.07-01.30.15"}
	if total != 2 || returned != 2 || len(tokens) != 2 || tokens[0] != want[0] || tokens[1] != want[1] {
		t.Errorf("tokens %v (%d/%d), want newest first %v", tokens, returned, total, want)
	}

	plain := mustCreate(t, c, "other.txt", openRW)
	r = c.call(wire.CmdIoctl, ioctlBody(plain, wire.FsctlEnumerateSnapshots, 4096))
	if total, _, _ := snapshotTokens(t, ioctlOutput(t, r)); total != 0 {
		t.Errorf("a file without versions has %d", total)
	}
}

func timewarpCtx(at time.Time) createCtx {
	w := wire.NewWriter(8)
	w.U64(wire.Filetime(at))
	return createCtx{wire.ContextTimewarp, w.B}
}

func TestOpenAVersion(t *testing.T) {
	h := versionHarness(t)
	c := newRawClient(t, h)

	read := func(r rawReply) string {
		t.Helper()
		got := parseCreateReply(r)
		if got.status != 0 {
			t.Fatalf("open: %x", got.status)
		}
		rr := c.call(wire.CmdRead, readBodyOf(got.id, 0, 64))
		n := binary.LittleEndian.Uint32(rr.body[4:])
		return string(rr.body[16 : 16+n])
	}
	byContext := c.call(wire.CmdCreate, createWithContexts("report.txt", openRead, 0, []createCtx{timewarpCtx(versionTime1)}))
	if got := read(byContext); got != "older text" {
		t.Errorf("TWrp read %q", got)
	}
	byPath := c.call(wire.CmdCreate, createBody(`@GMT-2026.11.08-02.00.00\report.txt`, openRead))
	if got := read(byPath); got != "older text" {
		t.Errorf("@GMT path read %q", got)
	}

	//Versions cannot be changed, and unknown times do not exist
	write := c.call(wire.CmdCreate, createWithContexts("report.txt", openRW, 0, []createCtx{timewarpCtx(versionTime1)}))
	if st := write.hdr.Status; st == 0 {
		t.Error("a version opened for writing")
	}
	missing := c.call(wire.CmdCreate, createWithContexts("report.txt", openRead, 0, []createCtx{timewarpCtx(versionTime1.Add(time.Hour))}))
	if missing.hdr.Status != wire.StatusObjectNameNotFound {
		t.Errorf("unknown time: %x", missing.hdr.Status)
	}
	if got, _ := os.ReadFile(filepath.Join(h.share.root, "report.txt")); string(got) != "current text" {
		t.Errorf("the current file changed: %q", got)
	}
}

func TestGMTTokens(t *testing.T) {
	rest, at, ok := splitGMTToken("docs/@GMT-2026.11.08-02.00.00/report.txt")
	if !ok || rest != "docs/report.txt" || !at.Equal(versionTime1) {
		t.Errorf("%q %v %v", rest, at, ok)
	}
	for _, bad := range []string{"docs/report.txt", "@GMT-2026.11.08", "@GMT-2026.13.08-02.00.00"} {
		if _, _, ok := splitGMTToken(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
	if out := snapshotArray(nil, 4096); len(out) != 16 || binary.LittleEndian.Uint32(out) != 0 {
		t.Errorf("no versions: %x", out)
	}
}
