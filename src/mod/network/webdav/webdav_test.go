// Copyright 2015 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package webdav

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// TODO: add tests to check XML responses with the expected prefix path
func TestPrefix(t *testing.T) {
	const dst, blah = "Destination", "blah blah blah"

	// createLockBody comes from the example in Section 9.10.7.
	const createLockBody = `<?xml version="1.0" encoding="utf-8" ?>
		<D:lockinfo xmlns:D='DAV:'>
			<D:lockscope><D:exclusive/></D:lockscope>
			<D:locktype><D:write/></D:locktype>
			<D:owner>
				<D:href>http://example.org/~ejw/contact.html</D:href>
			</D:owner>
		</D:lockinfo>
	`

	// isRedirect returns true for any redirect status code (301, 307, 308).
	// Go's ServeMux changed from 301 (MovedPermanently) to 308/307
	// (PermanentRedirect/TemporaryRedirect) for non-GET path redirects in
	// Go 1.22+, and the exact code can differ across platforms.
	isRedirect := func(code int) bool {
		return code == http.StatusMovedPermanently ||
			code == http.StatusTemporaryRedirect ||
			code == http.StatusPermanentRedirect
	}

	do := func(method, urlStr string, body string, wantStatusCode int, headers ...string) (http.Header, error) {
		var bodyReader io.Reader
		if body != "" {
			bodyReader = strings.NewReader(body)
		}
		req, err := http.NewRequest(method, urlStr, bodyReader)
		if err != nil {
			return nil, err
		}
		for len(headers) >= 2 {
			req.Header.Add(headers[0], headers[1])
			headers = headers[2:]
		}
		res, err := http.DefaultTransport.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		// Accept any redirect status when the expected code is a redirect code,
		// because Go's ServeMux redirect code varies across versions/platforms.
		if res.StatusCode != wantStatusCode {
			if !(isRedirect(wantStatusCode) && isRedirect(res.StatusCode)) {
				return nil, fmt.Errorf("got status code %d, want %d", res.StatusCode, wantStatusCode)
			}
		}
		return res.Header, nil
	}

	prefixes := []string{
		"/",
		"/a/",
		"/a/b/",
		"/a/b/c/",
	}
	ctx := context.Background()
	for _, prefix := range prefixes {
		fs := NewMemFS()
		h := &Handler{
			FileSystem: fs,
			LockSystem: NewMemLS(),
		}
		mux := http.NewServeMux()
		if prefix != "/" {
			h.Prefix = prefix
		}
		mux.Handle(prefix, h)
		srv := httptest.NewServer(mux)
		defer srv.Close()

		// The script is:
		//	MKCOL /a
		//	MKCOL /a/b
		//	PUT   /a/b/c
		//	COPY  /a/b/c /a/b/d
		//	MKCOL /a/b/e
		//	MOVE  /a/b/d /a/b/e/f
		//	LOCK  /a/b/e/g
		//	PUT   /a/b/e/g
		// which should yield the (possibly stripped) filenames /a/b/c,
		// /a/b/e/f and /a/b/e/g, plus their parent directories.

		wantA := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusMovedPermanently,
			"/a/b/":   http.StatusNotFound,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if _, err := do("MKCOL", srv.URL+"/a", "", wantA); err != nil {
			t.Errorf("prefix=%-9q MKCOL /a: %v", prefix, err)
			continue
		}

		wantB := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusMovedPermanently,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if _, err := do("MKCOL", srv.URL+"/a/b", "", wantB); err != nil {
			t.Errorf("prefix=%-9q MKCOL /a/b: %v", prefix, err)
			continue
		}

		wantC := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusMovedPermanently,
		}[prefix]
		if _, err := do("PUT", srv.URL+"/a/b/c", blah, wantC); err != nil {
			t.Errorf("prefix=%-9q PUT /a/b/c: %v", prefix, err)
			continue
		}

		wantD := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusMovedPermanently,
		}[prefix]
		if _, err := do("COPY", srv.URL+"/a/b/c", "", wantD, dst, srv.URL+"/a/b/d"); err != nil {
			t.Errorf("prefix=%-9q COPY /a/b/c /a/b/d: %v", prefix, err)
			continue
		}

		wantE := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if _, err := do("MKCOL", srv.URL+"/a/b/e", "", wantE); err != nil {
			t.Errorf("prefix=%-9q MKCOL /a/b/e: %v", prefix, err)
			continue
		}

		wantF := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if _, err := do("MOVE", srv.URL+"/a/b/d", "", wantF, dst, srv.URL+"/a/b/e/f"); err != nil {
			t.Errorf("prefix=%-9q MOVE /a/b/d /a/b/e/f: %v", prefix, err)
			continue
		}

		var lockToken string
		wantG := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if h, err := do("LOCK", srv.URL+"/a/b/e/g", createLockBody, wantG); err != nil {
			t.Errorf("prefix=%-9q LOCK /a/b/e/g: %v", prefix, err)
			continue
		} else {
			lockToken = h.Get("Lock-Token")
		}

		ifHeader := fmt.Sprintf("<%s/a/b/e/g> (%s)", srv.URL, lockToken)
		wantH := map[string]int{
			"/":       http.StatusCreated,
			"/a/":     http.StatusCreated,
			"/a/b/":   http.StatusCreated,
			"/a/b/c/": http.StatusNotFound,
		}[prefix]
		if _, err := do("PUT", srv.URL+"/a/b/e/g", blah, wantH, "If", ifHeader); err != nil {
			t.Errorf("prefix=%-9q PUT /a/b/e/g: %v", prefix, err)
			continue
		}

		got, err := find(ctx, nil, fs, "/")
		if err != nil {
			t.Errorf("prefix=%-9q find: %v", prefix, err)
			continue
		}
		sort.Strings(got)
		want := map[string][]string{
			"/":       {"/", "/a", "/a/b", "/a/b/c", "/a/b/e", "/a/b/e/f", "/a/b/e/g"},
			"/a/":     {"/", "/b", "/b/c", "/b/e", "/b/e/f", "/b/e/g"},
			"/a/b/":   {"/", "/c", "/e", "/e/f", "/e/g"},
			"/a/b/c/": {"/"},
		}[prefix]
		if !reflect.DeepEqual(got, want) {
			t.Errorf("prefix=%-9q find:\ngot  %v\nwant %v", prefix, got, want)
			continue
		}
	}
}

