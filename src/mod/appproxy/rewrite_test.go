package appproxy

import (
	"strings"
	"testing"
)

var testHosts = []string{"nas.example.com", "127.0.0.1:8081"}

func TestRewriteURL(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"/static/app.js", "/app/g/static/app.js"},
		{"/", "/app/g/"},
		{"/app/g/already", "/app/g/already"},
		{"/app/g", "/app/g"},
		{"/app/grafana/x", "/app/g/app/grafana/x"},
		{"relative/path.png", "relative/path.png"},
		{"../up.css", "../up.css"},
		{"#anchor", "#anchor"},
		{"data:image/png;base64,AAA", "data:image/png;base64,AAA"},
		{"javascript:void(0)", "javascript:void(0)"},
		{"https://cdn.example.org/lib.js", "https://cdn.example.org/lib.js"},
		{"https://nas.example.com/login?next=1#top", "/app/g/login?next=1#top"},
		{"http://127.0.0.1:8081/api", "/app/g/api"},
		{"//nas.example.com/x", "/app/g/x"},
		{"//cdn.example.org/x", "//cdn.example.org/x"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := rewriteURL(tt.in, "/app/g", testHosts); got != tt.want {
			t.Errorf("rewriteURL(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestRewriteCSS(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{`body{background:url(/img/bg.png)}`, `body{background:url(/app/g/img/bg.png)}`},
		{`a{b:url( "/f.woff2" )}`, `a{b:url("/app/g/f.woff2")}`},
		{`a{b:url('rel.png')}`, `a{b:url('rel.png')}`},
		{`@import "/theme.css";`, `@import "/app/g/theme.css";`},
		{`a{b:url(data:image/png;base64,AAA)}`, `a{b:url(data:image/png;base64,AAA)}`},
	}
	for _, tt := range tests {
		if got := rewriteCSS(tt.in, "/app/g", testHosts); got != tt.want {
			t.Errorf("rewriteCSS(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestRewriteSrcsetAndRefresh(t *testing.T) {
	if got := rewriteSrcset("/a.png 1x, b.png 2x", "/app/g", testHosts); got != "/app/g/a.png 1x, b.png 2x" {
		t.Errorf("srcset = %q", got)
	}
	if got := rewriteMetaRefresh("0; url=/login", "/app/g", testHosts); got != "0; url=/app/g/login" {
		t.Errorf("refresh = %q", got)
	}
	if got := rewriteMetaRefresh("5;URL='/x'", "/app/g", testHosts); got != "5;URL='/app/g/x'" {
		t.Errorf("quoted refresh = %q", got)
	}
	if got := rewriteMetaRefresh("30", "/app/g", testHosts); got != "30" {
		t.Errorf("plain refresh = %q", got)
	}
}

func TestRewriteHTML(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		contains []string
		absent   []string
	}{
		{
			name: "attributes, base and shim",
			in:   `<!DOCTYPE html><html><head><base href="/"><link rel="stylesheet" href="/main.css"></head><body><img src="/logo.png" srcset="/l2.png 2x"><a href="page.html">x</a><form action="/login"></form></body></html>`,
			contains: []string{
				`<head><script src="/app/g/__appproxy/shim.js"></script>`,
				`<base href="/app/g/">`, `href="/app/g/main.css"`, `src="/app/g/logo.png"`,
				`srcset="/app/g/l2.png 2x"`, `<a href="page.html">`, `action="/app/g/login"`,
			},
		},
		{
			name:     "style element and attribute",
			in:       `<head><style>.a{background:url(/bg.png)}</style></head><div style="background:url('/x.png')"></div>`,
			contains: []string{`url(/app/g/bg.png)`, `url(&#39;/app/g/x.png&#39;)`},
		},
		{
			name:     "script bodies are left alone",
			in:       `<head></head><script>fetch("/api/data")</script>`,
			contains: []string{`fetch("/api/data")`},
		},
		{
			name:     "no head tag",
			in:       `<div><img src="/a.png"></div>`,
			contains: []string{`<script src="/app/g/__appproxy/shim.js"></script><div>`},
		},
		{
			name:     "meta referrer relaxed",
			in:       `<head><meta name="referrer" content="no-referrer"></head>`,
			contains: []string{`content="strict-origin-when-cross-origin"`},
			absent:   []string{`no-referrer"`},
		},
		{
			name:     "untouched tags keep their raw form",
			in:       `<head></head><p CLASS='x'>hi</p>`,
			contains: []string{`<p CLASS='x'>hi</p>`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := rewriteHTMLString(tt.in, "/app/g", testHosts, "/app/g/__appproxy/shim.js")
			for _, want := range tt.contains {
				if !strings.Contains(got, want) {
					t.Errorf("output missing %q\n got: %s", want, got)
				}
			}
			for _, bad := range tt.absent {
				if strings.Contains(got, bad) {
					t.Errorf("output should not contain %q\n got: %s", bad, got)
				}
			}
			if strings.Count(got, "shim.js") != 1 {
				t.Errorf("shim injected %d times", strings.Count(got, "shim.js"))
			}
		})
	}
}

func TestRewriteHTMLWithoutShim(t *testing.T) {
	got := rewriteHTMLString(`<head></head><img src="/a.png">`, "/app/g", testHosts, "")
	if strings.Contains(got, "<script") {
		t.Errorf("no shim expected: %s", got)
	}
}

func TestRewriteSetCookie(t *testing.T) {
	reserved := map[string]bool{"ao_auth": true}
	tests := []struct {
		name   string
		in     string
		prefix string
		want   string
	}{
		{"path moved under prefix", "sid=1; Path=/; HttpOnly", "/app/g", "sid=1; Path=/app/g/; HttpOnly"},
		{"sub path", "sid=1; path=/api", "/app/g", "sid=1; Path=/app/g/api"},
		{"domain dropped", "sid=1; Domain=127.0.0.1; Secure", "/app/g", "sid=1; Secure"},
		{"no path left alone", "sid=1; Max-Age=60", "/app/g", "sid=1; Max-Age=60"},
		{"reserved name renamed", "ao_auth=evil; Path=/", "/app/g", "aoc_ao_auth=evil; Path=/app/g/"},
		{"subdomain keeps path", "sid=1; Path=/x; Domain=a.b", "", "sid=1; Path=/x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rewriteSetCookie(tt.in, tt.prefix, reserved); got != tt.want {
				t.Errorf("rewriteSetCookie = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFilterRequestCookies(t *testing.T) {
	reserved := map[string]bool{"ao_auth": true, "ao_appsess": true}
	tests := []struct {
		in   string
		want string
	}{
		{"ao_auth=secret; sid=1", "sid=1"},
		{"ao_appsess=x", ""},
		{"aoc_ao_auth=mine; theme=dark", "ao_auth=mine; theme=dark"},
		{"ao_other=1; a=2", "a=2"},
	}
	for _, tt := range tests {
		if got := filterRequestCookies(tt.in, reserved); got != tt.want {
			t.Errorf("filterRequestCookies(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestHeaderHelpers(t *testing.T) {
	if got := stripFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *"); got != "default-src 'self'; img-src *" {
		t.Errorf("stripFrameAncestors = %q", got)
	}
	if got := stripFrameAncestors("frame-ancestors 'none'"); got != "" {
		t.Errorf("stripFrameAncestors only directive = %q", got)
	}
	policies := []struct {
		in   []string
		want string
	}{
		{nil, ""},
		{[]string{"no-referrer"}, "strict-origin-when-cross-origin"},
		{[]string{"same-origin"}, ""},
		{[]string{"no-referrer, strict-origin-when-cross-origin"}, ""},
		{[]string{"origin"}, "strict-origin-when-cross-origin"},
	}
	for _, p := range policies {
		if got := fixReferrerPolicy(p.in); got != p.want {
			t.Errorf("fixReferrerPolicy(%v) = %q, want %q", p.in, got, p.want)
		}
	}
}

func TestRenderShim(t *testing.T) {
	js := string(renderShim("/app/g"))
	if !strings.Contains(js, `var P = "/app/g";`) {
		t.Errorf("prefix not embedded")
	}
	if strings.Contains(js, "__PREFIX__") {
		t.Errorf("placeholder left in shim")
	}
}
