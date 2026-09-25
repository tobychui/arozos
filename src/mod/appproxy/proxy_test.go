package appproxy

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// newUpstream starts a fake container web app that records what it received
func newUpstream(t *testing.T) (*httptest.Server, *http.Request) {
	t.Helper()
	last := &http.Request{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*last = *r.Clone(r.Context())
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "1", Path: "/"})
			io.WriteString(w, `<html><head><link href="/style.css" rel="stylesheet"></head><body><img src="/logo.png"></body></html>`)
		case "/gz":
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Content-Encoding", "gzip")
			gz := gzip.NewWriter(w)
			io.WriteString(gz, `<head></head><img src="/zipped.png">`)
			gz.Close()
		case "/style.css":
			w.Header().Set("Content-Type", "text/css")
			io.WriteString(w, `body{background:url(/bg.png)}`)
		case "/login":
			http.Redirect(w, r, "/dashboard", http.StatusFound)
		case "/absolute":
			w.Header().Set("Location", "http://"+r.Host+"/elsewhere")
			w.WriteHeader(http.StatusFound)
		default:
			io.WriteString(w, "path="+r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, last
}

func upstreamTarget(srv *httptest.Server) string {
	u, _ := url.Parse(srv.URL)
	return u.Host
}

func doRequest(m *Manager, method string, target string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	if !m.HandleRequest(rec, req) {
		rec.Code = -1
	}
	return rec
}

func TestPathModeProxy(t *testing.T) {
	up, last := newUpstream(t)
	m := newTestManager(t, nil)
	ep := pathEndpoint("demo", upstreamTarget(up))
	ep.RewriteRoot = true
	ep.AllowFraming = true
	if _, err := m.Save(ep, true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}

	t.Run("prefix stripped and cookies filtered", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/api/x?q=1", map[string]string{
			"X-Test-User": "alice",
			"Cookie":      "ao_auth=secret; sid=1; aoc_ao_acc=mine",
			"Referer":     "http://nas.local/app/demo/page",
		})
		if rec.Code != 200 || rec.Body.String() != "path=/api/x" {
			t.Fatalf("got %d %q", rec.Code, rec.Body.String())
		}
		if got := last.Header.Get("Cookie"); got != "sid=1; ao_acc=mine" {
			t.Errorf("upstream cookies = %q", got)
		}
		if last.Host != "nas.local" {
			t.Errorf("upstream Host = %q, want the public host", last.Host)
		}
		if last.Header.Get("X-Forwarded-Prefix") != "/app/demo" {
			t.Errorf("missing X-Forwarded-Prefix")
		}
		if last.Header.Get("Referer") != "http://nas.local/page" {
			t.Errorf("upstream Referer = %q", last.Header.Get("Referer"))
		}
		if last.URL.RawQuery != "q=1" {
			t.Errorf("query = %q", last.URL.RawQuery)
		}
	})

	t.Run("html rewritten and headers fixed", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/", map[string]string{"X-Test-User": "alice"})
		body := rec.Body.String()
		for _, want := range []string{`href="/app/demo/style.css"`, `src="/app/demo/logo.png"`, `/app/demo/__appproxy/shim.js`} {
			if !strings.Contains(body, want) {
				t.Errorf("body missing %q: %s", want, body)
			}
		}
		if rec.Header().Get("X-Frame-Options") != "" {
			t.Errorf("X-Frame-Options should be stripped")
		}
		if csp := rec.Header().Get("Content-Security-Policy"); strings.Contains(csp, "frame-ancestors") {
			t.Errorf("CSP still has frame-ancestors: %q", csp)
		}
		if c := rec.Header().Get("Set-Cookie"); !strings.Contains(c, "Path=/app/demo/") {
			t.Errorf("Set-Cookie not scoped: %q", c)
		}
	})

	t.Run("gzip html rewritten", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/gz", map[string]string{"X-Test-User": "alice", "Accept-Encoding": "gzip"})
		if rec.Header().Get("Content-Encoding") != "" {
			t.Errorf("rewritten body should be sent decoded")
		}
		if !strings.Contains(rec.Body.String(), `src="/app/demo/zipped.png"`) {
			t.Errorf("gzip body not rewritten: %q", rec.Body.String())
		}
	})

	t.Run("css rewritten", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/style.css", map[string]string{"X-Test-User": "alice"})
		if rec.Body.String() != `body{background:url(/app/demo/bg.png)}` {
			t.Errorf("css = %q", rec.Body.String())
		}
	})

	t.Run("redirects stay under the prefix", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/login", map[string]string{"X-Test-User": "alice"})
		if loc := rec.Header().Get("Location"); loc != "/app/demo/dashboard" {
			t.Errorf("Location = %q", loc)
		}
		rec = doRequest(m, "GET", "http://nas.local/app/demo/absolute", map[string]string{"X-Test-User": "alice"})
		if loc := rec.Header().Get("Location"); loc != "/app/demo/elsewhere" {
			t.Errorf("absolute Location = %q", loc)
		}
	})

	t.Run("shim served", func(t *testing.T) {
		rec := doRequest(m, "GET", "http://nas.local/app/demo/__appproxy/shim.js", map[string]string{"X-Test-User": "alice"})
		if !strings.Contains(rec.Body.String(), `"/app/demo"`) {
			t.Errorf("shim not served")
		}
	})
}