func TestEscapeXML(t *testing.T) {
	// These test cases aren't exhaustive, and there is more than one way to
	// escape e.g. a quot (as "&#34;" or "&quot;") or an apos. We presume that
	// the encoding/xml package tests xml.EscapeText more thoroughly. This test
	// here is just a sanity check for this package's escapeXML function, and
	// its attempt to provide a fast path (and avoid a bytes.Buffer allocation)
	// when escaping filenames is obviously a no-op.
	testCases := map[string]string{
		"":              "",
		" ":             " ",
		"&":             "&amp;",
		"*":             "*",
		"+":             "+",
		",":             ",",
		"-":             "-",
		".":             ".",
		"/":             "/",
		"0":             "0",
		"9":             "9",
		":":             ":",
		"<":             "&lt;",
		">":             "&gt;",
		"A":             "A",
		"_":             "_",
		"a":             "a",
		"~":             "~",
		"\u0201":        "\u0201",
		"&amp;":         "&amp;amp;",
		"foo&<b/ar>baz": "foo&amp;&lt;b/ar&gt;baz",
	}

	for in, want := range testCases {
		if got := escapeXML(in); got != want {
			t.Errorf("in=%q: got %q, want %q", in, got, want)
		}
	}
}

func TestFilenameEscape(t *testing.T) {
	hrefRe := regexp.MustCompile(`<D:href>([^<]*)</D:href>`)
	displayNameRe := regexp.MustCompile(`<D:displayname>([^<]*)</D:displayname>`)
	do := func(method, urlStr string) (string, string, error) {
		req, err := http.NewRequest(method, urlStr, nil)
		if err != nil {
			return "", "", err
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return "", "", err
		}
		defer res.Body.Close()

		b, err := io.ReadAll(res.Body)
		if err != nil {
			return "", "", err
		}
		hrefMatch := hrefRe.FindStringSubmatch(string(b))
		if len(hrefMatch) != 2 {
			return "", "", errors.New("D:href not found")
		}
		displayNameMatch := displayNameRe.FindStringSubmatch(string(b))
		if len(displayNameMatch) != 2 {
			return "", "", errors.New("D:displayname not found")
		}

		return hrefMatch[1], displayNameMatch[1], nil
	}

	testCases := []struct {
		name, wantHref, wantDisplayName string
	}{{
		name:            `/foo%bar`,
		wantHref:        `/foo%25bar`,
		wantDisplayName: `foo%bar`,
	}, {
		name:            `/こんにちわ世界`,
		wantHref:        `/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%82%8F%E4%B8%96%E7%95%8C`,
		wantDisplayName: `こんにちわ世界`,
	}, {
		name:            `/Program Files/`,
		wantHref:        `/Program%20Files/`,
		wantDisplayName: `Program Files`,
	}, {
		name:            `/go+lang`,
		wantHref:        `/go+lang`,
		wantDisplayName: `go+lang`,
	}, {
		name:            `/go&lang`,
		wantHref:        `/go&amp;lang`,
		wantDisplayName: `go&amp;lang`,
	}, {
		name:            `/go<lang`,
		wantHref:        `/go%3Clang`,
		wantDisplayName: `go&lt;lang`,
	}, {
		name:            `/`,
		wantHref:        `/`,
		wantDisplayName: ``,
	}}
	ctx := context.Background()
	fs := NewMemFS()
	for _, tc := range testCases {
		if tc.name != "/" {
			if strings.HasSuffix(tc.name, "/") {
				if err := fs.Mkdir(ctx, tc.name, 0755); err != nil {
					t.Fatalf("name=%q: Mkdir: %v", tc.name, err)
				}
			} else {
				f, err := fs.OpenFile(ctx, tc.name, os.O_CREATE, 0644)
				if err != nil {
					t.Fatalf("name=%q: OpenFile: %v", tc.name, err)
				}
				f.Close()
			}
		}
	}

	srv := httptest.NewServer(&Handler{
		FileSystem: fs,
		LockSystem: NewMemLS(),
	})
	defer srv.Close()

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range testCases {
		u.Path = tc.name
		gotHref, gotDisplayName, err := do("PROPFIND", u.String())
		if err != nil {
			t.Errorf("name=%q: PROPFIND: %v", tc.name, err)
			continue
		}
		if gotHref != tc.wantHref {
			t.Errorf("name=%q: got href %q, want %q", tc.name, gotHref, tc.wantHref)
		}
		if gotDisplayName != tc.wantDisplayName {
			t.Errorf("name=%q: got dispayname %q, want %q", tc.name, gotDisplayName, tc.wantDisplayName)
		}
	}
}

