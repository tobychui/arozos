package webdav

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// newTestServer builds a Server with nil userHandler – sufficient for testing
// the in-memory sync.Map and helper logic that does not call userHandler.
func newTestServer() *Server {
	return &Server{
		hostname:                  "testhost",
		userHandler:               nil,
		filesystems:               sync.Map{},
		prefix:                    "/webdav",
		tlsMode:                   false,
		Enabled:                   true,
		windowsClientNotLoggedIn:  sync.Map{},
		windowsClientLoggedIn:     sync.Map{},
		readOnlyFileSystemHandler: nil,
	}
}

func TestServerFields(t *testing.T) {
	s := newTestServer()
	if s.hostname != "testhost" {
		t.Errorf("expected hostname='testhost', got %q", s.hostname)
	}
	if !s.Enabled {
		t.Error("expected Enabled=true")
	}
	if s.prefix != "/webdav" {
		t.Errorf("expected prefix='/webdav', got %q", s.prefix)
	}
}

func TestHandleRequest_Disabled(t *testing.T) {
	s := newTestServer()
	s.Enabled = false

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/somefile", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("disabled server: expected 404, got %d", w.Code)
	}
}

func TestHandleRequest_RootPath(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/webdav", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("root-only path: expected 404, got %d", w.Code)
	}
}

func TestHandleClearAllPending(t *testing.T) {
	s := newTestServer()
	// Populate the pending map
	s.windowsClientNotLoggedIn.Store("uuid-1", &WindowClientInfo{UUID: "uuid-1"})
	s.windowsClientNotLoggedIn.Store("uuid-2", &WindowClientInfo{UUID: "uuid-2"})

	req := httptest.NewRequest(http.MethodPost, "/webdav/clear", nil)
	w := httptest.NewRecorder()
	s.HandleClearAllPending(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", w.Code)
	}

	// All pending entries should be cleared
	count := 0
	s.windowsClientNotLoggedIn.Range(func(_, _ interface{}) bool { count++; return true })
	if count != 0 {
		t.Errorf("expected empty windowsClientNotLoggedIn after clear, got %d entries", count)
	}
}

func TestWindowClientInfo(t *testing.T) {
	wci := &WindowClientInfo{
		Agent:                   "TestAgent",
		LastConnectionTimestamp: time.Now().Unix(),
		UUID:                    "test-uuid",
		Username:                "testuser",
		ClientIP:                "127.0.0.1",
	}
	if wci.UUID != "test-uuid" {
		t.Errorf("expected UUID='test-uuid', got %q", wci.UUID)
	}
	if wci.Username != "testuser" {
		t.Errorf("expected Username='testuser', got %q", wci.Username)
	}
}

// --- common.go helpers ---

func TestStringInSlice(t *testing.T) {
	if !stringInSlice("b", []string{"a", "b", "c"}) {
		t.Error("expected true for existing element")
	}
	if stringInSlice("z", []string{"a", "b", "c"}) {
		t.Error("expected false for missing element")
	}
}

func TestInArray(t *testing.T) {
	if !inArray([]string{"x", "y"}, "x") {
		t.Error("expected true for 'x'")
	}
	if inArray([]string{"x", "y"}, "z") {
		t.Error("expected false for 'z'")
	}
}

func TestPushToSliceIfNotExist(t *testing.T) {
	s := []string{"a", "b"}
	s = pushToSliceIfNotExist(s, "c")
	if len(s) != 3 {
		t.Errorf("expected length 3, got %d", len(s))
	}
	// Pushing duplicate should be no-op
	s = pushToSliceIfNotExist(s, "c")
	if len(s) != 3 {
		t.Errorf("expected length 3 after duplicate push, got %d", len(s))
	}
}

func TestRemoveFromSliceIfExists(t *testing.T) {
	s := []string{"a", "b", "c"}
	s = removeFromSliceIfExists(s, "b")
	if len(s) != 2 {
		t.Errorf("expected length 2 after remove, got %d", len(s))
	}
	for _, v := range s {
		if v == "b" {
			t.Error("'b' should have been removed")
		}
	}
}

func TestTimeToString(t *testing.T) {
	// Just verify it doesn't panic and produces a non-empty string
	result := timeToString(time.Now())
	if result == "" {
		t.Error("timeToString returned empty string")
	}
}

func TestFileExists(t *testing.T) {
	// A known path that exists
	if !fileExists("/") {
		t.Error("expected '/' to exist")
	}
	if fileExists("/this/path/does/not/exist/12345") {
		t.Error("expected false for non-existent path")
	}
}

func TestIsDir(t *testing.T) {
	if !isDir("/") {
		t.Error("expected '/' to be a directory")
	}
	if isDir("/this/path/does/not/exist") {
		t.Error("expected false for non-existent path")
	}
}

func TestMv_GetMode(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/?foo=bar", nil)
	val, err := mv(req, "foo", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "bar" {
		t.Errorf("expected 'bar', got %q", val)
	}
}

func TestMv_MissingKey(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	_, err := mv(req, "missing", false)
	if err == nil {
		t.Error("expected error for missing GET parameter")
	}
}
