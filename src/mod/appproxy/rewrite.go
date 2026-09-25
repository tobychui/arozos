package appproxy

import (
	"bytes"
	"io"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

/*
	rewrite.go

	Keeps an app that assumes it owns "/" working under /app/<slug>/.

	- rewriteURL        root-absolute and same-host absolute URLs -> prefixed
	- rewriteHTML       URL attributes, <base>, <style>, style="", meta refresh,
	                    plus the rewrite script injected first in <head>
	- rewriteCSS        url(...) and @import
	- rewriteSetCookie  scope a container cookie to the prefix and keep it
	                    away from the ArozOS cookie names
	- stripFrameAncestors / fixReferrerPolicy for response headers

	Everything here is a pure function so it can be unit tested.
*/

// renamedCookiePrefix marks a container cookie renamed to avoid an ArozOS name
const renamedCookiePrefix = "aoc_"

// hasPrefixPath reports whether p already lives under prefix
func hasPrefixPath(p string, prefix string) bool {
	if !strings.HasPrefix(p, prefix) {
		return false
	}
	rest := p[len(prefix):]
	return rest == "" || rest[0] == '/' || rest[0] == '?' || rest[0] == '#'
}

// rewriteURL maps a URL an app emitted into the prefixed namespace. knownHosts
// are hosts that mean "this app" (the public host and the upstream address)
func rewriteURL(raw string, prefix string, knownHosts []string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return raw
	}
	if strings.HasPrefix(trimmed, "//") {
		u, err := url.Parse("http:" + trimmed)
		if err != nil || !hostKnown(u.Host, knownHosts) {
			return raw
		}
		return prefixPath(u, prefix)
	}
	if strings.HasPrefix(trimmed, "/") {
		if hasPrefixPath(trimmed, prefix) {
			return raw
		}
		return prefix + trimmed
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		u, err := url.Parse(trimmed)
		if err != nil || !hostKnown(u.Host, knownHosts) {
			return raw
		}
		return prefixPath(u, prefix)
	}
	return raw
}

// prefixPath renders a parsed URL as a prefixed, origin-relative URL
func prefixPath(u *url.URL, prefix string) string {
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	if !hasPrefixPath(p, prefix) {
		p = prefix + p
	}
	if u.RawQuery != "" || u.ForceQuery {
		p += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		p += "#" + u.EscapedFragment()
	}
	return p
}

func hostKnown(host string, knownHosts []string) bool {
	host = strings.ToLower(host)
	for _, h := range knownHosts {
		if h != "" && strings.ToLower(h) == host {
			return true
		}
	}
	return false
}

var (
	cssURLRegex    = regexp.MustCompile(`(?i)url\(\s*(['"]?)([^'")]+?)(['"]?)\s*\)`)
	cssImportRegex = regexp.MustCompile(`(?i)@import\s+(['"])([^'"]+)(['"])`)
)

// rewriteCSS prefixes root paths in url(...) and @import
func rewriteCSS(css string, prefix string, knownHosts []string) string {
	css = cssURLRegex.ReplaceAllStringFunc(css, func(m string) string {
		parts := cssURLRegex.FindStringSubmatch(m)
		if parts[1] != parts[3] || strings.HasPrefix(strings.ToLower(parts[2]), "data:") {
			return m
		}
		return "url(" + parts[1] + rewriteURL(parts[2], prefix, knownHosts) + parts[3] + ")"
	})
	return cssImportRegex.ReplaceAllStringFunc(css, func(m string) string {
		parts := cssImportRegex.FindStringSubmatch(m)
		if parts[1] != parts[3] {
			return m
		}
		return "@import " + parts[1] + rewriteURL(parts[2], prefix, knownHosts) + parts[3]
	})
}

// rewriteSrcset prefixes each candidate URL of a srcset attribute
func rewriteSrcset(v string, prefix string, knownHosts []string) string {
	candidates := strings.Split(v, ",")
	for i, c := range candidates {
		fields := strings.Fields(c)
		if len(fields) == 0 {
			continue
		}
		fields[0] = rewriteURL(fields[0], prefix, knownHosts)
		candidates[i] = strings.Join(fields, " ")
	}
	return strings.Join(candidates, ", ")
}

