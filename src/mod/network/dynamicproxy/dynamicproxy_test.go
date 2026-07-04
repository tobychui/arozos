package dynamicproxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewDynamicProxy(t *testing.T) {
	router, err := NewDynamicProxy(0) // port 0 to let OS assign
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}
	if router == nil {
		t.Fatal("Expected non-nil Router")
	}
	if router.ProxyEndpoints == nil {
		t.Error("Expected non-nil ProxyEndpoints")
	}
	if router.SubdomainEndpoint == nil {
		t.Error("Expected non-nil SubdomainEndpoint")
	}
}

func TestAddProxyService(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}

	// Add a proxy endpoint
	err = router.AddProxyService("/api", "http://localhost:8080", false)
	if err != nil {
		t.Fatalf("AddProxyService() unexpected error: %v", err)
	}

	// Add with TLS enabled
	err = router.AddProxyService("/secure", "localhost:9090", true)
	if err != nil {
		t.Fatalf("AddProxyService() with TLS unexpected error: %v", err)
	}
}

func TestSetRootProxy(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}

	err = router.SetRootProxy("http://localhost:8080", false)
	if err != nil {
		t.Fatalf("SetRootProxy() unexpected error: %v", err)
	}

	// Verify root was set
	if router.Root == nil {
		t.Error("Expected Root to be set")
	}
}

func TestStartStopProxy(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}
	router.SetRootProxy("http://localhost:8080", false)

	// Test that stopping before starting returns an error or is a no-op
	err = router.StopProxyService()
	if err != nil {
		// Acceptable to get an error when not running
		t.Logf("StopProxyService() returned error when not running (expected): %v", err)
	}
}

func TestStopProxyService_NotRunning(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.StopProxyService()
	if err == nil {
		t.Error("Expected error when stopping a proxy that was never started")
	}
}

func TestStartProxyService_NoRoot(t *testing.T) {
	router, _ := NewDynamicProxy(19876)
	// Root is not set, so StartProxyService should fail
	err := router.StartProxyService()
	if err == nil {
		t.Error("Expected error when starting proxy without root set")
	}
}

func TestStartProxyService_AlreadyRunning(t *testing.T) {
	// Inject a fake server to simulate already-running without actually binding a port
	router, _ := NewDynamicProxy(0)
	router.SetRootProxy("localhost:8080", false)
	// Simulate the server already set
	router.server = &http.Server{}

	err := router.StartProxyService()
	if err == nil {
		t.Error("Expected error when starting an already running proxy")
	}
	// Clean up
	router.server = nil
}

func TestAddProxyService_TrailingSlash(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.AddProxyService("/app", "localhost:9090/", false)
	if err != nil {
		t.Fatalf("AddProxyService() unexpected error: %v", err)
	}

	var found *ProxyEndpoint
	router.ProxyEndpoints.Range(func(k, v interface{}) bool {
		found = v.(*ProxyEndpoint)
		return false
	})
	if found == nil {
		t.Fatal("Expected endpoint to be stored")
	}
	// trailing slash should be stripped
	if found.Domain[len(found.Domain)-1:] == "/" {
		t.Error("Expected trailing slash to be stripped from domain")
	}
}

func TestSetRootProxy_TrailingSlash(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.SetRootProxy("localhost:9090/", false)
	if err != nil {
		t.Fatalf("SetRootProxy() unexpected error: %v", err)
	}
	if router.Root == nil {
		t.Fatal("Expected root to be set")
	}
	if router.Root.Domain[len(router.Root.Domain)-1:] == "/" {
		t.Error("Expected trailing slash to be stripped from root domain")
	}
}

func TestSetRootProxy_RequireTLS(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.SetRootProxy("localhost:9090", true)
	if err != nil {
		t.Fatalf("SetRootProxy() with TLS unexpected error: %v", err)
	}
	if router.Root == nil {
		t.Fatal("Expected root to be set")
	}
	if !router.Root.RequireTLS {
		t.Error("Expected RequireTLS to be true")
	}
}

func TestAddSubdomainRoutingService(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.AddSubdomainRoutingService("api.example.com", "localhost:8080", false)
	if err != nil {
		t.Fatalf("AddSubdomainRoutingService() unexpected error: %v", err)
	}

	val, ok := router.SubdomainEndpoint.Load("api.example.com")
	if !ok {
		t.Fatal("Expected subdomain endpoint to be stored")
	}
	ep := val.(*SubdomainEndpoint)
	if ep.MatchingDomain != "api.example.com" {
		t.Errorf("Expected MatchingDomain='api.example.com', got %q", ep.MatchingDomain)
	}
}