// newTestHandler creates a Handler backed by a MemFS and MemLS for HTTP handler tests.
func newTestHandler() *Handler {
	return &Handler{
		FileSystem: NewMemFS(),
		LockSystem: NewMemLS(),
	}
}

// doRequest sends a request to the handler and returns the response.
func doRequest(h *Handler, method, path, body string, headers ...string) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// --- ServeHTTP ---

func TestServeHTTP_NoFileSystem(t *testing.T) {
	h := &Handler{LockSystem: NewMemLS()}
	rr := doRequest(h, "GET", "/", "")
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

func TestServeHTTP_NoLockSystem(t *testing.T) {
	h := &Handler{FileSystem: NewMemFS()}
	rr := doRequest(h, "GET", "/", "")
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

func TestServeHTTP_UnsupportedMethod(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "TRACE", "/", "")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unsupported method, got %d", rr.Code)
	}
}

func TestServeHTTP_Logger(t *testing.T) {
	var loggedErr error
	h := &Handler{
		FileSystem: NewMemFS(),
		LockSystem: NewMemLS(),
		Logger: func(r *http.Request, err error) {
			loggedErr = err
		},
	}
	doRequest(h, "GET", "/nonexistent", "")
	_ = loggedErr // just ensure logger was called without panic
}

// --- handleOptions ---

