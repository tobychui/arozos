package appproxy

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

/*
	probe.go

	Detection: before an admin publishes an app, fetch its start page and
	guess whether it can live under /app/<slug>/.

	- root references (src="/x") in the page         -> needs rewriting
	- relative references only                       -> works under a path
	- <base href="/"> or a framework that hardcodes
	  its asset root (Next.js, Nuxt, SvelteKit)      -> prefer subdomain
	- root URL strings inside the first bundles      -> runtime requests need
	                                                    the rewrite script
	- a small table of well known images overrides the guess

	The runtime complement is the leak counter in Stats: every root request
	the redirect catches is counted, so an admin sees how "leaky" an app is.
*/

const (
	VerdictPath        = "path"         //Works under /app/<slug>/ as is
	VerdictPathRewrite = "path-rewrite" //Needs root path rewriting under /app/<slug>/
	VerdictSubdomain   = "subdomain"    //Give it its own hostname

	probeTimeout    = 8 * time.Second
	maxProbePage    = 2 << 20
	maxProbeScript  = 3 << 20
	maxProbeScripts = 4
)

// ProbeResult describes how an app references its own resources
type ProbeResult struct {
	Reachable    bool
	Status       int
	Error        string
	Title        string
	RootRefs     int      //src/href/action values starting with "/"
	RelativeRefs int      //Relative src/href/action values
	SelfRefs     int      //Absolute URLs pointing at the upstream address
	BaseHrefRoot bool     //<base href="/">
	Frameworks   []string //Recognised front-end frameworks
	ScriptHints  int      //Root URL strings found in the first scripts
	FrameBlocked bool     //X-Frame-Options / frame-ancestors forbid a desktop window
	KnownApp     string   //Name of a recognised image
	Verdict      string
	Reasons      []string
}

type knownApp struct {
	match   []string
	name    string
	verdict string
	note    string
}

// Images whose sub-path behaviour is well known. note may use {prefix}
var knownApps = []knownApp{
	{[]string{"home-assistant", "homeassistant"}, "Home Assistant", VerdictSubdomain, "Home Assistant cannot run under a sub-path. Use subdomain mode."},
	{[]string{"uptime-kuma"}, "Uptime Kuma", VerdictSubdomain, "Uptime Kuma does not support a sub-path. Use subdomain mode."},
	{[]string{"nextcloud"}, "Nextcloud", VerdictSubdomain, "Nextcloud needs overwritewebroot for a sub-path, subdomain mode is simpler."},
	{[]string{"grafana"}, "Grafana", VerdictPath, "Set GF_SERVER_ROOT_URL to <your ArozOS URL>{prefix}/ and GF_SERVER_SERVE_FROM_SUB_PATH=true."},
	{[]string{"jellyfin"}, "Jellyfin", VerdictPath, "Set Dashboard > Networking > Base URL to {prefix}."},
	{[]string{"sonarr", "radarr", "lidarr", "prowlarr", "readarr"}, "*arr", VerdictPath, "Set Settings > General > URL Base to {prefix}."},
	{[]string{"filebrowser"}, "File Browser", VerdictPath, "Start it with --baseurl {prefix}."},
	{[]string{"code-server"}, "code-server", VerdictPath, "code-server works under a sub-path as is."},
	{[]string{"syncthing"}, "Syncthing", VerdictPath, "The Syncthing GUI works under a sub-path as is."},
	{[]string{"qbittorrent"}, "qBittorrent", VerdictPath, "The qBittorrent Web UI works under a sub-path as is."},
}

var (
	scriptRootHint = regexp.MustCompile("[\"'`]/(api|static|assets|socket\\.io|ws|graphql|auth|login|_next|_nuxt|_app)[/\"'`?]")
	frameworkHints = []struct {
		name    string
		pattern string
		rooted  bool //Hardcodes its asset root, rewriting is fragile
	}{
		{"Next.js", "/_next/", true},
		{"Nuxt", "/_nuxt/", true},
		{"SvelteKit", "/_app/immutable/", true},
		{"Vite", "/assets/index-", false},
		{"Create React App", "/static/js/main.", false},
		{"Angular", "ng-version", false},
	}
)

// matchKnownApp finds the well known entry of an image, or nil
func matchKnownApp(image string) *knownApp {
	image = strings.ToLower(image)
	if image == "" {
		return nil
	}
	for i := range knownApps {
		for _, m := range knownApps[i].match {
			if strings.Contains(image, m) {
				return &knownApps[i]
			}
		}
	}
	return nil
}

// classifyRef sorts one URL found in the page
func classifyRef(v string, upstreamHost string, res *ProbeResult) {
	v = strings.TrimSpace(v)
	lower := strings.ToLower(v)
	switch {
	case v == "" || strings.HasPrefix(v, "#"):
	case strings.HasPrefix(lower, "data:"), strings.HasPrefix(lower, "javascript:"), strings.HasPrefix(lower, "mailto:"), strings.HasPrefix(lower, "blob:"):
	case strings.HasPrefix(v, "//"), strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		if u, err := url.Parse(v); err == nil && strings.EqualFold(u.Host, upstreamHost) {
			res.SelfRefs++
		}
	case strings.HasPrefix(v, "/"):
		res.RootRefs++
	default:
		res.RelativeRefs++
	}
}

