package appproxy

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

/*
	proxy.go

	Request routing and the reverse proxy itself.

	HandleRequest is called first thing by the core router and claims:

	1. every request whose Host is a subdomain mode app hostname
	2. /app/<slug>/... on the ArozOS host
	3. "leaked" root requests: a request outside /app/ whose Referer is a
	   path mode app page, e.g. an app at /app/grafana/ asking for
	   /public/app.css. They are redirected (307) to /app/grafana/public/app.css,
	   so they never fall through to the ArozOS web root, and the redirected
	   document's own Referer keeps the chain inside the app.
*/

const (
	// SessionCookie is the login cookie of a subdomain mode app host
	SessionCookie = "ao_appsess"

	claimPath   = "/__appproxy/claim"
	maxCSSBytes = 8 << 20
)

// ArozOS paths a root request from an app is never redirected away from
var leakExemptPrefixes = []string{
	"/login.html",
	"/reset.html",
	"/system/auth/",
}

type ctxKey struct{}

// requestInfo travels with the proxied request to ModifyResponse
type requestInfo struct {
	rt         *endpointRuntime
	pathMode   bool
	prefix     string //Path mode prefix, "" in subdomain mode
	publicHost string
	scheme     string
}

func infoFrom(ctx context.Context) *requestInfo {
	info, _ := ctx.Value(ctxKey{}).(*requestInfo)
	return info
}