// rewriteMetaRefresh prefixes the url= part of a meta refresh value
func rewriteMetaRefresh(v string, prefix string, knownHosts []string) string {
	lower := strings.ToLower(v)
	idx := strings.Index(lower, "url=")
	if idx < 0 {
		return v
	}
	target := v[idx+4:]
	quote := ""
	if len(target) > 0 && (target[0] == '\'' || target[0] == '"') {
		quote = target[:1]
		target = strings.TrimSuffix(target[1:], quote)
	}
	return v[:idx+4] + quote + rewriteURL(target, prefix, knownHosts) + quote
}

// URL carrying attributes rewritten on any element
var urlAttributes = map[string]bool{
	"href": true, "src": true, "action": true, "formaction": true,
	"poster": true, "data": true, "background": true, "manifest": true,
	"xlink:href": true,
}

// referrer policies that still send the full URL to the same origin
var fullSameOriginReferrer = map[string]bool{
	"no-referrer-when-downgrade":      true,
	"same-origin":                     true,
	"origin-when-cross-origin":        true,
	"strict-origin-when-cross-origin": true,
	"unsafe-url":                      true,
}

// rewriteTag rewrites the attributes of one start tag, reporting whether anything changed
func rewriteTag(t *html.Token, prefix string, knownHosts []string) bool {
	changed := false
	isMetaRefresh := false
	isMetaReferrer := false
	if t.Data == "meta" {
		for _, a := range t.Attr {
			if strings.EqualFold(a.Key, "http-equiv") && strings.EqualFold(strings.TrimSpace(a.Val), "refresh") {
				isMetaRefresh = true
			}
			if strings.EqualFold(a.Key, "name") && strings.EqualFold(strings.TrimSpace(a.Val), "referrer") {
				isMetaReferrer = true
			}
		}
	}
	for i := range t.Attr {
		a := &t.Attr[i]
		key := strings.ToLower(a.Key)
		if a.Namespace != "" {
			key = strings.ToLower(a.Namespace) + ":" + key
		}
		newVal := a.Val
		switch {
		case urlAttributes[key]:
			newVal = rewriteURL(a.Val, prefix, knownHosts)
		case key == "srcset" || key == "imagesrcset":
			newVal = rewriteSrcset(a.Val, prefix, knownHosts)
		case key == "style":
			newVal = rewriteCSS(a.Val, prefix, knownHosts)
		case key == "content" && isMetaRefresh:
			newVal = rewriteMetaRefresh(a.Val, prefix, knownHosts)
		case key == "content" && isMetaReferrer:
			if !fullSameOriginReferrer[strings.ToLower(strings.TrimSpace(a.Val))] {
				newVal = "strict-origin-when-cross-origin"
			}
		}
		if newVal != a.Val {
			a.Val = newVal
			changed = true
		}
	}
	return changed
}

// rewriteHTML rewrites an HTML document for the prefix. When shimSrc is not
// empty a blocking <script src> is placed first in <head> so it runs before
// any script of the app
func rewriteHTML(r io.Reader, dst io.Writer, prefix string, knownHosts []string, shimSrc string) error {
	z := html.NewTokenizer(r)
	w := &errWriter{w: dst}
	injected := shimSrc == ""
	inStyle := false
	shimTag := []byte(`<script src="` + html.EscapeString(shimSrc) + `"></script>`)

	for {
		if w.err != nil {
			//The reader went away, stop early
			return w.err
		}
		tt := z.Next()
		if tt == html.ErrorToken {
			if z.Err() == io.EOF {
				return nil
			}
			return z.Err()
		}
		raw := z.Raw()
		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			t := z.Token()
			if !injected && t.Data != "html" && t.Data != "head" {
				//No <head> before content: inject before the first real tag
				w.Write(shimTag)
				injected = true
			}
			if rewriteTag(&t, prefix, knownHosts) {
				io.WriteString(w, t.String())
			} else {
				w.Write(raw)
			}
			if t.Data == "head" && !injected {
				w.Write(shimTag)
				injected = true
			}
			inStyle = tt == html.StartTagToken && t.Data == "style"
		case html.TextToken:
			if inStyle {
				io.WriteString(w, rewriteCSS(string(raw), prefix, knownHosts))
			} else {
				w.Write(raw)
			}
		case html.EndTagToken:
			inStyle = false
			w.Write(raw)
		default:
			w.Write(raw)
		}
	}
}