func TestPathModeAccess(t *testing.T) {
	up, _ := newUpstream(t)
	m := newTestManager(t, nil)
	ep := pathEndpoint("demo", upstreamTarget(up))
	ep.AllowedGroups = []string{"users"}
	if _, err := m.Save(ep, true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name     string
		target   string
		headers  map[string]string
		wantCode int
		wantLoc  string
	}{
		{"anonymous page load goes to login", "/app/demo/x", map[string]string{"Sec-Fetch-Mode": "navigate"}, http.StatusFound, "/login.html?redirect=/app/demo/x"},
		{"anonymous xhr is refused", "/app/demo/x", map[string]string{"Sec-Fetch-Mode": "cors"}, http.StatusUnauthorized, ""},
		{"wrong group", "/app/demo/x", map[string]string{"X-Test-User": "bob"}, http.StatusForbidden, ""},
		{"right group", "/app/demo/x", map[string]string{"X-Test-User": "alice"}, http.StatusOK, ""},
		{"admin", "/app/demo/x", map[string]string{"X-Test-User": "admin"}, http.StatusOK, ""},
		{"no trailing slash", "/app/demo", map[string]string{"X-Test-User": "alice"}, http.StatusFound, "/app/demo/"},
		{"unknown app", "/app/nope/", map[string]string{"X-Test-User": "alice"}, http.StatusNotFound, ""},
		{"bare /app/", "/app/", map[string]string{"X-Test-User": "alice"}, http.StatusNotFound, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doRequest(m, "GET", "http://nas.local"+tt.target, tt.headers)
			if rec.Code != tt.wantCode {
				t.Errorf("code = %d, want %d", rec.Code, tt.wantCode)
			}
			if tt.wantLoc != "" && rec.Header().Get("Location") != tt.wantLoc {
				t.Errorf("Location = %q, want %q", rec.Header().Get("Location"), tt.wantLoc)
			}
		})
	}
}

func TestLeakRedirect(t *testing.T) {
	up, _ := newUpstream(t)
	m := newTestManager(t, nil)
	if _, err := m.Save(pathEndpoint("demo", upstreamTarget(up)), true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}
	noRedirect := pathEndpoint("plain", upstreamTarget(up))
	noRedirect.RootRedirect = false
	if _, err := m.Save(noRedirect, true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		method  string
		target  string
		referer string
		extra   map[string]string
		handled bool
		wantLoc string
	}{
		{"asset from app page", "GET", "/script/jquery.min.js", "http://nas.local/app/demo/", nil, true, "/app/demo/script/jquery.min.js"},
		{"post keeps query", "POST", "/api/save?x=1", "http://nas.local/app/demo/edit", nil, true, "/app/demo/api/save?x=1"},
		{"favicon of the app", "GET", "/favicon.ico", "http://nas.local/app/demo/", nil, true, "/app/demo/favicon.ico"},
		{"arozos page untouched", "GET", "/script/jquery.min.js", "http://nas.local/desktop.html", nil, false, ""},
		{"no referer", "GET", "/desktop.html", "", nil, false, ""},
		{"login is exempt", "GET", "/login.html?redirect=/app/demo/", "http://nas.local/app/demo/", nil, false, ""},
		{"other host referer", "GET", "/x", "http://evil.example/app/demo/", nil, false, ""},
		{"cross-site fetch", "GET", "/x", "http://nas.local/app/demo/", map[string]string{"Sec-Fetch-Site": "cross-site"}, false, ""},
		{"redirect disabled for app", "GET", "/x", "http://nas.local/app/plain/", nil, false, ""},
		{"unknown app", "GET", "/x", "http://nas.local/app/gone/", nil, false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := map[string]string{"X-Test-User": "alice"}
			if tt.referer != "" {
				headers["Referer"] = tt.referer
			}
			for k, v := range tt.extra {
				headers[k] = v
			}
			rec := doRequest(m, tt.method, "http://nas.local"+tt.target, headers)
			if handled := rec.Code != -1; handled != tt.handled {
				t.Fatalf("handled = %v, want %v", handled, tt.handled)
			}
			if tt.handled {
				if rec.Code != http.StatusTemporaryRedirect {
					t.Errorf("code = %d, want 307", rec.Code)
				}
				if rec.Header().Get("Location") != tt.wantLoc {
					t.Errorf("Location = %q, want %q", rec.Header().Get("Location"), tt.wantLoc)
				}
			}
		})
	}
	if s := m.Stats("demo"); s.Leaks != 3 || s.LastLeaks[0] != "/favicon.ico" {
		t.Errorf("leak stats = %+v", s)
	}
}