// requestScheme is the scheme the browser used, honouring a fronting proxy
func requestScheme(r *http.Request) string {
	if p := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])); p == "http" || p == "https" {
		return p
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

// isNavigation reports whether the browser expects a page (so a redirect to a
// login page makes sense) rather than data
func isNavigation(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" {
		return mode == "navigate"
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

func isWebSocket(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// safeReturnPath keeps a post-login return target on the same host
func safeReturnPath(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.ContainsAny(p, "\\\r\n") {
		return "/"
	}
	return p
}

// HandleRequest serves the request if it belongs to a container app and
// reports whether it did
func (m *Manager) HandleRequest(w http.ResponseWriter, r *http.Request) bool {
	if rt := m.runtimeByHost(r.Host); rt != nil {
		m.serveSubdomain(w, r, rt)
		return true
	}
	if r.URL.Path == "/app" || strings.HasPrefix(r.URL.Path, "/app/") {
		m.servePath(w, r)
		return true
	}
	return m.redirectLeak(w, r)
}

// servePath handles /app/<slug>/... on the ArozOS host
func (m *Manager) servePath(w http.ResponseWriter, r *http.Request) {
	slug, rest, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/app/"), "/")
	rt := m.runtimeBySlug(slug)
	if slug == "" || rt == nil {
		errorPage(w, http.StatusNotFound, "App not found", "This container app does not exist or has been removed.")
		return
	}
	ep := rt.ep
	prefix := ep.PathPrefix()
	if r.URL.Path == prefix {
		target := prefix + "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	rest = "/" + rest

	var id *Identity
	if ep.RequireLogin {
		id = m.opts.ResolveUser(w, r)
		if id == nil {
			m.denyAnonymous(w, r, m.opts.LoginURL(r.URL.RequestURI()))
			return
		}
	}
	if !ep.CanAccess(id) {
		errorPage(w, http.StatusForbidden, "Access denied", "You do not have permission to open this app.")
		return
	}

	if ep.Mode == ModeSubdomain {
		m.handOff(w, r, ep, id, rest)
		return
	}

	if ep.RewriteRoot && rest == shimPath {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(renderShim(prefix))
		return
	}

	out := r.Clone(context.WithValue(r.Context(), ctxKey{}, &requestInfo{
		rt:         rt,
		pathMode:   true,
		prefix:     prefix,
		publicHost: r.Host,
		scheme:     requestScheme(r),
	}))
	out.URL.Path = rest
	out.URL.RawPath = ""
	if raw := r.URL.RawPath; raw != "" && strings.HasPrefix(raw, prefix+"/") {
		out.URL.RawPath = strings.TrimPrefix(raw, prefix)
	}
	out.RequestURI = ""
	rt.requests.Add(1)
	rt.proxy.ServeHTTP(w, out)
}

// handOff sends a user from /app/<slug>/ on the ArozOS host to the app hostname
func (m *Manager) handOff(w http.ResponseWriter, r *http.Request, ep *Endpoint, id *Identity, rest string) {
	returnTo := rest
	if r.URL.RawQuery != "" {
		returnTo += "?" + r.URL.RawQuery
	}
	origin := ep.AppOrigin()
	if !ep.RequireLogin || id == nil {
		http.Redirect(w, r, origin+safeReturnPath(returnTo), http.StatusFound)
		return
	}
	t := m.sessions.issueTicket(id.Username, ep.Slug, safeReturnPath(returnTo))
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, origin+claimPath+"?t="+url.QueryEscape(t), http.StatusFound)
}

// AppOrigin is the origin a subdomain mode app is served on, following the
// scheme and port of the ArozOS portal
func (e *Endpoint) AppOrigin() string {
	portal, err := url.Parse(e.PortalOrigin)
	if err != nil || portal.Scheme == "" {
		return "https://" + e.Hostname
	}
	origin := portal.Scheme + "://" + e.Hostname
	if port := portal.Port(); port != "" {
		origin += ":" + port
	}
	return origin
}

// serveSubdomain handles every request on a subdomain mode app host
func (m *Manager) serveSubdomain(w http.ResponseWriter, r *http.Request, rt *endpointRuntime) {
	ep := rt.ep
	scheme := requestScheme(r)

	if r.URL.Path == claimPath {
		token, returnTo, ok := m.sessions.claimTicket(r.URL.Query().Get("t"), ep.Slug)
		if !ok {
			errorPageWithLink(w, http.StatusForbidden, "Sign in expired",
				"The sign in link has expired or was already used.",
				ep.PortalOrigin+ep.PathPrefix()+"/", "Try again")
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     SessionCookie,
			Value:    token,
			Path:     "/",
			MaxAge:   int(sessionTTL / time.Second),
			HttpOnly: true,
			Secure:   scheme == "https",
			SameSite: http.SameSiteLaxMode,
		})
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, safeReturnPath(returnTo), http.StatusFound)
		return
	}

	if ep.RequireLogin {
		token := ""
		if c, err := r.Cookie(SessionCookie); err == nil {
			token = c.Value
		}
		id := m.sessions.resolve(token, ep.Slug, m.opts.LookupUser)
		if id == nil {
			//Go back through the portal, which hands the login over again
			m.denyAnonymous(w, r, ep.PortalOrigin+ep.PathPrefix()+safeReturnPath(r.URL.RequestURI()))
			return
		}
		if !ep.CanAccess(id) {
			m.sessions.revoke(token)
			errorPage(w, http.StatusForbidden, "Access denied", "You do not have permission to open this app.")
			return
		}
	}

	out := r.WithContext(context.WithValue(r.Context(), ctxKey{}, &requestInfo{
		rt:         rt,
		publicHost: r.Host,
		scheme:     scheme,
	}))
	rt.requests.Add(1)
	rt.proxy.ServeHTTP(w, out)
}

// denyAnonymous redirects a page load to sign in, and refuses anything else
func (m *Manager) denyAnonymous(w http.ResponseWriter, r *http.Request, loginURL string) {
	w.Header().Set("Cache-Control", "no-store")
	if isNavigation(r) {
		http.Redirect(w, r, loginURL, http.StatusFound)
		return
	}
	http.Error(w, "401 - Unauthorized", http.StatusUnauthorized)
}

// leakSource returns the path mode app whose page issued a root request, or nil
func (m *Manager) leakSource(r *http.Request) *endpointRuntime {
	ref := r.Header.Get("Referer")
	if ref == "" || !strings.Contains(ref, "/app/") || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return nil
	}
	for _, p := range leakExemptPrefixes {
		if strings.HasPrefix(r.URL.Path, p) {
			return nil
		}
	}
	refURL, err := url.Parse(ref)
	if err != nil || !strings.EqualFold(refURL.Host, r.Host) || !strings.HasPrefix(refURL.Path, "/app/") {
		return nil
	}
	slug, _, _ := strings.Cut(strings.TrimPrefix(refURL.Path, "/app/"), "/")
	rt := m.runtimeBySlug(slug)
	if rt == nil || rt.ep.Mode != ModePath || !rt.ep.RootRedirect {
		return nil
	}
	return rt
}