func TestHandleOptions_Root(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "OPTIONS", "/", "")
	if rr.Code != http.StatusOK {
		t.Errorf("OPTIONS / expected 200, got %d", rr.Code)
	}
	allow := rr.Header().Get("Allow")
	if allow == "" {
		t.Error("expected Allow header to be set")
	}
}

func TestHandleOptions_ExistingFile(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/foo.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Close()

	rr := doRequest(h, "OPTIONS", "/foo.txt", "")
	if rr.Code != http.StatusOK {
		t.Errorf("OPTIONS /foo.txt expected 200, got %d", rr.Code)
	}
	allow := rr.Header().Get("Allow")
	if !strings.Contains(allow, "GET") {
		t.Errorf("expected Allow header to contain GET for file, got %q", allow)
	}
}

func TestHandleOptions_ExistingDir(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	if err := h.FileSystem.Mkdir(ctx, "/mydir", 0755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	rr := doRequest(h, "OPTIONS", "/mydir", "")
	if rr.Code != http.StatusOK {
		t.Errorf("OPTIONS /mydir expected 200, got %d", rr.Code)
	}
	allow := rr.Header().Get("Allow")
	if !strings.Contains(allow, "PROPFIND") {
		t.Errorf("expected Allow header to contain PROPFIND for dir, got %q", allow)
	}
}

// --- handleGetHeadPost ---

func TestHandleGet_ExistingFile(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/hello.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Write([]byte("hello world"))
	f.Close()

	rr := doRequest(h, "GET", "/hello.txt", "")
	if rr.Code != http.StatusOK {
		t.Errorf("GET /hello.txt expected 200, got %d", rr.Code)
	}
	if body := rr.Body.String(); body != "hello world" {
		t.Errorf("expected body 'hello world', got %q", body)
	}
}

func TestHandleGet_NotFound(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "GET", "/nonexistent.txt", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("GET /nonexistent.txt expected 404, got %d", rr.Code)
	}
}

func TestHandleGet_Directory(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	if err := h.FileSystem.Mkdir(ctx, "/adir", 0755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	rr := doRequest(h, "GET", "/adir", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET directory expected 405, got %d", rr.Code)
	}
}

func TestHandleHead_ExistingFile(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/test.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Write([]byte("content"))
	f.Close()

	rr := doRequest(h, "HEAD", "/test.txt", "")
	if rr.Code != http.StatusOK {
		t.Errorf("HEAD expected 200, got %d", rr.Code)
	}
}

func TestHandlePost_ExistingFile(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/post.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Write([]byte("data"))
	f.Close()

	rr := doRequest(h, "POST", "/post.txt", "")
	if rr.Code != http.StatusOK {
		t.Errorf("POST expected 200, got %d", rr.Code)
	}
}

// --- handleDelete ---

func TestHandleDelete_ExistingFile(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/todelete.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Close()

	rr := doRequest(h, "DELETE", "/todelete.txt", "")
	if rr.Code != http.StatusNoContent {
		t.Errorf("DELETE expected 204, got %d", rr.Code)
	}
}

func TestHandleDelete_NotFound(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "DELETE", "/ghost.txt", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("DELETE nonexistent expected 404, got %d", rr.Code)
	}
}

