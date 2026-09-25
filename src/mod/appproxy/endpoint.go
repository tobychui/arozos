package appproxy

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

/*
	endpoint.go

	The Endpoint record an administrator publishes, and its validation.

	An endpoint maps a slug to a web server reachable from this host (usually
	a Docker container's published port) and is served in one of two modes:

	- path mode:      https://<arozos host>/app/<slug>/  (same origin as the
	                  desktop, so it requires the "trusted" flag)
	- subdomain mode: https://<hostname>/                (its own origin)

	The canonical entry point is always /app/<slug>/ on the ArozOS host; in
	subdomain mode it hands the login over and redirects to the hostname, so a
	desktop shortcut keeps working when an admin switches the mode.
*/

const (
	ModePath      = "path"
	ModeSubdomain = "subdomain"

	OpenInFloat = "float"
	OpenInTab   = "tab"

	minWindowSize = 100
	maxWindowSize = 10000
)

// Endpoint is one published container web app
type Endpoint struct {
	Slug      string //URL-safe id, used in /app/<slug>/ and never changed after creation
	Name      string //Display name
	Icon      string //Icon web path or URL
	Container string //Docker container name it was published from, informational
	Image     string //Docker image, used by the probe for known-app hints

	Target        string //host:port of the upstream web server
	TargetTLS     bool   //Upstream speaks https
	SkipTLSVerify bool   //Accept self-signed upstream certificates

	Mode         string //ModePath or ModeSubdomain
	Hostname     string //Subdomain mode: the host name this app answers on
	PortalOrigin string //Subdomain mode: origin of the ArozOS desktop, for the login hand-off

	Trusted      bool //Admin trusts this container to share the desktop's origin (required for path mode)
	RootRedirect bool //Path mode: redirect root requests made from the app back under /app/<slug>/
	RewriteRoot  bool //Path mode: rewrite root paths in HTML / CSS and inject the rewrite script
	AllowFraming bool //Strip X-Frame-Options / frame-ancestors so it opens in a desktop window

	RequireLogin  bool     //Only logged in ArozOS users may open it
	AllowedGroups []string //Permission groups allowed to open it, empty = every user

	OpenIn string //OpenInFloat or OpenInTab
	Width  int    //Initial float window width, 0 = default
	Height int    //Initial float window height, 0 = default

	CreatedBy string
	CreatedAt int64
	UpdatedAt int64
}

var (
	slugRegex     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	hostnameRegex = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)
)

// NormalizeSlug turns a free text name (e.g. a container name) into a valid slug
func NormalizeSlug(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastDash := true
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
			lastDash = false
		} else if !lastDash {
			b.WriteRune('-')
			lastDash = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if len(slug) > 63 {
		slug = strings.Trim(slug[:63], "-")
	}
	return slug
}

// ValidSlug reports whether s can be used as an endpoint slug
func ValidSlug(s string) bool {
	return slugRegex.MatchString(s)
}

// NormalizeHostname lower-cases a host name and drops any port
func NormalizeHostname(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.TrimSuffix(host, ".")
}

// normalizeWindowSize clamps a float window dimension, 0 means default
func normalizeWindowSize(v int) int {
	if v <= 0 {
		return 0
	}
	if v < minWindowSize {
		return minWindowSize
	}
	if v > maxWindowSize {
		return maxWindowSize
	}
	return v
}

// validateTarget checks a host:port upstream address
func validateTarget(target string) error {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return errors.New("Target must be host:port, e.g. 127.0.0.1:8081")
	}
	if host == "" || strings.ContainsAny(host, "/?#@ ") {
		return errors.New("Invalid target host")
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return errors.New("Invalid target port")
	}
	return nil
}

// isLoopbackHost reports whether host points back at this machine
func isLoopbackHost(host string) bool {
	host = strings.ToLower(host)
	if host == "localhost" || host == "0.0.0.0" || host == "::" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// validateOrigin checks a scheme://host[:port] origin without a path
func validateOrigin(origin string) error {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("Portal origin must look like https://nas.example.com")
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return errors.New("Portal origin must not contain a path")
	}
	return nil
}

