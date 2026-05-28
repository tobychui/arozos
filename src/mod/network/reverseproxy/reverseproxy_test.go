package reverseproxy

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
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

// --- Additional tests for uncovered functions ---

// mockWriteFlusher implements both io.Writer and http.Flusher for testing
// maxLatencyWriter / copyResponse with FlushInterval.
type mockWriteFlusher struct {
	buf      strings.Builder
	flushed  int
}

func (m *mockWriteFlusher) Write(p []byte) (int, error) {
	return m.buf.Write(p)
}
func (m *mockWriteFlusher) Flush() {
	m.flushed++
}

func TestCopyResponse_WithFlushInterval(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("flush test"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)
	rp.FlushInterval = 10 * time.Millisecond

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with FlushInterval: %v", err)
	}
	if !strings.Contains(w.Body.String(), "flush test") {
		t.Error("Expected 'flush test' in response body")
	}
}

func TestMaxLatencyWriter_WriteAndFlush(t *testing.T) {
	mwf := &mockWriteFlusher{}
	mlw := &maxLatencyWriter{
		dst:     mwf,
		latency: 20 * time.Millisecond,
		done:    make(chan bool),
	}

	// Start flush loop
	go mlw.flushLoop()

	// Write some data
	n, err := mlw.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 5 {
		t.Errorf("Expected 5 bytes written, got %d", n)
	}

	// Wait for at least one flush
	time.Sleep(50 * time.Millisecond)

	// Stop the flush loop
	mlw.stop()

	if mwf.flushed == 0 {
		t.Error("Expected at least one Flush call")
	}
	if mwf.buf.String() != "hello" {
		t.Errorf("Expected 'hello', got %q", mwf.buf.String())
	}
}

func TestMaxLatencyWriter_Stop(t *testing.T) {
	mwf := &mockWriteFlusher{}
	mlw := &maxLatencyWriter{
		dst:     mwf,
		latency: 1 * time.Second,
		done:    make(chan bool),
	}
	go mlw.flushLoop()
	// stop should not block
	done := make(chan struct{})
	go func() {
		mlw.stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Error("stop() took too long")
	}
}

func TestOnExitFlushLoop(t *testing.T) {
	called := false
	onExitFlushLoop = func() { called = true }
	defer func() { onExitFlushLoop = nil }()

	mwf := &mockWriteFlusher{}
	mlw := &maxLatencyWriter{
		dst:     mwf,
		latency: 100 * time.Millisecond,
		done:    make(chan bool),
	}
	go mlw.flushLoop()
	mlw.stop()
	time.Sleep(10 * time.Millisecond)
	if !called {
		t.Error("Expected onExitFlushLoop to be called when done")
	}
}

func TestLogf_WithLogger(t *testing.T) {
	var buf strings.Builder
	logger := log.New(&buf, "", 0)

	rp := &ReverseProxy{ErrorLog: logger}
	rp.logf("test message %d", 42)

	if !strings.Contains(buf.String(), "test message 42") {
		t.Errorf("Expected log message, got %q", buf.String())
	}
}

func TestLogf_DefaultLogger(t *testing.T) {
	// When ErrorLog is nil, should use default log package (not panic)
	rp := &ReverseProxy{}
	rp.logf("default log message")
}

func TestRemoveHeaders_Connection(t *testing.T) {
	h := http.Header{}
	h.Set("Connection", "Keep-Alive")
	h.Set("Keep-Alive", "timeout=5")

	removeHeaders(h)

	if h.Get("Keep-Alive") != "" {
		t.Error("Expected Keep-Alive to be removed via Connection header")
	}
}

func TestRemoveHeaders_AUpgrade(t *testing.T) {
	h := http.Header{}
	h.Set("A-Upgrade", "websocket")

	removeHeaders(h)

	if h.Get("Upgrade") != "websocket" {
		t.Errorf("Expected Upgrade=websocket, got %q", h.Get("Upgrade"))
	}
	if h.Get("A-Upgrade") != "" {
		t.Error("Expected A-Upgrade to be deleted after rewrite")
	}
}

