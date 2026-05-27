package reverseproxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestNewReverseProxy(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix")
	rp := NewReverseProxy(target)
	if rp == nil {
		t.Fatal("Expected non-nil ReverseProxy")
	}
	if rp.Director == nil {
		t.Error("Expected non-nil Director function")
	}
}

func TestSingleJoiningSlash(t *testing.T) {
	tests := []struct {
		a, b, expected string
	}{
		{"/a/", "/b", "/a/b"},
		{"/a", "/b", "/a/b"},
		{"/a/", "b", "/a/b"},
		{"/a", "b", "/a/b"},
		{"", "/b", "/b"},
		{"", "b", "/b"},
	}
	for _, tt := range tests {
		result := singleJoiningSlash(tt.a, tt.b)
		if result != tt.expected {
			t.Errorf("singleJoiningSlash(%q, %q) = %q, want %q", tt.a, tt.b, result, tt.expected)
		}
	}
}

func TestProxyHTTP(t *testing.T) {
	// Create a backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend", "true")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)

	// Create a test request
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP() unexpected error: %v", err)
	}

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, "backend response") {
		t.Errorf("Expected backend response, got %q", body)
	}
}

func TestProxyHTTP_BackendError(t *testing.T) {
	// Use an invalid URL to simulate backend error
	badURL, _ := url.Parse("http://127.0.0.1:1") // unlikely to have anything listening
	rp := NewReverseProxy(badURL)

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err == nil {
		t.Log("Expected error connecting to dead backend, but connection succeeded (port may be in use)")
	} else {
		if w.Code != http.StatusBadGateway {
			t.Errorf("Expected StatusBadGateway on error, got %d", w.Code)
		}
	}
}

func TestServeHTTP_GET(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ServeHTTP(w, req)
	if err != nil {
		t.Fatalf("ServeHTTP() unexpected error: %v", err)
	}
}

func TestDirector_QueryStringMerge(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix?a=1")
	rp := NewReverseProxy(target)

	req, _ := http.NewRequest("GET", "http://original.com/path?b=2", nil)
	rp.Director(req)

	if !strings.Contains(req.URL.RawQuery, "a=1") {
		t.Error("Expected target query string to be preserved")
	}
	if !strings.Contains(req.URL.RawQuery, "b=2") {
		t.Error("Expected request query string to be merged")
	}
}

func TestDirector_EmptyTargetQuery(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix")
	rp := NewReverseProxy(target)

	req, _ := http.NewRequest("GET", "http://original.com/path?b=2", nil)
	rp.Director(req)

	if req.URL.RawQuery != "b=2" {
		t.Errorf("Expected query %q, got %q", "b=2", req.URL.RawQuery)
	}
}

func TestDirector_UserAgent(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewReverseProxy(target)

	// Request without User-Agent
	req, _ := http.NewRequest("GET", "http://original.com/", nil)
	rp.Director(req)

	ua := req.Header.Get("User-Agent")
	if ua != "" {
		t.Errorf("Expected empty User-Agent when not set, got %q", ua)
	}

	// Request with existing User-Agent should be preserved
	req2, _ := http.NewRequest("GET", "http://original.com/", nil)
	req2.Header.Set("User-Agent", "TestAgent/1.0")
	rp.Director(req2)
	if req2.Header.Get("User-Agent") != "TestAgent/1.0" {
		t.Error("Expected User-Agent to be preserved when already set")
	}
}