// Normalize fills defaults and validates the endpoint. selfPort is the port
// ArozOS itself listens on (a loopback target on it would proxy into itself)
func (e *Endpoint) Normalize(selfPort int) error {
	e.Slug = strings.TrimSpace(e.Slug)
	if !ValidSlug(e.Slug) {
		return errors.New("Slug may only contain a-z, 0-9 and - (max 63 characters)")
	}
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		e.Name = e.Slug
	}
	if len(e.Name) > 64 {
		return errors.New("Name is too long")
	}
	e.Icon = strings.TrimSpace(e.Icon)
	if strings.ContainsAny(e.Icon, "\"'<>`\r\n") {
		return errors.New("Invalid icon path")
	}
	e.Container = strings.TrimSpace(e.Container)
	e.Image = strings.TrimSpace(e.Image)

	e.Target = strings.TrimSpace(e.Target)
	e.Target = strings.TrimPrefix(strings.TrimPrefix(e.Target, "http://"), "https://")
	e.Target = strings.TrimSuffix(e.Target, "/")
	if err := validateTarget(e.Target); err != nil {
		return err
	}
	if selfPort > 0 {
		host, port, _ := net.SplitHostPort(e.Target)
		if isLoopbackHost(host) && port == strconv.Itoa(selfPort) {
			return errors.New("Target cannot be ArozOS itself")
		}
	}

	switch e.Mode {
	case ModePath:
		if !e.Trusted {
			return errors.New("Path mode shares the desktop's origin and requires trusting this container. Use subdomain mode for untrusted containers")
		}
		e.Hostname = ""
	case ModeSubdomain:
		e.Hostname = NormalizeHostname(e.Hostname)
		if !hostnameRegex.MatchString(e.Hostname) {
			return errors.New("Invalid hostname for subdomain mode")
		}
		e.PortalOrigin = strings.TrimSuffix(strings.TrimSpace(e.PortalOrigin), "/")
		if err := validateOrigin(e.PortalOrigin); err != nil {
			return err
		}
		portal, _ := url.Parse(e.PortalOrigin)
		if NormalizeHostname(portal.Host) == e.Hostname {
			return errors.New("The app hostname must differ from the ArozOS hostname")
		}
		//Root path rewriting is a path mode feature
		e.RootRedirect = false
		e.RewriteRoot = false
	default:
		return errors.New("Mode must be path or subdomain")
	}

	if e.OpenIn != OpenInTab {
		e.OpenIn = OpenInFloat
	}
	e.Width = normalizeWindowSize(e.Width)
	e.Height = normalizeWindowSize(e.Height)

	groups := []string{}
	seen := map[string]bool{}
	for _, g := range e.AllowedGroups {
		g = strings.TrimSpace(g)
		if g == "" || seen[g] {
			continue
		}
		seen[g] = true
		groups = append(groups, g)
	}
	e.AllowedGroups = groups
	return nil
}

// PathPrefix is the path mode URL prefix of this endpoint, without a trailing slash
func (e *Endpoint) PathPrefix() string {
	return "/app/" + e.Slug
}

// UpstreamURL is the base URL requests are forwarded to
func (e *Endpoint) UpstreamURL() *url.URL {
	scheme := "http"
	if e.TargetTLS {
		scheme = "https"
	}
	return &url.URL{Scheme: scheme, Host: e.Target}
}

// CanAccess reports whether a user may open the endpoint. A nil identity is
// an anonymous visitor
func (e *Endpoint) CanAccess(id *Identity) bool {
	if !e.RequireLogin {
		return true
	}
	if id == nil {
		return false
	}
	if id.IsAdmin || len(e.AllowedGroups) == 0 {
		return true
	}
	for _, want := range e.AllowedGroups {
		for _, have := range id.Groups {
			if want == have {
				return true
			}
		}
	}
	return false
}