func TestRemoveHeaders_HopHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("Proxy-Connection", "keep-alive")
	h.Set("Proxy-Authenticate", "Basic")
	h.Set("Proxy-Authorization", "Basic abc")
	h.Set("Te", "trailers")
	h.Set("Trailer", "X-Foo")
	h.Set("Transfer-Encoding", "chunked")

	removeHeaders(h)

	for _, hdr := range []string{"Proxy-Connection", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding"} {
		if h.Get(hdr) != "" {
			t.Errorf("Expected hop header %q to be removed", hdr)
		}
	}
}

func TestAddXForwardedForHeader_Fresh(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	addXForwardedForHeader(req)

	xff := req.Header.Get("X-Forwarded-For")
	if xff != "10.0.0.1" {
		t.Errorf("Expected X-Forwarded-For=10.0.0.1, got %q", xff)
	}
}

func TestAddXForwardedForHeader_ChainExisting(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.2:5000"
	req.Header.Set("X-Forwarded-For", "192.168.1.1")
	addXForwardedForHeader(req)

	xff := req.Header.Get("X-Forwarded-For")
	if !strings.Contains(xff, "192.168.1.1") || !strings.Contains(xff, "10.0.0.2") {
		t.Errorf("Expected chained X-Forwarded-For, got %q", xff)
	}
}

func TestProxyHTTP_ModifyResponse(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)
	rp.ModifyResponse = func(res *http.Response) error {
		res.Header.Set("X-Modified", "yes")
		return nil
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with ModifyResponse: %v", err)
	}
	if w.Header().Get("X-Modified") != "yes" {
		t.Errorf("Expected X-Modified header to be set")
	}
}

func TestProxyHTTP_ModifyResponse_Error(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)
	rp.ModifyResponse = func(res *http.Response) error {
		return errors.New("modify error")
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err == nil {
		t.Fatal("Expected error from ModifyResponse")
	}
	if w.Code != http.StatusBadGateway {
		t.Errorf("Expected StatusBadGateway, got %d", w.Code)
	}
}

func TestServeHTTP_CONNECT(t *testing.T) {
	// CONNECT to non-hijacker response writer should return error
	target, _ := url.Parse("http://example.com")
	rp := NewReverseProxy(target)

	req := httptest.NewRequest("CONNECT", "example.com:443", nil)
	w := httptest.NewRecorder()

	// httptest.ResponseRecorder does not implement http.Hijacker
	err := rp.ServeHTTP(w, req)
	if err == nil {
		t.Error("Expected error for CONNECT on non-hijacker ResponseWriter")
	}
}

func TestProxyHTTPS_NoHijacker(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewReverseProxy(target)

	req := httptest.NewRequest("CONNECT", "example.com:443", nil)
	w := httptest.NewRecorder() // does not implement Hijacker

	err := rp.ProxyHTTPS(w, req)
	if err == nil {
		t.Error("Expected error when ResponseWriter does not support Hijacker")
	}
	if !strings.Contains(err.Error(), "hijacker") {
		t.Errorf("Expected hijacker error message, got %q", err.Error())
	}
}

func TestCopyHeader(t *testing.T) {
	src := http.Header{}
	src.Add("X-Foo", "bar")
	src.Add("X-Foo", "baz")
	src.Add("X-Other", "value")

	dst := http.Header{}
	copyHeader(dst, src)

	if len(dst["X-Foo"]) != 2 {
		t.Errorf("Expected 2 X-Foo values, got %d", len(dst["X-Foo"]))
	}
	if dst.Get("X-Other") != "value" {
		t.Errorf("Expected X-Other=value, got %q", dst.Get("X-Other"))
	}
}

