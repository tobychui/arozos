package webdav

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
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

type quotaRig struct {
	server    *Server
	handler   http.Handler
	quota     *fakeQuota
	userDir   string
	publicDir string
}

// newQuotaRig serves "user", which counts against a quota of 100 bytes with 40
// used by old.bin, and "public", which does not count and holds big.bin (200
// bytes) and small.bin (10 bytes).
func newQuotaRig(t *testing.T) *quotaRig {
	t.Helper()
	userFsh, userDir := newLocalTestFsh(t, "user")
	userFsh.Hierarchy = "user"
	publicFsh, publicDir := newLocalTestFsh(t, "public")
	for path, size := range map[string]int{
		filepath.Join(userDir, "old.bin"):     40,
		filepath.Join(publicDir, "big.bin"):   200,
		filepath.Join(publicDir, "small.bin"): 10,
	} {
		if err := os.WriteFile(path, []byte(strings.Repeat("o", size)), 0644); err != nil {
			t.Fatalf("WriteFile() = %v", err)
		}
	}
	s := newTestServer()
	s.recountDelay = time.Millisecond
	q := &fakeQuota{total: 100, used: 40}
	return &quotaRig{
		server:    s,
		handler:   s.getRootFs([]*filesystem.FileSystemHandler{userFsh, publicFsh}, "alice", allowAllWrites, q),
		quota:     q,
		userDir:   userDir,
		publicDir: publicDir,
	}
}

// sizes lists the files of a folder with their sizes
func sizes(t *testing.T, dir string) map[string]int64 {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir() = %v", err)
	}
	result := map[string]int64{}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			t.Fatalf("Info() = %v", err)
		}
		result[e.Name()] = info.Size()
	}
	return result
}