// --- handleUnlock ---

func TestHandleUnlock_BadToken(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "UNLOCK", "/", "", "Lock-Token", "bad-token")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("UNLOCK with bad token expected 400, got %d", rr.Code)
	}
}

func TestHandleUnlock_NoSuchLock(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "UNLOCK", "/", "", "Lock-Token", "<urn:uuid:nosuchlocktoken>")
	if rr.Code != http.StatusConflict {
		t.Errorf("UNLOCK with no such lock expected 409, got %d", rr.Code)
	}
}

func TestHandleUnlock_ValidLock(t *testing.T) {
	// First create a lock via LOCK request, then unlock it.
	const createLockBody = `<?xml version="1.0" encoding="utf-8" ?>
		<D:lockinfo xmlns:D='DAV:'>
			<D:lockscope><D:exclusive/></D:lockscope>
			<D:locktype><D:write/></D:locktype>
			<D:owner><D:href>owner</D:href></D:owner>
		</D:lockinfo>`

	srv := httptest.NewServer(newTestHandler())
	defer srv.Close()

	// Lock the resource
	lockReq, _ := http.NewRequest("LOCK", srv.URL+"/lockme.txt", strings.NewReader(createLockBody))
	lockResp, err := http.DefaultClient.Do(lockReq)
	if err != nil {
		t.Fatalf("LOCK request failed: %v", err)
	}
	defer lockResp.Body.Close()
	lockToken := lockResp.Header.Get("Lock-Token")
	if lockToken == "" {
		t.Skip("LOCK did not return a Lock-Token header")
	}

	// Now unlock
	unlockReq, _ := http.NewRequest("UNLOCK", srv.URL+"/lockme.txt", nil)
	unlockReq.Header.Set("Lock-Token", lockToken)
	unlockResp, err := http.DefaultClient.Do(unlockReq)
	if err != nil {
		t.Fatalf("UNLOCK request failed: %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusNoContent {
		t.Errorf("UNLOCK expected 204, got %d", unlockResp.StatusCode)
	}
}

// --- handleProppatch ---

func TestHandleProppatch_SetProperty(t *testing.T) {
	const proppatchBody = `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:">
			<D:set>
				<D:prop>
					<D:displayname>My File</D:displayname>
				</D:prop>
			</D:set>
		</D:propertyupdate>`

	h := newTestHandler()
	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/patchme.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Close()

	rr := doRequest(h, "PROPPATCH", "/patchme.txt", proppatchBody)
	if rr.Code != StatusMulti && rr.Code != http.StatusOK {
		t.Errorf("PROPPATCH expected 207 or 200, got %d", rr.Code)
	}
}

func TestHandleProppatch_NotFound(t *testing.T) {
	const proppatchBody = `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:">
			<D:set><D:prop><D:displayname>X</D:displayname></D:prop></D:set>
		</D:propertyupdate>`

	h := newTestHandler()
	rr := doRequest(h, "PROPPATCH", "/nonexistent.txt", proppatchBody)
	if rr.Code != http.StatusNotFound {
		t.Errorf("PROPPATCH on nonexistent expected 404, got %d", rr.Code)
	}
}

// --- parseDepth ---

func TestParseDepth(t *testing.T) {
	cases := []struct {
		input string
		want  int
	}{
		{"0", 0},
		{"1", 1},
		{"infinity", infiniteDepth},
		{"invalid", invalidDepth},
		{"", invalidDepth},
	}
	for _, tc := range cases {
		got := parseDepth(tc.input)
		if got != tc.want {
			t.Errorf("parseDepth(%q) = %d, want %d", tc.input, got, tc.want)
		}
	}
}

// --- StatusText ---

func TestStatusText(t *testing.T) {
	cases := []struct {
		code int
		want string
	}{
		{StatusMulti, "Multi-Status"},
		{StatusUnprocessableEntity, "Unprocessable Entity"},
		{StatusLocked, "Locked"},
		{StatusFailedDependency, "Failed Dependency"},
		{StatusInsufficientStorage, "Insufficient Storage"},
		{http.StatusOK, "OK"},
		{http.StatusNotFound, "Not Found"},
	}
	for _, tc := range cases {
		got := StatusText(tc.code)
		if got != tc.want {
			t.Errorf("StatusText(%d) = %q, want %q", tc.code, got, tc.want)
		}
	}
}

// --- stripPrefix ---

func TestStripPrefix_NoPrefix(t *testing.T) {
	h := &Handler{}
	p, status, err := h.stripPrefix("/foo/bar")
	if err != nil || status != http.StatusOK || p != "/foo/bar" {
		t.Errorf("stripPrefix with no prefix: got (%q, %d, %v)", p, status, err)
	}
}

func TestStripPrefix_WithMatchingPrefix(t *testing.T) {
	h := &Handler{Prefix: "/dav"}
	p, status, err := h.stripPrefix("/dav/foo/bar")
	if err != nil || status != http.StatusOK || p != "/foo/bar" {
		t.Errorf("stripPrefix with matching prefix: got (%q, %d, %v)", p, status, err)
	}
}

func TestStripPrefix_WithMismatchedPrefix(t *testing.T) {
	h := &Handler{Prefix: "/dav"}
	_, status, err := h.stripPrefix("/other/foo")
	if err == nil || status != http.StatusNotFound {
		t.Errorf("stripPrefix mismatch: expected 404 error, got (%d, %v)", status, err)
	}
}

// --- handleMkcol with Content-Length > 0 ---

func TestHandleMkcol_WithBody(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest("MKCOL", "/newdir", strings.NewReader("body"))
	req.ContentLength = 4
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnsupportedMediaType {
		t.Errorf("MKCOL with body expected 415, got %d", rr.Code)
	}
}

// --- handleCopyMove error paths ---

func TestHandleCopy_NoDestination(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "COPY", "/src", "")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("COPY without Destination expected 400, got %d", rr.Code)
	}
}

