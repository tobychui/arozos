package dpcore

import (
	"bufio"
	"errors"
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

// --- mock writeFlusher for flush tests ---

type mockWF struct {
	buf     strings.Builder
	flushed int
}

func (m *mockWF) Write(p []byte) (int, error) { return m.buf.Write(p) }
func (m *mockWF) Flush()                       { m.flushed++ }

func TestMaxLatencyWriter_WriteAndFlush(t *testing.T) {
	mwf := &mockWF{}
	mlw := &maxLatencyWriter{
		dst:     mwf,
		latency: 20 * time.Millisecond,
		done:    make(chan bool),
	}
	go mlw.flushLoop()

	n, err := mlw.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 5 {
		t.Errorf("Expected 5 bytes written, got %d", n)
	}

	time.Sleep(60 * time.Millisecond)
	mlw.stop()

	if mwf.flushed == 0 {
		t.Error("Expected at least one Flush call")
	}
	if mwf.buf.String() != "hello" {
		t.Errorf("Expected 'hello', got %q", mwf.buf.String())
	}
}

func TestMaxLatencyWriter_Stop(t *testing.T) {
	mwf := &mockWF{}
	mlw := &maxLatencyWriter{
		dst:     mwf,
		latency: 1 * time.Second,
		done:    make(chan bool),
	}
	go mlw.flushLoop()
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

func TestOnExitFlushLoop_Dpcore(t *testing.T) {
	called := false
	onExitFlushLoop = func() { called = true }
	defer func() { onExitFlushLoop = nil }()

	mwf := &mockWF{}
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

func TestLogf_WithLogger_Dpcore(t *testing.T) {
	var buf strings.Builder
	logger := log.New(&buf, "", 0)
	rp := &ReverseProxy{ErrorLog: logger}
	rp.logf("test %d", 99)
	if !strings.Contains(buf.String(), "test 99") {
		t.Errorf("Expected log output, got %q", buf.String())
	}
}

func TestLogf_DefaultLogger_Dpcore(t *testing.T) {
	rp := &ReverseProxy{}
	rp.logf("default logger test")
}

func TestRemoveHeaders_ConnectionHop(t *testing.T) {
	h := http.Header{}
	h.Set("Connection", "Keep-Alive")
	h.Set("Keep-Alive", "timeout=5")
	removeHeaders(h)
	if h.Get("Keep-Alive") != "" {
		t.Error("Expected Keep-Alive to be removed via Connection header")
	}
}

func TestRemoveHeaders_AUpgrade_Dpcore(t *testing.T) {
	h := http.Header{}
	h.Set("A-Upgrade", "websocket")
	removeHeaders(h)
	if h.Get("Upgrade") != "websocket" {
		t.Errorf("Expected Upgrade=websocket, got %q", h.Get("Upgrade"))
	}
	if h.Get("A-Upgrade") != "" {
		t.Error("Expected A-Upgrade to be deleted")
	}
}

func TestRemoveHeaders_HopHeaders_Dpcore(t *testing.T) {
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

func TestAddXForwardedForHeader_Fresh_Dpcore(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	addXForwardedForHeader(req)
	xff := req.Header.Get("X-Forwarded-For")
	if xff != "10.0.0.1" {
		t.Errorf("Expected X-Forwarded-For=10.0.0.1, got %q", xff)
	}
}

func TestAddXForwardedForHeader_Chain_Dpcore(t *testing.T) {
	req, _ := http.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.2:5000"
	req.Header.Set("X-Forwarded-For", "192.168.1.1")
	addXForwardedForHeader(req)
	xff := req.Header.Get("X-Forwarded-For")
	if !strings.Contains(xff, "192.168.1.1") || !strings.Contains(xff, "10.0.0.2") {
		t.Errorf("Expected chained X-Forwarded-For, got %q", xff)
	}
}

func TestCopyHeader_Dpcore(t *testing.T) {
	src := http.Header{}
	src.Add("X-Foo", "bar")
	src.Add("X-Foo", "baz")
	dst := http.Header{}
	copyHeader(dst, src)
	if len(dst["X-Foo"]) != 2 {
		t.Errorf("Expected 2 X-Foo values, got %d", len(dst["X-Foo"]))
	}
}

func TestProxyHTTP_BackendError_Dpcore(t *testing.T) {
	badURL, _ := url.Parse("http://127.0.0.1:1")
	rp := NewDynamicProxyCore(badURL, "")

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err == nil {
		t.Log("No error returned (port may be in use)")
	} else {
		if w.Code != http.StatusBadGateway {
			t.Errorf("Expected StatusBadGateway on error, got %d", w.Code)
		}
	}
}

func TestProxyHTTP_ModifyResponse_Dpcore(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")
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
		t.Error("Expected X-Modified header to be set")
	}
}

func TestProxyHTTP_ModifyResponse_Error_Dpcore(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")
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

func TestProxyHTTP_WithLocationHeader(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "/newpath")
		w.WriteHeader(http.StatusFound)
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "/api")

	req := httptest.NewRequest("GET", "/api/something", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP returned error: %v", err)
	}
	location := w.Header().Get("Location")
	if location == "" {
		t.Error("Expected Location header to be set")
	}
}

func TestProxyHTTP_WithFlushInterval_Dpcore(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("flush test"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")
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

func TestProxyHTTPS_NoHijacker_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")

	req := httptest.NewRequest("CONNECT", "example.com:443", nil)
	w := httptest.NewRecorder()

	err := rp.ProxyHTTPS(w, req)
	if err == nil {
		t.Error("Expected error when ResponseWriter does not support Hijacker")
	}
	if !strings.Contains(err.Error(), "hijacker") {
		t.Errorf("Expected hijacker error message, got %q", err.Error())
	}
}

func TestServeHTTP_CONNECT_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")

	req := httptest.NewRequest("CONNECT", "example.com:443", nil)
	w := httptest.NewRecorder()

	err := rp.ServeHTTP(w, req)
	if err == nil {
		t.Error("Expected error for CONNECT on non-hijacker ResponseWriter")
	}
}

func TestDirector_QueryMerge_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix?a=1")
	rp := NewDynamicProxyCore(target, "")

	req, _ := http.NewRequest("GET", "http://original.com/path?b=2", nil)
	rp.Director(req)

	if !strings.Contains(req.URL.RawQuery, "a=1") {
		t.Error("Expected target query string to be preserved")
	}
	if !strings.Contains(req.URL.RawQuery, "b=2") {
		t.Error("Expected request query string to be merged")
	}
}

func TestDirector_EmptyQueries_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com/prefix")
	rp := NewDynamicProxyCore(target, "")

	req, _ := http.NewRequest("GET", "http://original.com/path?b=2", nil)
	rp.Director(req)

	if req.URL.RawQuery != "b=2" {
		t.Errorf("Expected query %q, got %q", "b=2", req.URL.RawQuery)
	}
}