func TestQuotaOnRequests(t *testing.T) {
	body := func(n int) string { return strings.Repeat("n", n) }
	untouched := map[string]int64{"old.bin": 40}

	tests := []struct {
		name     string
		method   string
		target   string
		body     string
		headers  map[string]string
		chunked  bool //The upload does not announce its length
		refused  bool
		wantUser map[string]int64
		wantUsed int64
	}{
		{name: "upload that fits", method: "PUT", target: "/webdav/user/new.bin", body: body(50),
			wantUser: map[string]int64{"old.bin": 40, "new.bin": 50}, wantUsed: 90},
		{name: "upload too big", method: "PUT", target: "/webdav/user/new.bin", body: body(80),
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "overwrite that fits", method: "PUT", target: "/webdav/user/old.bin", body: body(90),
			wantUser: map[string]int64{"old.bin": 90}, wantUsed: 90},
		{name: "overwrite too big keeps the old file", method: "PUT", target: "/webdav/user/old.bin", body: body(150),
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "upload to a drive that does not count", method: "PUT", target: "/webdav/public/new.bin", body: body(500),
			wantUser: untouched, wantUsed: 40},
		{name: "chunked upload that fits", method: "PUT", target: "/webdav/user/new.bin", body: body(50), chunked: true,
			wantUser: map[string]int64{"old.bin": 40, "new.bin": 50}, wantUsed: 90},
		{name: "chunked upload too big leaves nothing", method: "PUT", target: "/webdav/user/new.bin", body: body(80), chunked: true,
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "Finder announces the length", method: "PUT", target: "/webdav/user/old.bin", body: body(150), chunked: true,
			headers: map[string]string{"X-Expected-Entity-Length": "150"},
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "copy that fits", method: "COPY", target: "/webdav/user/old.bin",
			headers:  map[string]string{"Destination": "/webdav/user/copy.bin"},
			wantUser: map[string]int64{"old.bin": 40, "copy.bin": 40}, wantUsed: 80},
		{name: "copy too big", method: "COPY", target: "/webdav/public/big.bin",
			headers: map[string]string{"Destination": "/webdav/user/big.bin"},
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "copy over a file keeps it", method: "COPY", target: "/webdav/public/big.bin",
			headers: map[string]string{"Destination": "/webdav/user/old.bin"},
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "copy out of the drive", method: "COPY", target: "/webdav/user/old.bin",
			headers:  map[string]string{"Destination": "/webdav/public/old.bin"},
			wantUser: untouched, wantUsed: 40},
		{name: "move in that fits", method: "MOVE", target: "/webdav/public/small.bin",
			headers:  map[string]string{"Destination": "/webdav/user/small.bin"},
			wantUser: map[string]int64{"old.bin": 40, "small.bin": 10}, wantUsed: 50},
		{name: "move in too big", method: "MOVE", target: "/webdav/public/big.bin",
			headers: map[string]string{"Destination": "/webdav/user/big.bin"},
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "move over a file keeps it", method: "MOVE", target: "/webdav/public/big.bin",
			headers: map[string]string{"Destination": "/webdav/user/old.bin", "Overwrite": "T"},
			refused: true, wantUser: untouched, wantUsed: 40},
		{name: "move out gives space back", method: "MOVE", target: "/webdav/user/old.bin",
			headers:  map[string]string{"Destination": "/webdav/public/old.bin"},
			wantUser: map[string]int64{}, wantUsed: 0},
		{name: "rename", method: "MOVE", target: "/webdav/user/old.bin",
			headers:  map[string]string{"Destination": "/webdav/user/renamed.bin"},
			wantUser: map[string]int64{"renamed.bin": 40}, wantUsed: 40},
		{name: "delete gives space back", method: "DELETE", target: "/webdav/user/old.bin",
			wantUser: map[string]int64{}, wantUsed: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rig := newQuotaRig(t)
			var content io.Reader = strings.NewReader(tt.body)
			if tt.chunked {
				content = struct{ io.Reader }{content}
			}
			req := httptest.NewRequest(tt.method, tt.target, content)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			rig.handler.ServeHTTP(w, req)

			if tt.refused && w.Code != http.StatusInsufficientStorage {
				t.Errorf("status = %d, want %d", w.Code, http.StatusInsufficientStorage)
			}
			if !tt.refused && (w.Code < 200 || w.Code >= 300) {
				t.Errorf("status = %d %q, want success", w.Code, w.Body.String())
			}
			got := sizes(t, rig.userDir)
			if len(got) != len(tt.wantUser) {
				t.Errorf("user drive = %v, want %v", got, tt.wantUser)
			}
			for name, size := range tt.wantUser {
				if got[name] != size {
					t.Errorf("user drive = %v, want %v", got, tt.wantUser)
				}
			}
			if used, _ := rig.quota.state(); used != tt.wantUsed {
				t.Errorf("used = %d, want %d", used, tt.wantUsed)
			}
		})
	}
}

func TestUsageIsRecalculatedAfterChanges(t *testing.T) {
	tests := []struct {
		name   string
		method string
		want   bool
	}{
		{name: "upload", method: http.MethodPut, want: true},
		{name: "delete", method: http.MethodDelete, want: true},
		{name: "download", method: http.MethodGet},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rig := newQuotaRig(t)
			serveTestRequest(rig.handler, tt.method, "/webdav/user/old.bin", "new", nil)

			deadline := time.Now().Add(2 * time.Second)
			if !tt.want {
				deadline = time.Now().Add(100 * time.Millisecond)
			}
			recounted := 0
			for recounted == 0 && time.Now().Before(deadline) {
				time.Sleep(5 * time.Millisecond)
				_, recounted = rig.quota.state()
			}
			if (recounted > 0) != tt.want {
				t.Fatalf("recalculated %d times, want one: %v", recounted, tt.want)
			}
		})
	}
}

// A folder upload is many requests; the usage is recalculated once they stop
func TestRecountWaitsForAPause(t *testing.T) {
	s := newTestServer()
	s.recountDelay = 100 * time.Millisecond
	q := &fakeQuota{}
	for range 5 {
		s.scheduleRecount("alice", q)
	}
	time.Sleep(500 * time.Millisecond)
	if _, recounted := q.state(); recounted != 1 {
		t.Fatalf("recalculated %d times, want 1", recounted)
	}
}