// redirectLeak sends a root request made by a path mode app back under its prefix
func (m *Manager) redirectLeak(w http.ResponseWriter, r *http.Request) bool {
	rt := m.leakSource(r)
	if rt == nil {
		return false
	}
	rt.recordLeak(r.URL.Path)
	if isWebSocket(r) {
		//A websocket handshake cannot follow a redirect: route it directly
		prefixed := r.Clone(r.Context())
		prefixed.URL.Path = rt.ep.PathPrefix() + r.URL.Path
		prefixed.URL.RawPath = ""
		m.servePath(w, prefixed)
		return true
	}
	target := rt.ep.PathPrefix() + r.URL.EscapedPath()
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	return true
}

// reservedCookies are the cookie names never forwarded to a container
func (m *Manager) reservedCookies() map[string]bool {
	reserved := map[string]bool{SessionCookie: true}
	for _, c := range m.opts.StripCookies {
		reserved[c] = true
	}
	return reserved
}

// newReverseProxy builds the proxy of one endpoint
func (m *Manager) newReverseProxy(rt *endpointRuntime) *httputil.ReverseProxy {
	ep := rt.ep
	upstream := ep.UpstreamURL()
	transport := m.transport
	if ep.TargetTLS && ep.SkipTLSVerify {
		transport = m.insecureTransport
	}
	reserved := m.reservedCookies()

	return &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: 100 * time.Millisecond,
		Rewrite: func(pr *httputil.ProxyRequest) {
			info := infoFrom(pr.In.Context())
			pr.SetURL(upstream)
			pr.SetXForwarded()
			//Keep the host name the browser used, like most reverse proxies
			pr.Out.Host = pr.In.Host
			if info != nil {
				pr.Out.Header.Set("X-Forwarded-Proto", info.scheme)
				if info.pathMode {
					pr.Out.Header.Set("X-Forwarded-Prefix", info.prefix)
					//Present the Referer as the app would see it without the prefix
					if ref, err := url.Parse(pr.In.Header.Get("Referer")); err == nil && strings.EqualFold(ref.Host, pr.In.Host) && hasPrefixPath(ref.Path, info.prefix) {
						ref.Path = strings.TrimPrefix(ref.Path, info.prefix)
						if ref.Path == "" {
							ref.Path = "/"
						}
						ref.RawPath = ""
						pr.Out.Header.Set("Referer", ref.String())
					}
					if ep.RewriteRoot {
						//Only gzip can be decoded for rewriting
						if strings.Contains(pr.In.Header.Get("Accept-Encoding"), "gzip") {
							pr.Out.Header.Set("Accept-Encoding", "gzip")
						} else {
							pr.Out.Header.Set("Accept-Encoding", "identity")
						}
					}
				}
			}
			if cookies := pr.Out.Header.Values("Cookie"); len(cookies) > 0 {
				filtered := filterRequestCookies(strings.Join(cookies, "; "), reserved)
				pr.Out.Header.Del("Cookie")
				if filtered != "" {
					pr.Out.Header.Set("Cookie", filtered)
				}
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			return m.modifyResponse(resp, reserved)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if errors.Is(err, context.Canceled) {
				return
			}
			m.opts.Log("Container app "+ep.Name+" ("+ep.Target+") is not responding", err)
			errorPage(w, http.StatusBadGateway, "App unavailable", "The container behind this app is not responding. It may be stopped or still starting.")
		},
	}
}

