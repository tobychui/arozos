package dpcore

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestNewDynamicProxyCore(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix")
	rp := NewDynamicProxyCore(target, "")
	if rp == nil {
		t.Fatal("Expected non-nil ReverseProxy")
	}
	if rp.Director == nil {
		t.Error("Expected non-nil Director function")
	}
}

func TestNewDynamicProxyCore_WithPrepender(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "/prefix")
	if rp == nil {
		t.Fatal("Expected non-nil ReverseProxy")
	}
	if rp.Prepender != "/prefix" {
		t.Errorf("Expected Prepender /prefix, got %q", rp.Prepender)
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
	}
	for _, tt := range tests {
		result := singleJoiningSlash(tt.a, tt.b)
		if result != tt.expected {
			t.Errorf("singleJoiningSlash(%q, %q) = %q, want %q", tt.a, tt.b, result, tt.expected)
		}
	}
}

func TestProxyHTTP_Basic(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("dpcore backend response"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")

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
	if !strings.Contains(body, "dpcore backend response") {
		t.Errorf("Expected backend response, got %q", body)
	}
}

func TestServeHTTP_GET(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ServeHTTP(w, req)
	if err != nil {
		t.Fatalf("ServeHTTP() unexpected error: %v", err)
	}
}
