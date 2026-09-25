package appproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecideVerdict(t *testing.T) {
	tests := []struct {
		name  string
		page  string
		hints int
		image string
		want  string
	}{
		{"relative only", `<html><head><title>Demo</title><link href="style.css"></head><img src="img/a.png"></html>`, 0, "", VerdictPath},
		{"root refs", `<link href="/style.css"><img src="/a.png">`, 0, "", VerdictPathRewrite},
		{"runtime hints", `<script src="app.js"></script>`, 3, "", VerdictPathRewrite},
		{"base href root", `<base href="/"><script src="main.js"></script>`, 0, "", VerdictSubdomain},
		{"next.js", `<script src="/_next/static/chunks/main.js"></script>`, 0, "", VerdictSubdomain},
		{"vite is rewritable", `<script type="module" src="/assets/index-abc.js"></script>`, 0, "", VerdictPathRewrite},
		{"known app wins", `<img src="img/a.png">`, 0, "ghcr.io/home-assistant/home-assistant:stable", VerdictSubdomain},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := ProbeResult{Reachable: true}
			analyzePage(tt.page, "127.0.0.1:8081", &res)
			res.ScriptHints = tt.hints
			decideVerdict(&res, matchKnownApp(tt.image), "/app/x")
			if res.Verdict != tt.want {
				t.Errorf("verdict = %q, want %q (reasons %v)", res.Verdict, tt.want, res.Reasons)
			}
			if len(res.Reasons) == 0 {
				t.Errorf("a verdict should come with a reason")
			}
		})
	}
}

func TestAnalyzePage(t *testing.T) {
	res := ProbeResult{}
	scripts := analyzePage(`<title> My App </title><a href="#top"></a><a href="mailto:x@y"></a><img src="data:x">`+
		`<a href="http://127.0.0.1:8081/x"></a><script src="/a.js"></script><script src="b.js"></script>`, "127.0.0.1:8081", &res)
	if res.Title != "My App" {
		t.Errorf("Title = %q", res.Title)
	}
	if res.RootRefs != 1 || res.RelativeRefs != 1 || res.SelfRefs != 1 {
		t.Errorf("refs root=%d rel=%d self=%d", res.RootRefs, res.RelativeRefs, res.SelfRefs)
	}
	if len(scripts) != 2 {
		t.Errorf("scripts = %v", scripts)
	}
}

func TestProbe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("X-Frame-Options", "SAMEORIGIN")
			io.WriteString(w, `<html><head><title>Probe Me</title></head><body><script src="bundle.js"></script></body></html>`)
		case "/bundle.js":
			io.WriteString(w, `fetch("/api/items");new WebSocket("/ws/live")`)
		}
	}))
	defer srv.Close()

	m := newTestManager(t, nil)
	res := m.Probe(strings.TrimPrefix(srv.URL, "http://"), false, false, "", "demo")
	if !res.Reachable || res.Title != "Probe Me" {
		t.Fatalf("probe = %+v", res)
	}
	if res.ScriptHints != 2 {
		t.Errorf("ScriptHints = %d, want 2", res.ScriptHints)
	}
	if !res.FrameBlocked {
		t.Errorf("FrameBlocked not detected")
	}
	if res.Verdict != VerdictPathRewrite {
		t.Errorf("verdict = %q", res.Verdict)
	}

	down := m.Probe("127.0.0.1:1", false, false, "grafana/grafana", "g")
	if down.Reachable || down.Verdict != VerdictPath || !strings.Contains(strings.Join(down.Reasons, " "), "/app/g") {
		t.Errorf("unreachable known app = %+v", down)
	}
}