func TestAddSubdomainRoutingService_TLS(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.AddSubdomainRoutingService("secure.example.com", "localhost:8443", true)
	if err != nil {
		t.Fatalf("AddSubdomainRoutingService() with TLS unexpected error: %v", err)
	}
	val, ok := router.SubdomainEndpoint.Load("secure.example.com")
	if !ok {
		t.Fatal("Expected subdomain endpoint to be stored")
	}
	ep := val.(*SubdomainEndpoint)
	if !ep.RequireTLS {
		t.Error("Expected RequireTLS=true")
	}
}

func TestAddSubdomainRoutingService_TrailingSlash(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	err := router.AddSubdomainRoutingService("api.example.com", "localhost:8080/", false)
	if err != nil {
		t.Fatalf("AddSubdomainRoutingService() unexpected error: %v", err)
	}
	val, _ := router.SubdomainEndpoint.Load("api.example.com")
	ep := val.(*SubdomainEndpoint)
	if ep.Domain[len(ep.Domain)-1:] == "/" {
		t.Error("Expected trailing slash to be stripped from domain")
	}
}

func TestGetTargetProxyEndpointFromRequestURI(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddProxyService("/api", "localhost:8080", false)

	ep := router.getTargetProxyEndpointFromRequestURI("/api/v1/resource")
	if ep == nil {
		t.Fatal("Expected to find endpoint for /api prefix")
	}
	if ep.Root != "/api" {
		t.Errorf("Expected root '/api', got %q", ep.Root)
	}
}

func TestGetTargetProxyEndpointFromRequestURI_NotFound(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddProxyService("/api", "localhost:8080", false)

	ep := router.getTargetProxyEndpointFromRequestURI("/other/path")
	if ep != nil {
		t.Error("Expected nil for unmatched path")
	}
}

func TestGetSubdomainProxyEndpointFromHostname(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddSubdomainRoutingService("api.example.com", "localhost:8080", false)

	ep := router.getSubdomainProxyEndpointFromHostname("api.example.com")
	if ep == nil {
		t.Fatal("Expected to find subdomain endpoint")
	}
	if ep.MatchingDomain != "api.example.com" {
		t.Errorf("Expected 'api.example.com', got %q", ep.MatchingDomain)
	}
}

func TestGetSubdomainProxyEndpointFromHostname_NotFound(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	ep := router.getSubdomainProxyEndpointFromHostname("notfound.example.com")
	if ep != nil {
		t.Error("Expected nil for unknown hostname")
	}
}

func TestRewriteURL(t *testing.T) {
	router, _ := NewDynamicProxy(0)

	tests := []struct {
		rooturl    string
		requestURL string
		expected   string
	}{
		{"/api", "/api/v1/resource", "/v1/resource"},
		{"/app", "/app", ""},
		{"/app", "/app/", "/"},
	}

	for _, tt := range tests {
		result := router.rewriteURL(tt.rooturl, tt.requestURL)
		if result != tt.expected {
			t.Errorf("rewriteURL(%q, %q) = %q, want %q", tt.rooturl, tt.requestURL, result, tt.expected)
		}
	}
}

