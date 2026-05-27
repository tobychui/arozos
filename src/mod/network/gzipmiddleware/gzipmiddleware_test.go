package gzipmiddleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// helloHandler is a simple inner handler that writes a known body.
var helloHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, "hello world")
})

// TestCompress_GzipCapableClient verifies that a client that accepts gzip gets
// a gzip-encoded response.
func TestCompress_GzipCapableClient(t *testing.T) {
	handler := Compress(helloHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Errorf("expected Content-Encoding: gzip, got %q", rr.Header().Get("Content-Encoding"))
	}

	// Verify the body is actually valid gzip.
	gr, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatalf("response body is not valid gzip: %v", err)
	}
	defer gr.Close()
	body, err := io.ReadAll(gr)
	if err != nil {
		t.Fatalf("reading gzip body: %v", err)
	}
	if string(body) != "hello world" {
		t.Errorf("expected body %q, got %q", "hello world", string(body))
	}
}

// TestCompress_NonGzipClient verifies that a client without gzip support gets a
// plain (non-compressed) response.
func TestCompress_NonGzipClient(t *testing.T) {
	handler := Compress(helloHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// No Accept-Encoding header.
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Error("expected no gzip encoding for client without Accept-Encoding: gzip")
	}
	if rr.Body.String() != "hello world" {
		t.Errorf("expected plain body, got %q", rr.Body.String())
	}
}

// TestCompress_WebSocketRequest verifies that WebSocket upgrade requests are NOT
// gzip-compressed.
func TestCompress_WebSocketRequest(t *testing.T) {
	handler := Compress(helloHandler)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("Upgrade", "websocket")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Error("WebSocket request should not be gzip-compressed")
	}
	if rr.Body.String() != "hello world" {
		t.Errorf("expected plain body for WebSocket, got %q", rr.Body.String())
	}
}

// TestCompress_SafariUserAgent verifies that Safari clients are NOT gzip-compressed.
func TestCompress_SafariUserAgent(t *testing.T) {
	handler := Compress(helloHandler)

	req := httptest.NewRequest(http.MethodGet, "/page", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Error("Safari request should not be gzip-compressed")
	}
	if rr.Body.String() != "hello world" {
		t.Errorf("expected plain body for Safari, got %q", rr.Body.String())
	}
}

// TestCompress_ShareDownloadPath verifies that /share/download/ paths bypass gzip.
func TestCompress_ShareDownloadPath(t *testing.T) {
	handler := Compress(helloHandler)

	req := httptest.NewRequest(http.MethodGet, "/share/download/somefile.zip", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Error("/share/download/ path should not be gzip-compressed")
	}
	if rr.Body.String() != "hello world" {
		t.Errorf("expected plain body for share/download, got %q", rr.Body.String())
	}
}

// TestCompressFunc_GzipCapableClient tests the CompressFunc variant.
func TestCompressFunc_GzipCapableClient(t *testing.T) {
	fn := CompressFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "compressed func")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr := httptest.NewRecorder()

	fn(rr, req)

	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Errorf("expected Content-Encoding: gzip, got %q", rr.Header().Get("Content-Encoding"))
	}

	gr, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatalf("body is not valid gzip: %v", err)
	}
	defer gr.Close()
	body, _ := io.ReadAll(gr)
	if string(body) != "compressed func" {
		t.Errorf("expected %q, got %q", "compressed func", string(body))
	}
}

// TestCompressFunc_NonGzipClient tests the CompressFunc variant without gzip support.
func TestCompressFunc_NonGzipClient(t *testing.T) {
	fn := CompressFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "plain func")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	fn(rr, req)

	if rr.Header().Get("Content-Encoding") == "gzip" {
		t.Error("expected no gzip for client without Accept-Encoding")
	}
	if rr.Body.String() != "plain func" {
		t.Errorf("expected %q, got %q", "plain func", rr.Body.String())
	}
}

// TestGzipResponseWriter_WriteHeader verifies that WriteHeader delegates to the
// underlying ResponseWriter.
func TestGzipResponseWriter_WriteHeader(t *testing.T) {
	rr := httptest.NewRecorder()
	gzw := &gzipResponseWriter{
		Writer:         io.Discard,
		ResponseWriter: rr,
	}
	gzw.WriteHeader(http.StatusCreated)
	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", rr.Code)
	}
}

// TestGzipResponseWriter_Write verifies bytes go to the underlying Writer, not the ResponseWriter.
func TestGzipResponseWriter_Write(t *testing.T) {
	var buf strings.Builder
	rr := httptest.NewRecorder()
	gzw := &gzipResponseWriter{
		Writer:         &writerAdapter{&buf},
		ResponseWriter: rr,
	}
	n, err := gzw.Write([]byte("data"))
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 4 {
		t.Errorf("expected 4 bytes written, got %d", n)
	}
	if buf.String() != "data" {
		t.Errorf("expected %q in writer, got %q", "data", buf.String())
	}
}

// writerAdapter adapts strings.Builder to io.Writer.
type writerAdapter struct{ b *strings.Builder }

func (wa *writerAdapter) Write(p []byte) (int, error) { return wa.b.Write(p) }