func TestSubdomainMode(t *testing.T) {
	up, last := newUpstream(t)
	m := newTestManager(t, nil)
	ep := Endpoint{
		Slug: "media", Target: upstreamTarget(up), Mode: ModeSubdomain,
		Hostname: "media.example.com", PortalOrigin: "https://nas.example.com", RequireLogin: true,
	}
	if _, err := m.Save(ep, true, "admin", "nas.example.com"); err != nil {
		t.Fatal(err)
	}

	//1. The shortcut opens /app/media/ on the portal, which hands the login over
	rec := doRequest(m, "GET", "https://nas.example.com/app/media/library?x=1", map[string]string{"X-Test-User": "alice"})
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if rec.Code != http.StatusFound || loc.Host != "media.example.com" || loc.Path != claimPath {
		t.Fatalf("hand-off redirect = %d %q", rec.Code, rec.Header().Get("Location"))
	}
	ticketValue := loc.Query().Get("t")

	//2. Without a session the app host sends a page load back to the portal
	rec = doRequest(m, "GET", "https://media.example.com/library", map[string]string{"Sec-Fetch-Mode": "navigate"})
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "https://nas.example.com/app/media/library" {
		t.Errorf("anonymous app host = %d %q", rec.Code, rec.Header().Get("Location"))
	}

	//3. Claiming the ticket sets the app session and continues to the page
	rec = doRequest(m, "GET", "https://media.example.com"+claimPath+"?t="+ticketValue, map[string]string{"X-Forwarded-Proto": "https"})
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/library?x=1" {
		t.Fatalf("claim = %d %q", rec.Code, rec.Header().Get("Location"))
	}
	setCookie := rec.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, SessionCookie+"=") || !strings.Contains(setCookie, "HttpOnly") || !strings.Contains(setCookie, "Secure") {
		t.Errorf("session cookie = %q", setCookie)
	}
	session := strings.TrimPrefix(strings.Split(setCookie, ";")[0], SessionCookie+"=")

	//4. A ticket works once
	rec = doRequest(m, "GET", "https://media.example.com"+claimPath+"?t="+ticketValue, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("reused ticket = %d, want 403", rec.Code)
	}

	//5. With the session the app is proxied, without the session cookie
	rec = doRequest(m, "GET", "https://media.example.com/library", map[string]string{"Cookie": SessionCookie + "=" + session + "; theme=dark"})
	if rec.Body.String() != "path=/library" {
		t.Fatalf("proxied body = %q", rec.Body.String())
	}
	if got := last.Header.Get("Cookie"); got != "theme=dark" {
		t.Errorf("upstream cookies = %q", got)
	}

	//6. Root paths need no rewriting on its own host
	rec = doRequest(m, "GET", "https://media.example.com/", map[string]string{"Cookie": SessionCookie + "=" + session})
	if !strings.Contains(rec.Body.String(), `href="/style.css"`) || strings.Contains(rec.Body.String(), "shim.js") {
		t.Errorf("subdomain page should be untouched: %s", rec.Body.String())
	}

	//7. Editing the app ends its sessions
	if _, err := m.Save(ep, false, "admin", "nas.example.com"); err != nil {
		t.Fatal(err)
	}
	rec = doRequest(m, "GET", "https://media.example.com/library", map[string]string{"Cookie": SessionCookie + "=" + session})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("session after edit = %d, want 401", rec.Code)
	}
}

func TestSubdomainPublicApp(t *testing.T) {
	up, _ := newUpstream(t)
	m := newTestManager(t, nil)
	ep := Endpoint{
		Slug: "status", Target: upstreamTarget(up), Mode: ModeSubdomain,
		Hostname: "status.example.com", PortalOrigin: "https://nas.example.com",
	}
	if _, err := m.Save(ep, true, "admin", "nas.example.com"); err != nil {
		t.Fatal(err)
	}
	rec := doRequest(m, "GET", "https://nas.example.com/app/status/", nil)
	if rec.Header().Get("Location") != "https://status.example.com/" {
		t.Errorf("public hand-off = %q", rec.Header().Get("Location"))
	}
	rec = doRequest(m, "GET", "https://status.example.com/ping", nil)
	if rec.Body.String() != "path=/ping" {
		t.Errorf("public app = %d %q", rec.Code, rec.Body.String())
	}
}

func TestUpstreamDown(t *testing.T) {
	up, _ := newUpstream(t)
	target := upstreamTarget(up)
	up.Close()
	m := newTestManager(t, nil)
	if _, err := m.Save(pathEndpoint("down", target), true, "admin", "nas.local"); err != nil {
		t.Fatal(err)
	}
	rec := doRequest(m, "GET", "http://nas.local/app/down/", map[string]string{"X-Test-User": "alice"})
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "App unavailable") {
		t.Errorf("down upstream = %d %q", rec.Code, rec.Body.String())
	}
}

func TestUnrelatedRequestsPassThrough(t *testing.T) {
	m := newTestManager(t, nil)
	for _, p := range []string{"/", "/desktop.html", "/application/x", "/apps"} {
		if rec := doRequest(m, "GET", "http://nas.local"+p, nil); rec.Code != -1 {
			t.Errorf("%s should not be handled", p)
		}
	}
}