// TestProxyHTTP_WithTrailers exercises the trailers branch in ProxyHTTP.
func TestProxyHTTP_WithTrailers(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Declare a trailer
		w.Header().Set("Trailer", "X-Trailer-Key")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("body with trailers"))
		// Set the actual trailer value
		w.Header().Set("X-Trailer-Key", "trailer-value")
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewReverseProxy(backendURL)

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with trailers: %v", err)
	}
	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

// TestProxyHTTPS_WithRealServer exercises ProxyHTTPS through a real HTTP server (hijacking works).
func TestProxyHTTPS_WithRealServer(t *testing.T) {
	// Create a TCP server to accept the tunneled connection
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Could not start target server: %v", err)
	}
	defer target.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// Read and discard whatever was tunneled
		buf := make([]byte, 512)
		conn.Read(buf)
	}()

	targetAddr := target.Addr().String()

	// Use a real HTTP server so hijacking is supported
	proxyURL, _ := url.Parse("http://" + targetAddr)
	rp := NewReverseProxy(proxyURL)

	// Start a real HTTP server to handle CONNECT (supporting hijack)
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := rp.ProxyHTTPS(w, r)
		if err != nil {
			// Expected if target closes immediately
			t.Logf("ProxyHTTPS returned: %v", err)
		}
	}))
	defer proxyServer.Close()

	// Make a CONNECT request
	req, _ := http.NewRequest("CONNECT", proxyServer.URL, nil)
	req.URL.Host = targetAddr
	req.Host = targetAddr

	client := &http.Client{
		Transport: &http.Transport{},
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Logf("CONNECT request error (may be expected): %v", err)
		return
	}
	if resp != nil {
		resp.Body.Close()
	}
}

// mockHijackConn is a net.Conn backed by in-memory pipes so hijacking can be
// exercised in unit tests without a real TCP listener on the client side.
type mockHijackConn struct {
	net.Conn // the server-side pipe half
}

// mockHijackResponseWriter implements http.ResponseWriter + http.Hijacker.
type mockHijackResponseWriter struct {
	header     http.Header
	statusCode int
	body       strings.Builder
	conn       net.Conn // returned by Hijack
}

func newMockHijackResponseWriter(conn net.Conn) *mockHijackResponseWriter {
	return &mockHijackResponseWriter{
		header:     http.Header{},
		statusCode: http.StatusOK,
		conn:       conn,
	}
}

func (m *mockHijackResponseWriter) Header() http.Header        { return m.header }
func (m *mockHijackResponseWriter) WriteHeader(code int)       { m.statusCode = code }
func (m *mockHijackResponseWriter) Write(b []byte) (int, error) { return m.body.Write(b) }
func (m *mockHijackResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	rw := bufio.NewReadWriter(
		bufio.NewReader(m.conn),
		bufio.NewWriter(m.conn),
	)
	return m.conn, rw, nil
}

// TestProxyHTTPS_MockHijacker exercises the core happy-path of ProxyHTTPS by
// injecting a mock Hijacker so the function can progress past the hijack and
// TCP-dial steps without requiring a real client-side connection.
func TestProxyHTTPS_MockHijacker(t *testing.T) {
	// Start a TCP target server that writes a byte and closes.
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	defer target.Close()

	targetDone := make(chan struct{})
	go func() {
		defer close(targetDone)
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 256)
		conn.Read(buf)
	}()

	// Create a net.Pipe so we have a local net.Conn that can be "hijacked".
	clientSide, serverSide := net.Pipe()
	defer clientSide.Close()
	defer serverSide.Close()

	// The "client" goroutine reads the "HTTP/1.0 200 OK" response that
	// ProxyHTTPS writes, then closes its side to unblock the io.Copy loop.
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		buf := make([]byte, 256)
		clientSide.Read(buf) // consume "HTTP/1.0 200 OK\r\n\r\n"
		clientSide.Close()
	}()

	targetURL, _ := url.Parse("http://" + target.Addr().String())
	rp := NewReverseProxy(targetURL)
	// Use a short timeout so the test does not hang.
	rp.Timeout = 100 * time.Millisecond

	w := newMockHijackResponseWriter(serverSide)
	req := httptest.NewRequest("CONNECT", "http://"+target.Addr().String(), nil)
	req.URL.Host = target.Addr().String()
	req.Host = target.Addr().String()

	err = rp.ProxyHTTPS(w, req)
	// Error is acceptable (pipe closed early), but should not be a hijacker error.
	if err != nil {
		if strings.Contains(err.Error(), "hijacker") {
			t.Errorf("unexpected hijacker error: %v", err)
		}
		t.Logf("ProxyHTTPS returned (expected): %v", err)
	}

	<-clientDone
}