// modifyResponse rewrites the upstream response headers and, when enabled, body
func (m *Manager) modifyResponse(resp *http.Response, reserved map[string]bool) error {
	info := infoFrom(resp.Request.Context())
	if info == nil {
		return nil
	}
	ep := info.rt.ep
	knownHosts := []string{info.publicHost, ep.Target}

	if loc := resp.Header.Get("Location"); loc != "" {
		resp.Header.Set("Location", rewriteLocation(loc, info, ep))
	}
	if cookies := resp.Header.Values("Set-Cookie"); len(cookies) > 0 {
		resp.Header.Del("Set-Cookie")
		for _, c := range cookies {
			resp.Header.Add("Set-Cookie", rewriteSetCookie(c, info.prefix, reserved))
		}
	}
	if ep.AllowFraming {
		resp.Header.Del("X-Frame-Options")
		for _, h := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
			values := resp.Header.Values(h)
			if len(values) == 0 {
				continue
			}
			resp.Header.Del(h)
			for _, v := range values {
				if stripped := stripFrameAncestors(v); stripped != "" {
					resp.Header.Add(h, stripped)
				}
			}
		}
	}
	if !info.pathMode {
		return nil
	}

	if ep.RootRedirect {
		if fixed := fixReferrerPolicy(resp.Header.Values("Referrer-Policy")); fixed != "" {
			resp.Header.Set("Referrer-Policy", fixed)
		}
	}
	if refresh := resp.Header.Get("Refresh"); refresh != "" {
		resp.Header.Set("Refresh", rewriteMetaRefresh(refresh, info.prefix, knownHosts))
	}
	if !ep.RewriteRoot || resp.Request.Method == http.MethodHead || resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotModified {
		return nil
	}

	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	isHTML := mediaType == "text/html" || mediaType == "application/xhtml+xml"
	isCSS := mediaType == "text/css"
	if !isHTML && !isCSS {
		return nil
	}
	encoding := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding")))
	if encoding != "" && encoding != "identity" && encoding != "gzip" {
		//Cannot decode it, pass through untouched
		return nil
	}

	body := resp.Body
	if encoding == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			//Not really gzip, leave it alone
			return nil
		}
		body = struct {
			io.Reader
			io.Closer
		}{gz, resp.Body}
		resp.Header.Del("Content-Encoding")
	}
	resp.Header.Del("Content-Length")
	resp.Header.Del("Content-MD5")
	resp.Header.Del("ETag")
	resp.ContentLength = -1

	if isCSS {
		data, err := io.ReadAll(io.LimitReader(body, maxCSSBytes+1))
		if err != nil || len(data) > maxCSSBytes {
			//Too large (or broken) to rewrite: stream it unchanged
			resp.Body = struct {
				io.Reader
				io.Closer
			}{io.MultiReader(bytes.NewReader(data), body), body}
			return nil
		}
		body.Close()
		rewritten := rewriteCSS(string(data), info.prefix, knownHosts)
		resp.Body = io.NopCloser(strings.NewReader(rewritten))
		resp.ContentLength = int64(len(rewritten))
		resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
		return nil
	}

	//HTML is rewritten as a stream
	pr, pw := io.Pipe()
	go func() {
		err := rewriteHTML(body, pw, info.prefix, knownHosts, info.prefix+shimPath)
		body.Close()
		pw.CloseWithError(err)
	}()
	resp.Body = pr
	return nil
}

// rewriteLocation maps a redirect of the app onto its public address
func rewriteLocation(loc string, info *requestInfo, ep *Endpoint) string {
	if info.pathMode {
		return rewriteURL(loc, info.prefix, []string{info.publicHost, ep.Target})
	}
	u, err := url.Parse(loc)
	if err != nil || !strings.EqualFold(u.Host, ep.Target) {
		return loc
	}
	u.Scheme = info.scheme
	u.Host = info.publicHost
	return u.String()
}

// errorPage renders a small self-contained error page
func errorPage(w http.ResponseWriter, status int, title string, message string) {
	errorPageWithLink(w, status, title, message, "", "")
}

func errorPageWithLink(w http.ResponseWriter, status int, title string, message string, link string, linkText string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	action := ""
	if link != "" {
		action = `<p><a href="` + html.EscapeString(link) + `">` + html.EscapeString(linkText) + `</a></p>`
	}
	io.WriteString(w, `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>`+
		html.EscapeString(title)+`</title><style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;min-height:100vh}
@media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#f5f5f7}.card{background:#2c2c2e!important}}
.card{background:#fff;border-radius:12px;padding:28px 32px;max-width:420px;box-shadow:0 6px 20px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;margin:0 0 8px;opacity:.8}a{color:#0a84ff}
.code{font-size:12px;opacity:.5;margin-bottom:6px}</style></head><body><div class="card"><div class="code">`+
		strconv.Itoa(status)+`</div><h1>`+html.EscapeString(title)+`</h1><p>`+html.EscapeString(message)+`</p>`+action+`</div></body></html>`)
}
