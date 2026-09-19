package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
)

func init() {
	membership.HeartbeatInterval = 500 * time.Millisecond
	membership.OnlineWindow = 2 * time.Second
	membership.OfflineWindow = 4 * time.Second
}

type testNode struct {
	id   string
	m    *membership.Manager
	meta *metadata.Manager
	svc  *Service
	srv  *httptest.Server
	root string //local drive root exposed as fsh "disk"
}

func newTestNode(t *testing.T, id string) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID: id, DBFile: filepath.Join(dir, "cluster.db"), KeyFile: filepath.Join(dir, "node.key"),
		Version: "test", DefaultName: "Node " + id,
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	meta, err := metadata.New(metadata.Option{
		Membership: m, LeaseDuration: 3 * time.Second, LeaseRenew: time.Second,
		LeaseTick: 200 * time.Millisecond, PendingRetry: 300 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("metadata.New: %v", err)
	}
	root := filepath.Join(dir, "disk")
	os.MkdirAll(root, 0755)
	svc, err := New(Option{
		Membership: m, Metadata: meta, TmpDir: filepath.Join(dir, "tmp"),
		LocalRoots:      func() map[string]string { return map[string]string{"disk": root} },
		RefreshInterval: time.Hour, ReconcileInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("storage.New: %v", err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	cfg := m.Config()
	cfg.AdvertiseURL = srv.URL
	m.UpdateConfig(cfg)
	n := &testNode{id: id, m: m, meta: meta, svc: svc, srv: srv, root: root}
	t.Cleanup(func() {
		svc.Close()
		meta.Close()
		m.Close()
		srv.Close()
	})
	return n
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// cluster2 returns a (leader, with a volume) and b (member, no volume yet).
func cluster2(t *testing.T) (*testNode, *testNode) {
	t.Helper()
	a := newTestNode(t, "node-a")
	b := newTestNode(t, "node-b")
	if _, err := a.m.CreateCluster("Store"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	token, _, _ := a.m.NewJoinToken(time.Hour)
	if _, err := b.m.JoinCluster(token); err != nil {
		t.Fatalf("JoinCluster: %v", err)
	}
	waitFor(t, "a to lead", 10*time.Second, func() bool { return a.meta.IsLeader() && b.meta.Leader() == "node-a" })
	if _, err := a.svc.AddVolume("disk", "/cluster", "A volume"); err != nil {
		t.Fatalf("AddVolume: %v", err)
	}
	waitFor(t, "b to see the volume", 5*time.Second, func() bool { return len(b.meta.Volumes()) == 1 })
	return a, b
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func sum(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func readAll(t *testing.T, n *testNode, p string) []byte {
	t.Helper()
	r, err := n.svc.OpenRead(p)
	if err != nil {
		t.Fatalf("OpenRead(%s) on %s: %v", p, n.id, err)
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read %s on %s: %v", p, n.id, err)
	}
	return data
}

/*
	Unit tests
*/

func TestRealPathAndVolumes(t *testing.T) {
	a := newTestNode(t, "solo")
	a.m.CreateCluster("Solo")
	if _, err := a.svc.AddVolume("nope", "/x", ""); err == nil {
		t.Errorf("unknown drive accepted")
	}
	if v, err := a.svc.AddVolume("disk", "/../x", "escaped"); err != nil || v.Subpath != "/x" {
		//".." is cleaned away, the folder must land inside the drive
		t.Errorf("cleaned subpath: %+v %v", v, err)
	}
	vol, err := a.svc.AddVolume("disk", "cluster/data", "")
	if err != nil {
		t.Fatalf("AddVolume: %v", err)
	}
	if vol.Subpath != "/cluster/data" || vol.Name == "" {
		t.Errorf("volume normalisation wrong: %+v", vol)
	}
	if _, err := a.svc.AddVolume("disk", "/cluster/data", ""); err == nil {
		t.Errorf("duplicate volume accepted")
	}
	real, err := a.svc.realPath(vol, "/photos/a.jpg")
	if err != nil || real != filepath.Join(a.root, "cluster", "data", "photos", "a.jpg") {
		t.Errorf("realPath = %q, %v", real, err)
	}
	if _, err := a.svc.realPath(vol, "/../../etc/passwd"); err != nil {
		//NormalizePath cleans "..", so this must resolve inside the volume
		t.Errorf("cleaned path should be accepted: %v", err)
	}
	if err := a.svc.RemoveVolume(vol.ID); err != nil {
		t.Fatalf("RemoveVolume: %v", err)
	}
	for _, v := range a.svc.LocalVolumes() {
		if v.ID == vol.ID {
			t.Errorf("removed volume still listed")
		}
	}
}

func TestPickVolumeOrdering(t *testing.T) {
	a := newTestNode(t, "solo")
	a.m.CreateCluster("Solo")
	waitFor(t, "lead", 5*time.Second, func() bool { return a.meta.IsLeader() })
	a.meta.Submit(metadata.KindVolume, &metadata.Volume{ID: "v-small", NodeID: "solo", Free: 200 << 20, Capacity: 1 << 30})
	a.meta.Submit(metadata.KindVolume, &metadata.Volume{ID: "v-big", NodeID: "solo", Free: 10 << 30, Capacity: 20 << 30})
	a.meta.Submit(metadata.KindVolume, &metadata.Volume{ID: "v-ro", NodeID: "solo", Free: 50 << 30, ReadOnly: true})
	a.meta.Submit(metadata.KindVolume, &metadata.Volume{ID: "v-other", NodeID: "ghost", Free: 50 << 30})
	v, err := a.svc.pickVolume(1<<20, "solo", "", nil)
	if err != nil || v.ID != "v-big" {
		t.Errorf("expected v-big (most free, local, writable), got %+v %v", v, err)
	}
	v, _ = a.svc.pickVolume(1<<20, "solo", "v-small", nil)
	if v.ID != "v-small" {
		t.Errorf("preferred volume should win when it fits, got %s", v.ID)
	}
	if v, _ := a.svc.pickVolume(1<<30, "solo", "v-small", nil); v.ID != "v-big" {
		t.Errorf("preferred volume without space must be skipped, got %s", v.ID)
	}
	if _, err := a.svc.pickVolume(100<<30, "solo", "", nil); !errors.Is(err, ErrNoVolume) {
		t.Errorf("oversized request should fail, got %v", err)
	}
	if _, err := a.svc.pickVolume(1<<20, "solo", "", []string{"v-big", "v-small"}); !errors.Is(err, ErrNoVolume) {
		t.Errorf("excluded volumes must not be chosen")
	}
}

/*
	Two-node behaviour
*/

func TestWriteReadLocalAndRemote(t *testing.T) {
	a, b := cluster2(t)
	small := []byte("hello cluster")
	if err := a.svc.Write("cluster:/docs/hello.txt", bytes.NewReader(small), "toby"); err != nil {
		t.Fatalf("write on a: %v", err)
	}
	//Landed on a's volume physically
	if _, err := os.Stat(filepath.Join(a.root, "cluster", "docs", "hello.txt")); err != nil {
		t.Errorf("file not on a's disk: %v", err)
	}
	rec, err := a.meta.Stat("/docs/hello.txt")
	if err != nil || rec.Size != int64(len(small)) || rec.Checksum != sum(small) || rec.Owner != "toby" {
		t.Errorf("record wrong: %+v %v", rec, err)
	}
	if len(rec.HealthyLocations()) != 1 {
		t.Errorf("expected one committed location, got %+v", rec.Locations)
	}
	//Parents were created
	if info, err := a.svc.Stat("/docs"); err != nil || !info.IsDir {
		t.Errorf("parent dir missing: %+v %v", info, err)
	}

	//b (no volume) writes a 10 MiB file: it is uploaded to a in chunks
	big := randomBytes(10<<20 + 12345)
	waitFor(t, "b to see the file", 5*time.Second, func() bool { _, err := b.meta.Stat("/docs/hello.txt"); return err == nil })
	if err := b.svc.Write("/docs/big.bin", bytes.NewReader(big), "toby"); err != nil {
		t.Fatalf("write on b: %v", err)
	}
	onDisk, err := os.ReadFile(filepath.Join(a.root, "cluster", "docs", "big.bin"))
	if err != nil || !bytes.Equal(onDisk, big) {
		t.Fatalf("uploaded file differs or missing: %v", err)
	}
	//Reads from both sides, b's goes through the chunked download
	if got := readAll(t, a, "/docs/big.bin"); !bytes.Equal(got, big) {
		t.Errorf("local read differs")
	}
	if got := readAll(t, b, "/docs/big.bin"); !bytes.Equal(got, big) {
		t.Errorf("remote read differs")
	}
	if got := readAll(t, b, "cluster:/docs/hello.txt"); !bytes.Equal(got, small) {
		t.Errorf("small remote read differs")
	}

	//Listing
	kids, err := b.svc.List("/docs")
	if err != nil || len(kids) != 2 {
		t.Errorf("List(/docs) on b = %+v %v", kids, err)
	}

	//Overwrite keeps the ID, replaces content
	if err := b.svc.Write("/docs/hello.txt", bytes.NewReader([]byte("v2")), "toby"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	waitFor(t, "overwrite to reach a", 5*time.Second, func() bool {
		r, err := a.meta.Stat("/docs/hello.txt")
		return err == nil && r.Checksum == sum([]byte("v2"))
	})
	rec2, _ := a.meta.Stat("/docs/hello.txt")
	if rec2.ID != rec.ID || string(readAll(t, a, "/docs/hello.txt")) != "v2" {
		t.Errorf("overwrite lost identity or content")
	}

	//Rename a directory moves everything
	if err := b.svc.Rename("/docs", "/archive"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	waitFor(t, "rename to reach a", 5*time.Second, func() bool { _, err := a.meta.Stat("/archive/big.bin"); return err == nil })
	if _, err := os.Stat(filepath.Join(a.root, "cluster", "archive", "big.bin")); err != nil {
		t.Errorf("physical rename missing: %v", err)
	}
	if _, err := a.svc.Stat("/docs/big.bin"); err == nil {
		t.Errorf("old path still resolves")
	}

	//Remove
	if err := b.svc.Remove("/archive", false); err != ErrNotEmpty {
		t.Errorf("non-recursive remove of a full dir should fail, got %v", err)
	}
	if err := b.svc.Remove("/archive", true); err != nil {
		t.Fatalf("remove: %v", err)
	}
	waitFor(t, "removal to reach a", 5*time.Second, func() bool { _, err := a.meta.Stat("/archive/big.bin"); return err != nil })
	if _, err := os.Stat(filepath.Join(a.root, "cluster", "archive", "big.bin")); err == nil {
		t.Errorf("physical file not deleted")
	}
	if _, err := b.svc.OpenRead("/archive/big.bin"); err == nil {
		t.Errorf("removed file readable")
	}
}

func TestTransferProtocolDetails(t *testing.T) {
	a, b := cluster2(t)
	vol := a.svc.LocalVolumes()[0]
	data := randomBytes(9<<20 + 1)
	ctx := context.Background()

	//Resume: begin, send chunk 0 and 2, begin again reports Have
	var begin BeginResponse
	if err := b.svc.client.postJSON(ctx, "node-a", pathBegin, BeginRequest{VolumeID: vol.ID, Path: "/r/resume.bin", Size: int64(len(data)), Checksum: sum(data)}, &begin); err != nil {
		t.Fatalf("begin: %v", err)
	}
	sendChunk := func(index int, chunk []byte, hash string) int {
		resp, err := b.svc.client.doRaw(ctx, "node-a", pathChunk+"?session="+begin.SessionID+"&index="+itoa(index), chunk, map[string][]string{HeaderChunkSha: {hash}})
		if err != nil {
			t.Fatalf("chunk %d: %v", index, err)
		}
		return resp.Status
	}
	if st := sendChunk(0, data[:ChunkSize], sum(data[:ChunkSize])); st != 200 {
		t.Fatalf("chunk 0 status %d", st)
	}
	if st := sendChunk(2, data[2*ChunkSize:], sum(data[2*ChunkSize:])); st != 200 {
		t.Fatalf("chunk 2 status %d", st)
	}
	if st := sendChunk(1, data[ChunkSize:2*ChunkSize], "deadbeef"); st != 409 {
		t.Errorf("corrupt chunk should be 409, got %d", st)
	}
	if st := sendChunk(7, data[:10], sum(data[:10])); st != 400 {
		t.Errorf("out of range chunk should be 400, got %d", st)
	}
	var again BeginResponse
	b.svc.client.postJSON(ctx, "node-a", pathBegin, BeginRequest{VolumeID: vol.ID, Path: "/r/resume.bin", Size: int64(len(data)), Checksum: sum(data)}, &again)
	if again.SessionID != begin.SessionID || len(again.Have) != 2 {
		t.Errorf("resume did not report existing chunks: %+v", again)
	}
	//Commit before completion is refused
	if err := b.svc.client.postJSON(ctx, "node-a", pathCommit, SessionRequest{SessionID: begin.SessionID}, nil); err == nil {
		t.Errorf("incomplete commit accepted")
	}
	//Full upload through the client resumes and completes
	if err := b.svc.client.Upload(ctx, "node-a", vol.ID, "/r/resume.bin", "fid", bytes.NewReader(data), int64(len(data)), sum(data), nil); err != nil {
		t.Fatalf("Upload: %v", err)
	}
	onDisk, _ := os.ReadFile(filepath.Join(a.root, "cluster", "r", "resume.bin"))
	if !bytes.Equal(onDisk, data) {
		t.Errorf("uploaded content differs")
	}
	if _, err := os.Stat(filepath.Join(a.root, "cluster", "r", "resume.bin.part-"+begin.SessionID)); err == nil {
		t.Errorf("part file left behind")
	}

	//Wrong whole-file checksum: nothing left behind
	if err := b.svc.client.Upload(ctx, "node-a", vol.ID, "/r/bad.bin", "fid2", bytes.NewReader(data[:100]), 100, sum([]byte("x")), nil); err == nil {
		t.Errorf("bad checksum upload accepted")
	}
	if _, err := os.Stat(filepath.Join(a.root, "cluster", "r", "bad.bin")); err == nil {
		t.Errorf("file with bad checksum left behind")
	}

	//Download verifies chunks and the whole file
	var buf bytes.Buffer
	if err := b.svc.client.Download(ctx, "node-a", vol.ID, "/r/resume.bin", &buf, sum(data), nil); err != nil || !bytes.Equal(buf.Bytes(), data) {
		t.Errorf("Download: %v", err)
	}
	if err := b.svc.client.Download(ctx, "node-a", vol.ID, "/r/resume.bin", io.Discard, sum([]byte("other")), nil); err != ErrChecksum {
		t.Errorf("expected ErrChecksum, got %v", err)
	}

	//Helpers
	st, err := b.svc.client.Stat(ctx, "node-a", vol.ID, "/r/resume.bin")
	if err != nil || !st.Exists || st.Size != int64(len(data)) {
		t.Errorf("Stat: %+v %v", st, err)
	}
	cs, err := b.svc.client.Checksum(ctx, "node-a", vol.ID, "/r/resume.bin")
	if err != nil || cs.Checksum != sum(data) {
		t.Errorf("Checksum: %+v %v", cs, err)
	}
	if err := b.svc.client.Rename(ctx, "node-a", vol.ID, "/r/resume.bin", "/r/moved.bin"); err != nil {
		t.Errorf("Rename: %v", err)
	}
	list, err := b.svc.client.List(ctx, "node-a", vol.ID, "/r")
	if err != nil || len(list) != 1 || list[0].Name != "moved.bin" {
		t.Errorf("List: %+v %v", list, err)
	}
	if err := b.svc.client.Delete(ctx, "node-a", vol.ID, "/r/moved.bin", false); err != nil {
		t.Errorf("Delete: %v", err)
	}
	//Escape and non-local volume are refused
	if _, err := b.svc.client.Stat(ctx, "node-a", "no-such-volume", "/x"); err == nil {
		t.Errorf("unknown volume accepted")
	}
}

func TestReconcileAdoptsAndFlagsStale(t *testing.T) {
	a, b := cluster2(t)
	//A file dropped into the contributed folder outside ArozOS
	pre := filepath.Join(a.root, "cluster", "music", "song.mp3")
	os.MkdirAll(filepath.Dir(pre), 0755)
	os.WriteFile(pre, []byte("pre-existing"), 0644)
	res := a.svc.ReconcileAll()
	if len(res) != 1 || res[0].Adopted != 1 {
		t.Fatalf("reconcile result: %+v", res)
	}
	waitFor(t, "b to see the adopted file", 5*time.Second, func() bool { _, err := b.meta.Stat("/music/song.mp3"); return err == nil })
	if got := readAll(t, b, "/music/song.mp3"); string(got) != "pre-existing" {
		t.Errorf("adopted file unreadable from b")
	}

	//Delete the file behind the cluster's back: the copy becomes stale
	os.Remove(pre)
	res = a.svc.ReconcileAll()
	if res[0].Stale != 1 {
		t.Errorf("missing file should be flagged stale: %+v", res)
	}
	rec, _ := a.meta.Stat("/music/song.mp3")
	if len(rec.HealthyLocations()) != 0 {
		t.Errorf("location still healthy after file vanished")
	}
	waitFor(t, "b to learn the copy is stale", 5*time.Second, func() bool {
		r, err := b.meta.Stat("/music/song.mp3")
		return err == nil && len(r.HealthyLocations()) == 0
	})
	if _, err := b.svc.OpenRead("/music/song.mp3"); err != ErrNoHealthyCopy {
		t.Errorf("expected ErrNoHealthyCopy, got %v", err)
	}
}

func TestReadFailsWhenOnlyCopyIsOffline(t *testing.T) {
	a, b := cluster2(t)
	if err := a.svc.Write("/x.txt", bytes.NewReader([]byte("x")), ""); err != nil {
		t.Fatalf("write: %v", err)
	}
	waitFor(t, "b to see the file", 5*time.Second, func() bool { _, err := b.meta.Stat("/x.txt"); return err == nil })
	a.svc.Close()
	a.meta.Close()
	a.m.Close()
	a.srv.Close()
	waitFor(t, "b to see a offline", 10*time.Second, func() bool {
		for _, n := range b.m.NodeViews() {
			if n.ID == "node-a" {
				return n.State != membership.StateOnline
			}
		}
		return false
	})
	if _, err := b.svc.OpenRead("/x.txt"); err != ErrNoHealthyCopy {
		t.Errorf("expected ErrNoHealthyCopy while a is down, got %v", err)
	}
	if err := b.svc.Write("/y.txt", bytes.NewReader([]byte("y")), ""); !errors.Is(err, ErrNoVolume) {
		t.Errorf("write with no usable volume should fail with ErrNoVolume, got %v", err)
	}
}

func TestSpaceStateHysteresis(t *testing.T) {
	const total = 1000
	tests := []struct {
		name          string
		free          int64
		total         int64
		wasFull       bool
		wantFull      bool
		wantRecovered bool
	}{
		{"plenty of room", 500, total, false, false, false},
		{"just above the limit", 60, total, false, false, false},
		{"below the limit stops writes", 40, total, false, true, false},
		{"still full between the marks", 60, total, true, true, false},
		{"above the recover mark starts again", 80, total, true, true, true},
		{"unknown capacity is never full", 0, 0, false, false, false},
		{"no free space at all", 0, total, false, true, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			full, recovered := spaceState(tc.free, tc.total, tc.wasFull)
			if full != tc.wantFull || recovered != tc.wantRecovered {
				t.Errorf("spaceState(%d, %d, %v) = %v, %v; want %v, %v",
					tc.free, tc.total, tc.wasFull, full, recovered, tc.wantFull, tc.wantRecovered)
			}
		})
	}
}

func TestLowSpaceAction(t *testing.T) {
	const total = 1000
	tests := []struct {
		name      string
		free      int64
		wasFull   bool
		auto      bool
		wantMark  bool
		wantClear bool
	}{
		{"guard on, plenty of room", 500, false, true, false, false},
		{"guard on, nearly full is marked", 40, false, true, true, false},
		{"guard on, already marked stays", 60, true, true, false, false},
		{"guard on, recovered is released", 80, true, true, false, true},
		{"guard off, nearly full is left alone", 40, false, false, false, false},
		{"guard off, earlier mark is released", 40, true, false, false, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mark, clear := lowSpaceAction(tc.free, total, tc.wasFull, tc.auto)
			if mark != tc.wantMark || clear != tc.wantClear {
				t.Errorf("lowSpaceAction(%d, %d, %v, %v) = %v, %v; want %v, %v",
					tc.free, total, tc.wasFull, tc.auto, mark, clear, tc.wantMark, tc.wantClear)
			}
		})
	}
}

func TestAutoReadOnlySetting(t *testing.T) {
	a := newTestNode(t, "solo")
	a.m.CreateCluster("Solo")
	waitFor(t, "lead", 5*time.Second, func() bool { return a.meta.IsLeader() })
	if !a.svc.AutoReadOnly() {
		t.Fatalf("the guard must be on by default")
	}
	if err := a.svc.SetAutoReadOnly(false); err != nil {
		t.Fatalf("SetAutoReadOnly(false): %v", err)
	}
	if a.svc.AutoReadOnly() {
		t.Errorf("the guard should be off")
	}
	if a.svc.Status().AutoReadOnly != a.svc.AutoReadOnly() {
		t.Errorf("status must report the setting")
	}
	if err := a.svc.SetAutoReadOnly(true); err != nil {
		t.Fatalf("SetAutoReadOnly(true): %v", err)
	}
	if !a.svc.AutoReadOnly() {
		t.Errorf("the guard should be back on")
	}
}