// TestServeHTTP_ProxyHandler tests the main HTTP handler routing.
func TestServeHTTP_ProxyHandler_RootFallback(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("root backend"))
	}))
	defer backend.Close()

	router, _ := NewDynamicProxy(0)
	router.SetRootProxy(backend.URL[len("http://"):], false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/some/path", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestServeHTTP_ProxyHandler_MatchedEndpoint(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("api backend"))
	}))
	defer backend.Close()

	router, _ := NewDynamicProxy(0)
	router.AddProxyService("/api", backend.URL[len("http://"):], false)
	// also set a root so ServeHTTP does not panic
	router.SetRootProxy(backend.URL[len("http://"):], false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/api/resource", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestServeHTTP_ProxyHandler_Subdomain(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("subdomain backend"))
	}))
	defer backend.Close()

	router, _ := NewDynamicProxy(0)
	backendHost := backend.URL[len("http://"):]
	router.AddSubdomainRoutingService("api.example.com", backendHost, false)
	// root needed for safety
	router.SetRootProxy(backendHost, false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "api.example.com"
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

// TestStartStopProxyService_Cycle tests full start/stop lifecycle.
func TestStartStopProxyService_Cycle(t *testing.T) {
	// Find a free port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	router, err := NewDynamicProxy(port)
	if err != nil {
		t.Fatalf("NewDynamicProxy: %v", err)
	}
	router.SetRootProxy(backend.URL[len("http://"):], false)

	if err := router.StartProxyService(); err != nil {
		t.Fatalf("StartProxyService: %v", err)
	}
	if !router.Running {
		t.Error("Expected Running=true after start")
	}

	// Give it a moment to bind
	time.Sleep(20 * time.Millisecond)

	if err := router.StopProxyService(); err != nil {
		t.Fatalf("StopProxyService: %v", err)
	}
	if router.Running {
		t.Error("Expected Running=false after stop")
	}
	if router.server != nil {
		t.Error("Expected server=nil after stop")
	}
}

// TestStartProxyService_SetsRunning verifies the Running flag is set.
func TestStartProxyService_SetsRunning(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer backend.Close()

	router, _ := NewDynamicProxy(port)
	router.SetRootProxy(backend.URL[len("http://"):], false)

	if err := router.StartProxyService(); err != nil {
		t.Fatalf("StartProxyService: %v", err)
	}
	if !router.Running {
		t.Error("Expected Running=true")
	}
	// clean up – wait a tick so the goroutine in StartProxyService has fully started
	time.Sleep(20 * time.Millisecond)
	router.StopProxyService()
	// wait for background goroutine to notice server closed
	time.Sleep(20 * time.Millisecond)
}

// TestProxyRequest_WebSocket exercises the WebSocket upgrade path in proxyRequest.
func TestProxyRequest_WebSocket(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	backendHost := backend.URL[len("http://"):]

	router, _ := NewDynamicProxy(0)
	router.AddProxyService("/ws", backendHost, false)
	router.SetRootProxy(backendHost, false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/ws/chat", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	// Set WebSocket upgrade headers to trigger the WebSocket path
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	// The WebSocket proxy will fail (no real WebSocket backend) but the code path is exercised
	handler.ServeHTTP(w, req)
	// We don't assert success here – we just need the branch executed
}

// TestProxyRequest_WebSocket_TLS exercises the TLS WebSocket path in proxyRequest.
func TestProxyRequest_WebSocket_TLS(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddProxyService("/wss", "localhost:9999", true)
	router.SetRootProxy("localhost:8080", false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/wss/chat", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	// Will fail at WebSocket dial, but exercises the wss:// branch
	handler.ServeHTTP(w, req)
}

// TestSubdomainRequest_WebSocket exercises the WebSocket upgrade path in subdomainRequest.
func TestSubdomainRequest_WebSocket(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddSubdomainRoutingService("ws.example.com", "localhost:9999", false)
	router.SetRootProxy("localhost:8080", false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/chat", nil)
	req.Host = "ws.example.com"
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	// WebSocket proxy will fail on dial, but exercises the ws:// branch
	handler.ServeHTTP(w, req)
}

// TestSubdomainRequest_WebSocket_TLS exercises the TLS WebSocket path in subdomainRequest.
func TestSubdomainRequest_WebSocket_TLS(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	router.AddSubdomainRoutingService("wss.example.com", "localhost:9999", true)
	router.SetRootProxy("localhost:8080", false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/chat", nil)
	req.Host = "wss.example.com"
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	// Exercises the wss:// branch
	handler.ServeHTTP(w, req)
}

// TestSubdomainRequest_WebSocket_URLWithSlash tests when domain ends with '/'.
func TestSubdomainRequest_WebSocket_URLWithSlash(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	// Domain already ends with slash – exercises the "!= /" branch in subdomain
	router.SubdomainEndpoint.Store("slash.example.com", &SubdomainEndpoint{
		MatchingDomain: "slash.example.com",
		Domain:         "localhost:9999/", // trailing slash variant
		RequireTLS:     false,
	})
	router.SetRootProxy("localhost:8080", false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "slash.example.com"
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)
}

// TestProxyRequest_DomainEndWithSlash exercises the domain trailing slash branch in proxyRequest.
func TestProxyRequest_DomainEndWithSlash(t *testing.T) {
	router, _ := NewDynamicProxy(0)
	// Store endpoint manually with trailing slash on domain
	router.ProxyEndpoints.Store("/trail", &ProxyEndpoint{
		Root:       "/trail",
		Domain:     "localhost:9999/",
		RequireTLS: false,
	})
	router.SetRootProxy("localhost:8080", false)

	handler := &ProxyHandler{Parent: router}
	req := httptest.NewRequest("GET", "/trail/path", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)
}