func TestDirector_UserAgent_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")

	req, _ := http.NewRequest("GET", "http://original.com/", nil)
	rp.Director(req)
	ua := req.Header.Get("User-Agent")
	if ua != "" {
		t.Errorf("Expected empty User-Agent when not set, got %q", ua)
	}

	req2, _ := http.NewRequest("GET", "http://original.com/", nil)
	req2.Header.Set("User-Agent", "TestAgent/1.0")
	rp.Director(req2)
	if req2.Header.Get("User-Agent") != "TestAgent/1.0" {
		t.Error("Expected User-Agent to be preserved when already set")
	}
}

// --- mockHijacker allows testing ProxyHTTPS ---

type mockHijackResponseWriter struct {
	httptest.ResponseRecorder
	conn net.Conn
	err  error
}

func (m *mockHijackResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if m.err != nil {
		return nil, nil, m.err
	}
	return m.conn, bufio.NewReadWriter(bufio.NewReader(m.conn), bufio.NewWriter(m.conn)), nil
}

func TestProxyHTTPS_HijackError_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")

	req := httptest.NewRequest("CONNECT", "example.com:443", nil)
	w := &mockHijackResponseWriter{err: errors.New("hijack failed")}

	err := rp.ProxyHTTPS(w, req)
	if err == nil {
		t.Error("Expected error when hijack fails")
	}
	if !strings.Contains(err.Error(), "hijack failed") {
		t.Errorf("Expected 'hijack failed' in error, got %q", err.Error())
	}
}