// TestProxyHTTPS_DialFails exercises the net.Dial-failure branch in ProxyHTTPS.
func TestProxyHTTPS_DialFails(t *testing.T) {
	clientSide, serverSide := net.Pipe()
	defer clientSide.Close()
	defer serverSide.Close()

	// Close clientSide immediately so the hijacked conn reads/writes fail
	// but we still get past the Hijack() call.
	go func() {
		buf := make([]byte, 4)
		clientSide.Read(buf)
		clientSide.Close()
	}()

	// Point to port 1 — nothing listening there.
	badURL, _ := url.Parse("http://127.0.0.1:1")
	rp := NewReverseProxy(badURL)

	w := newMockHijackResponseWriter(serverSide)
	req := httptest.NewRequest("CONNECT", "127.0.0.1:1", nil)
	req.URL.Host = "127.0.0.1:1"

	err := rp.ProxyHTTPS(w, req)
	if err == nil {
		t.Error("expected error when dialing unreachable target")
	}
}

// TestProxyHTTPS_WithTimeout exercises the custom-timeout branch in ProxyHTTPS.
func TestProxyHTTPS_WithTimeout(t *testing.T) {
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	defer target.Close()

	go func() {
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		io.ReadAll(conn)
	}()

	clientSide, serverSide := net.Pipe()
	defer clientSide.Close()
	defer serverSide.Close()

	go func() {
		buf := make([]byte, 256)
		clientSide.Read(buf) // read "HTTP/1.0 200 OK"
		clientSide.Close()
	}()

	targetURL, _ := url.Parse("http://" + target.Addr().String())
	rp := NewReverseProxy(targetURL)
	rp.Timeout = 50 * time.Millisecond // exercises the p.Timeout != 0 branch

	w := newMockHijackResponseWriter(serverSide)
	req := httptest.NewRequest("CONNECT", "http://"+target.Addr().String(), nil)
	req.URL.Host = target.Addr().String()
	req.Host = target.Addr().String()

	err = rp.ProxyHTTPS(w, req)
	if err != nil {
		t.Logf("ProxyHTTPS with custom timeout returned (expected): %v", err)
	}
}

// TestProxyHTTPS_RawConnect exercises ProxyHTTPS via a raw TCP CONNECT, which
// is the only way to supply a real hijackable HTTP request.
func TestProxyHTTPS_RawConnect(t *testing.T) {
	// Create a target that just accepts and closes.
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	defer target.Close()

	go func() {
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 64)
		conn.Read(buf)
	}()

	targetAddr := target.Addr().String()
	proxyURL, _ := url.Parse("http://" + targetAddr)
	rp := NewReverseProxy(proxyURL)
	rp.Timeout = 200 * time.Millisecond

	// Start a real httptest.Server so Hijack works.
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if proxyErr := rp.ProxyHTTPS(w, r); proxyErr != nil {
			t.Logf("ProxyHTTPS: %v", proxyErr)
		}
	}))
	defer proxyServer.Close()

	// Send a raw CONNECT over TCP.
	conn, err := net.Dial("tcp", proxyServer.Listener.Addr().String())
	if err != nil {
		t.Fatalf("Dial proxy: %v", err)
	}
	defer conn.Close()

	fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", targetAddr, targetAddr)
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Logf("ReadResponse (may be expected): %v", err)
		return
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 from CONNECT, got %d", resp.StatusCode)
	}
}