// errWriter remembers the first write error so a long rewrite can stop early
type errWriter struct {
	w   io.Writer
	err error
}

func (e *errWriter) Write(p []byte) (int, error) {
	if e.err != nil {
		return 0, e.err
	}
	n, err := e.w.Write(p)
	e.err = err
	return n, err
}

// rewriteHTMLString is a convenience wrapper used by tests
func rewriteHTMLString(doc string, prefix string, knownHosts []string, shimSrc string) string {
	var buf bytes.Buffer
	rewriteHTML(strings.NewReader(doc), &buf, prefix, knownHosts, shimSrc)
	return buf.String()
}

// rewriteSetCookie scopes one Set-Cookie header value. In path mode the cookie
// path is moved under prefix; in both modes Domain is dropped (the browser
// only ever sees the public host) and names that clash with ArozOS cookies
// are renamed
func rewriteSetCookie(v string, prefix string, reserved map[string]bool) string {
	parts := strings.Split(v, ";")
	if len(parts) == 0 {
		return v
	}
	name, value, ok := strings.Cut(parts[0], "=")
	if !ok {
		return v
	}
	name = strings.TrimSpace(name)
	if cookieNameReserved(name, reserved) {
		name = renamedCookiePrefix + name
	}
	out := []string{name + "=" + value}
	for _, attr := range parts[1:] {
		key, val, _ := strings.Cut(strings.TrimSpace(attr), "=")
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "domain":
			continue
		case "path":
			if prefix != "" {
				p := strings.TrimSpace(val)
				if p == "" || !strings.HasPrefix(p, "/") {
					p = "/"
				}
				if !hasPrefixPath(p, prefix) {
					p = prefix + p
				}
				out = append(out, "Path="+p)
				continue
			}
		}
		out = append(out, strings.TrimSpace(attr))
	}
	return strings.Join(out, "; ")
}

// cookieNameReserved reports whether a container may not use a cookie name as is
func cookieNameReserved(name string, reserved map[string]bool) bool {
	return reserved[name] || strings.HasPrefix(name, "ao_") || strings.HasPrefix(name, renamedCookiePrefix)
}

// filterRequestCookies removes ArozOS cookies from a Cookie header and gives
// renamed container cookies their original name back
func filterRequestCookies(header string, reserved map[string]bool) string {
	kept := []string{}
	for _, c := range strings.Split(header, ";") {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		name, value, _ := strings.Cut(c, "=")
		if strings.HasPrefix(name, renamedCookiePrefix) {
			kept = append(kept, strings.TrimPrefix(name, renamedCookiePrefix)+"="+value)
			continue
		}
		if cookieNameReserved(name, reserved) {
			continue
		}
		kept = append(kept, c)
	}
	return strings.Join(kept, "; ")
}

// stripFrameAncestors removes the frame-ancestors directive from a CSP value
func stripFrameAncestors(policy string) string {
	kept := []string{}
	for _, d := range strings.Split(policy, ";") {
		d = strings.TrimSpace(d)
		if d == "" || strings.HasPrefix(strings.ToLower(d), "frame-ancestors") {
			continue
		}
		kept = append(kept, d)
	}
	return strings.Join(kept, "; ")
}

// fixReferrerPolicy makes sure same-origin requests keep carrying the full
// Referer, which the root redirect depends on. Empty means leave the header
func fixReferrerPolicy(values []string) string {
	effective := ""
	for _, v := range values {
		for _, p := range strings.Split(v, ",") {
			p = strings.ToLower(strings.TrimSpace(p))
			if p != "" {
				effective = p
			}
		}
	}
	if effective == "" || fullSameOriginReferrer[effective] {
		return ""
	}
	return "strict-origin-when-cross-origin"
}