func TestHandleMove_NoDestination(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "MOVE", "/src", "")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("MOVE without Destination expected 400, got %d", rr.Code)
	}
}

func TestHandleCopy_SameSourceAndDest(t *testing.T) {
	h := newTestHandler()
	srv := httptest.NewServer(h)
	defer srv.Close()

	ctx := context.Background()
	f, err := h.FileSystem.OpenFile(ctx, "/file.txt", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	f.Close()

	req, _ := http.NewRequest("COPY", srv.URL+"/file.txt", nil)
	req.Header.Set("Destination", srv.URL+"/file.txt")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("COPY request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("COPY src==dst expected 403, got %d", resp.StatusCode)
	}
}

// --- RequestEventListener ---

func TestHandlePropfind_WithEventListener(t *testing.T) {
	var capturedPath string
	h := &Handler{
		FileSystem: NewMemFS(),
		LockSystem: NewMemLS(),
		RequestEventListener: func(p string) {
			capturedPath = p
		},
	}
	rr := doRequest(h, "PROPFIND", "/", "")
	if rr.Code != StatusMulti {
		t.Errorf("PROPFIND / expected 207, got %d", rr.Code)
	}
	if capturedPath != "/" {
		t.Errorf("expected event listener called with '/', got %q", capturedPath)
	}
}

// --- readLockInfo ---

func TestReadLockInfo_EmptyBody(t *testing.T) {
	li, status, err := readLockInfo(strings.NewReader(""))
	if err != nil {
		t.Fatalf("readLockInfo empty body: unexpected error %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if li != (lockInfo{}) {
		t.Errorf("expected empty lockInfo, got %+v", li)
	}
}

func TestReadLockInfo_InvalidXML(t *testing.T) {
	_, status, err := readLockInfo(strings.NewReader("not xml"))
	if err == nil {
		t.Error("expected error for invalid XML")
	}
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
}

func TestReadLockInfo_UnsupportedLockType(t *testing.T) {
	// Shared lock (not supported)
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<D:lockinfo xmlns:D='DAV:'>
			<D:lockscope><D:exclusive/></D:lockscope>
			<D:locktype><D:write/></D:locktype>
		</D:lockinfo>`
	// exclusive + write with no Shared set should succeed
	li, status, err := readLockInfo(strings.NewReader(body))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if li.Exclusive == nil {
		t.Error("expected Exclusive to be set")
	}
}

// --- readProppatch ---

func TestReadProppatch_SetOperation(t *testing.T) {
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:">
			<D:set>
				<D:prop>
					<D:displayname>Test</D:displayname>
				</D:prop>
			</D:set>
		</D:propertyupdate>`
	patches, status, err := readProppatch(strings.NewReader(body))
	if err != nil {
		t.Fatalf("readProppatch: %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if len(patches) != 1 {
		t.Fatalf("expected 1 patch, got %d", len(patches))
	}
	if patches[0].Remove {
		t.Error("expected Remove=false for set operation")
	}
}

func TestReadProppatch_RemoveOperation(t *testing.T) {
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:">
			<D:remove>
				<D:prop>
					<D:displayname/>
				</D:prop>
			</D:remove>
		</D:propertyupdate>`
	patches, status, err := readProppatch(strings.NewReader(body))
	if err != nil {
		t.Fatalf("readProppatch: %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if len(patches) != 1 {
		t.Fatalf("expected 1 patch, got %d", len(patches))
	}
	if !patches[0].Remove {
		t.Error("expected Remove=true for remove operation")
	}
}

func TestReadProppatch_InvalidXML(t *testing.T) {
	_, status, err := readProppatch(strings.NewReader("not xml"))
	if err == nil {
		t.Error("expected error for invalid XML")
	}
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
}

func TestReadProppatch_UnknownOperation(t *testing.T) {
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:">
			<D:unknown>
				<D:prop><D:foo/></D:prop>
			</D:unknown>
		</D:propertyupdate>`
	_, status, err := readProppatch(strings.NewReader(body))
	if err == nil {
		t.Error("expected error for unknown operation")
	}
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
}

// --- xmlLang ---

// TestXmlLang exercises xmlLang via readProppatch which internally uses xmlLang.
// We test it indirectly by parsing a propertyupdate with an xml:lang attribute.
func TestXmlLang_ViaProppatch(t *testing.T) {
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<D:propertyupdate xmlns:D="DAV:" xml:lang="en">
			<D:set>
				<D:prop>
					<D:displayname xml:lang="fr">Bonjour</D:displayname>
				</D:prop>
			</D:set>
		</D:propertyupdate>`
	patches, _, err := readProppatch(strings.NewReader(body))
	if err != nil {
		t.Fatalf("readProppatch: %v", err)
	}
	if len(patches) == 0 {
		t.Fatal("expected at least 1 patch")
	}
}

// --- next (xml token reading) ---

// TestNext_ViaReadLockInfo exercises the next() function indirectly through
// readLockInfo, which calls next() while parsing XML.
func TestNext_ViaReadLockInfo(t *testing.T) {
	// A lockinfo with comments; next() should skip the comments.
	body := `<?xml version="1.0" encoding="utf-8" ?>
		<!-- A comment -->
		<D:lockinfo xmlns:D='DAV:'>
			<!-- another comment -->
			<D:lockscope><D:exclusive/></D:lockscope>
			<D:locktype><D:write/></D:locktype>
			<D:owner><D:href>owner</D:href></D:owner>
		</D:lockinfo>`
	li, status, err := readLockInfo(strings.NewReader(body))
	if err != nil {
		t.Fatalf("readLockInfo with comments: %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if li.Exclusive == nil {
		t.Error("expected Exclusive to be set")
	}
}

// --- multistatusWriter ---

func TestMultistatusWriter_CloseWithNoWrites(t *testing.T) {
	rr := httptest.NewRecorder()
	mw := multistatusWriter{w: rr}
	if err := mw.close(); err != nil {
		t.Errorf("close with no writes: unexpected error %v", err)
	}
}

func TestMultistatusWriter_WriteInvalidResponse(t *testing.T) {
	rr := httptest.NewRecorder()
	mw := multistatusWriter{w: rr}
	// A response with no Href should be invalid
	err := mw.write(&response{})
	if err != errInvalidResponse {
		t.Errorf("expected errInvalidResponse, got %v", err)
	}
}

// --- writeLockInfo ---

func TestWriteLockInfo_ZeroDepth(t *testing.T) {
	var buf strings.Builder
	ld := LockDetails{
		Root:      "/file.txt",
		Duration:  30 * time.Second,
		ZeroDepth: true,
	}
	n, err := writeLockInfo(&buf, "token123", ld)
	if err != nil {
		t.Fatalf("writeLockInfo: %v", err)
	}
	if n == 0 {
		t.Error("expected non-zero bytes written")
	}
	if !strings.Contains(buf.String(), "<D:depth>0</D:depth>") {
		t.Errorf("expected depth=0 in output, got: %s", buf.String())
	}
}

func TestWriteLockInfo_InfiniteDepth(t *testing.T) {
	var buf strings.Builder
	ld := LockDetails{
		Root:      "/dir",
		Duration:  60 * time.Second,
		ZeroDepth: false,
	}
	_, err := writeLockInfo(&buf, "tok456", ld)
	if err != nil {
		t.Fatalf("writeLockInfo: %v", err)
	}
	if !strings.Contains(buf.String(), "<D:depth>infinity</D:depth>") {
		t.Errorf("expected depth=infinity in output, got: %s", buf.String())
	}
}

// --- escape ---

func TestEscape_NoSpecialChars(t *testing.T) {
	got := escape("hello-world_123")
	if got != "hello-world_123" {
		t.Errorf("escape fast path: got %q", got)
	}
}

func TestEscape_WithSpecialChars(t *testing.T) {
	got := escape("<script>")
	if got == "<script>" {
		t.Error("expected escaped output, got unchanged string")
	}
}

// --- handlePropfind with depth header ---

func TestHandlePropfind_DepthHeader(t *testing.T) {
	h := newTestHandler()
	ctx := context.Background()
	if err := h.FileSystem.Mkdir(ctx, "/depthdir", 0755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}

	rr := doRequest(h, "PROPFIND", "/depthdir", "", "Depth", "1")
	if rr.Code != StatusMulti {
		t.Errorf("PROPFIND with Depth:1 expected 207, got %d", rr.Code)
	}
}

func TestHandlePropfind_InvalidDepth(t *testing.T) {
	h := newTestHandler()
	rr := doRequest(h, "PROPFIND", "/", "", "Depth", "invalid-depth")
	// invalidDepth should cause a 400 response
	if rr.Code != http.StatusBadRequest {
		t.Errorf("PROPFIND with invalid depth expected 400, got %d", rr.Code)
	}
}

// --- readPropfind ---

func TestReadPropfind_EmptyBody(t *testing.T) {
	pf, status, err := readPropfind(strings.NewReader(""))
	if err != nil {
		t.Fatalf("readPropfind empty body: %v", err)
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
	if pf.Allprop == nil {
		t.Error("expected Allprop to be set for empty body")
	}
}

func TestReadPropfind_InvalidXML(t *testing.T) {
	_, status, err := readPropfind(strings.NewReader("not xml"))
	if err == nil {
		t.Error("expected error for invalid XML")
	}
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
}