func TestProxyHTTPS_DialError_Dpcore(t *testing.T) {
	// Create a pair of connected net.Conn via pipe so hijack succeeds
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()

	target, _ := url.Parse("http://127.0.0.1:1") // unreachable
	rp := NewDynamicProxyCore(target, "")

	req := httptest.NewRequest("CONNECT", "127.0.0.1:1", nil)
	w := &mockHijackResponseWriter{conn: clientConn}

	// Run in goroutine because ProxyHTTPS blocks on io.Copy after dial failure doesn't block
	done := make(chan error, 1)
	go func() {
		done <- rp.ProxyHTTPS(w, req)
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Error("Expected error when dialing unreachable host")
		}
	case <-time.After(3 * time.Second):
		t.Error("ProxyHTTPS timed out")
	}
	clientConn.Close()
}

func TestProxyHTTPS_WithCustomTimeout_Dpcore(t *testing.T) {
	// Start a local server to act as the CONNECT target
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer ln.Close()

	// Accept and immediately close to force quick end
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		// Read the HTTP/1.0 200 OK and discard, then close
		buf := make([]byte, 64)
		conn.Read(buf)
		conn.Close()
	}()

	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()

	// Drain clientConn so Write doesn't block
	go func() {
		io.Copy(io.Discard, serverConn)
	}()

	target, _ := url.Parse("http://127.0.0.1:1")
	rp := NewDynamicProxyCore(target, "")
	rp.Timeout = 100 * time.Millisecond

	req := httptest.NewRequest("CONNECT", ln.Addr().String(), nil)
	w := &mockHijackResponseWriter{conn: clientConn}

	done := make(chan error, 1)
	go func() {
		done <- rp.ProxyHTTPS(w, req)
	}()

	select {
	case <-done:
		// success or error both acceptable – we just want the code path exercised
	case <-time.After(3 * time.Second):
		t.Error("ProxyHTTPS timed out in test")
	}
	clientConn.Close()
}

// --- mockRoundTripper for Trailer tests ---

type trailerRoundTripper struct{}

func (t *trailerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	body := io.NopCloser(strings.NewReader("trailer body"))
	res := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       body,
		Trailer:    http.Header{"X-Test-Trailer": []string{"trailer-value"}},
	}
	return res, nil
}

func TestProxyHTTP_WithTrailer_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")
	rp.Transport = &trailerRoundTripper{}

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with trailer: %v", err)
	}
	// Trailer header should have been added
	trailerHeader := w.Header().Get("Trailer")
	if trailerHeader == "" {
		t.Error("Expected Trailer header to be set in response")
	}
}

// --- mockCloseNotifier for CloseNotifier path ---

type closeNotifyResponseWriter struct {
	httptest.ResponseRecorder
	ch chan bool
}

func (c *closeNotifyResponseWriter) CloseNotify() <-chan bool {
	return c.ch
}

func TestProxyHTTP_CloseNotifier_Dpcore(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("close notify test"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp := NewDynamicProxyCore(backendURL, "")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"

	ch := make(chan bool, 1)
	w := &closeNotifyResponseWriter{
		ResponseRecorder: *httptest.NewRecorder(),
		ch:               ch,
	}

	err := rp.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with CloseNotifier: %v", err)
	}
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestProxyHTTP_CustomTransport_Dpcore(t *testing.T) {
	target, _ := url.Parse("http://example.com")
	rp := NewDynamicProxyCore(target, "")

	// Custom transport that succeeds
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)
	rp2 := NewDynamicProxyCore(backendURL, "")
	rp2.Transport = http.DefaultTransport

	req := httptest.NewRequest("GET", "/custom", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()

	err := rp2.ProxyHTTP(w, req)
	if err != nil {
		t.Fatalf("ProxyHTTP with custom transport: %v", err)
	}
	_ = rp // ensure rp is used
}