// analyzePage fills the page level findings and returns the script URLs worth scanning
func analyzePage(page string, upstreamHost string, res *ProbeResult) []string {
	scripts := []string{}
	z := html.NewTokenizer(strings.NewReader(page))
	inTitle := false
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			t := z.Token()
			inTitle = t.Data == "title" && tt == html.StartTagToken
			for _, a := range t.Attr {
				key := strings.ToLower(a.Key)
				switch key {
				case "src", "href", "action", "poster":
					if t.Data == "base" && key == "href" {
						if strings.TrimSpace(a.Val) == "/" {
							res.BaseHrefRoot = true
						}
						continue
					}
					classifyRef(a.Val, upstreamHost, res)
					if t.Data == "script" && key == "src" && len(scripts) < maxProbeScripts {
						scripts = append(scripts, a.Val)
					}
				}
			}
		case html.TextToken:
			if inTitle && res.Title == "" {
				res.Title = strings.TrimSpace(string(z.Text()))
			}
		case html.EndTagToken:
			inTitle = false
		}
	}
	for _, f := range frameworkHints {
		if strings.Contains(page, f.pattern) {
			res.Frameworks = append(res.Frameworks, f.name)
		}
	}
	return scripts
}

// decideVerdict turns the findings into a recommendation
func decideVerdict(res *ProbeResult, known *knownApp, prefix string) {
	if known != nil {
		res.KnownApp = known.name
		res.Verdict = known.verdict
		res.Reasons = append(res.Reasons, strings.ReplaceAll(known.note, "{prefix}", prefix))
	}
	if res.FrameBlocked {
		res.Reasons = append(res.Reasons, "The app forbids being framed. Enable \"Allow in desktop window\" or open it in a new tab.")
	}
	if !res.Reachable {
		if res.Verdict == "" {
			res.Reasons = append(res.Reasons, "The app did not answer, so it could not be analysed.")
		}
		return
	}
	if res.Verdict != "" {
		return
	}

	rooted := false
	for _, f := range frameworkHints {
		for _, found := range res.Frameworks {
			if f.rooted && f.name == found {
				rooted = true
			}
		}
	}
	switch {
	case res.BaseHrefRoot || rooted:
		res.Verdict = VerdictSubdomain
		if res.BaseHrefRoot {
			res.Reasons = append(res.Reasons, "The page pins its base URL to \"/\" (single page app router).")
		}
		if rooted {
			res.Reasons = append(res.Reasons, "The framework ("+strings.Join(res.Frameworks, ", ")+") hardcodes its asset root.")
		}
		res.Reasons = append(res.Reasons, "Subdomain mode is recommended; path mode with rewriting may still work.")
	case res.RootRefs == 0 && res.ScriptHints == 0 && res.SelfRefs == 0:
		res.Verdict = VerdictPath
		res.Reasons = append(res.Reasons, "The page only uses relative URLs, it works under a path as is.")
	default:
		res.Verdict = VerdictPathRewrite
		if res.RootRefs > 0 {
			res.Reasons = append(res.Reasons, "The page references resources from \"/\". Enable root path rewriting.")
		}
		if res.ScriptHints > 0 {
			res.Reasons = append(res.Reasons, "Its scripts build URLs from \"/\" at runtime. Enable root path rewriting.")
		}
		if res.SelfRefs > 0 {
			res.Reasons = append(res.Reasons, "The page links to its own internal address.")
		}
	}
}

// Probe fetches the start page of an upstream and recommends a mode
func (m *Manager) Probe(target string, targetTLS bool, skipVerify bool, image string, slug string) ProbeResult {
	res := ProbeResult{Frameworks: []string{}, Reasons: []string{}}
	prefix := "/app/" + slug
	known := matchKnownApp(image)
	if err := validateTarget(target); err != nil {
		res.Error = err.Error()
		decideVerdict(&res, known, prefix)
		return res
	}
	base := (&Endpoint{Target: target, TargetTLS: targetTLS}).UpstreamURL()
	transport := m.transport
	if targetTLS && skipVerify {
		transport = m.insecureTransport
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   probeTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || !strings.EqualFold(req.URL.Host, base.Host) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	resp, err := client.Get(base.String() + "/")
	if err != nil {
		res.Error = err.Error()
		decideVerdict(&res, known, prefix)
		return res
	}
	defer resp.Body.Close()
	res.Reachable = true
	res.Status = resp.StatusCode
	if resp.Header.Get("X-Frame-Options") != "" || strings.Contains(strings.ToLower(resp.Header.Get("Content-Security-Policy")), "frame-ancestors") {
		res.FrameBlocked = true
	}
	page, _ := io.ReadAll(io.LimitReader(resp.Body, maxProbePage))
	scripts := analyzePage(string(page), base.Host, &res)

	pageURL := resp.Request.URL
	for _, s := range scripts {
		ref, err := url.Parse(strings.TrimSpace(s))
		if err != nil {
			continue
		}
		abs := pageURL.ResolveReference(ref)
		if !strings.EqualFold(abs.Host, base.Host) {
			continue
		}
		res.ScriptHints += countScriptHints(client, abs.String())
	}

	decideVerdict(&res, known, prefix)
	return res
}

func countScriptHints(client *http.Client, u string) int {
	resp, err := client.Get(u)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, maxProbeScript))
	return len(scriptRootHint.FindAllIndex(data, -1))
}
