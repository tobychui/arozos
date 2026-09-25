package appproxy

import "testing"

func TestNormalizeSlug(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"Grafana", "grafana"},
		{"my_container.1", "my-container-1"},
		{"  --Home Assistant--  ", "home-assistant"},
		{"/weird//name", "weird-name"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := NormalizeSlug(tt.in); got != tt.want {
			t.Errorf("NormalizeSlug(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestEndpointNormalize(t *testing.T) {
	base := func() Endpoint {
		return Endpoint{Slug: "app", Target: "127.0.0.1:8081", Mode: ModePath, Trusted: true, RequireLogin: true}
	}
	tests := []struct {
		name    string
		edit    func(e *Endpoint)
		wantErr bool
		check   func(t *testing.T, e Endpoint)
	}{
		{"valid path mode", func(e *Endpoint) {}, false, func(t *testing.T, e Endpoint) {
			if e.Name != "app" || e.OpenIn != OpenInFloat {
				t.Errorf("defaults not applied: %+v", e)
			}
		}},
		{"path mode needs trust", func(e *Endpoint) { e.Trusted = false }, true, nil},
		{"bad slug", func(e *Endpoint) { e.Slug = "Bad Slug" }, true, nil},
		{"target without port", func(e *Endpoint) { e.Target = "127.0.0.1" }, true, nil},
		{"target scheme stripped", func(e *Endpoint) { e.Target = "http://127.0.0.1:8081/" }, false, func(t *testing.T, e Endpoint) {
			if e.Target != "127.0.0.1:8081" {
				t.Errorf("Target = %q", e.Target)
			}
		}},
		{"target is arozos", func(e *Endpoint) { e.Target = "localhost:8080" }, true, nil},
		{"other host on arozos port", func(e *Endpoint) { e.Target = "10.0.0.5:8080" }, false, nil},
		{"unknown mode", func(e *Endpoint) { e.Mode = "magic" }, true, nil},
		{"subdomain mode", func(e *Endpoint) {
			e.Mode = ModeSubdomain
			e.Trusted = false
			e.Hostname = "Jelly.Example.com:443"
			e.PortalOrigin = "https://nas.example.com/"
			e.RewriteRoot = true
		}, false, func(t *testing.T, e Endpoint) {
			if e.Hostname != "jelly.example.com" || e.PortalOrigin != "https://nas.example.com" || e.RewriteRoot {
				t.Errorf("subdomain not normalized: %+v", e)
			}
		}},
		{"subdomain bad hostname", func(e *Endpoint) {
			e.Mode = ModeSubdomain
			e.Hostname = "not a host"
			e.PortalOrigin = "https://nas.example.com"
		}, true, nil},
		{"subdomain same as portal", func(e *Endpoint) {
			e.Mode = ModeSubdomain
			e.Hostname = "nas.example.com"
			e.PortalOrigin = "https://nas.example.com"
		}, true, nil},
		{"subdomain portal with path", func(e *Endpoint) {
			e.Mode = ModeSubdomain
			e.Hostname = "a.example.com"
			e.PortalOrigin = "https://nas.example.com/desktop"
		}, true, nil},
		{"icon injection", func(e *Endpoint) { e.Icon = `x" onerror="alert(1)` }, true, nil},
		{"window size clamped", func(e *Endpoint) { e.Width = 5; e.Height = 99999 }, false, func(t *testing.T, e Endpoint) {
			if e.Width != minWindowSize || e.Height != maxWindowSize {
				t.Errorf("size = %dx%d", e.Width, e.Height)
			}
		}},
		{"groups deduplicated", func(e *Endpoint) { e.AllowedGroups = []string{"a", " a ", "", "b"} }, false, func(t *testing.T, e Endpoint) {
			if len(e.AllowedGroups) != 2 {
				t.Errorf("groups = %v", e.AllowedGroups)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := base()
			tt.edit(&e)
			err := e.Normalize(8080)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Normalize err = %v, wantErr %v", err, tt.wantErr)
			}
			if err == nil && tt.check != nil {
				tt.check(t, e)
			}
		})
	}
}

func TestEndpointCanAccess(t *testing.T) {
	restricted := Endpoint{RequireLogin: true, AllowedGroups: []string{"media"}}
	everyone := Endpoint{RequireLogin: true}
	public := Endpoint{RequireLogin: false}
	member := &Identity{Username: "m", Groups: []string{"media"}}
	other := &Identity{Username: "o", Groups: []string{"users"}}
	admin := &Identity{Username: "a", IsAdmin: true}
	tests := []struct {
		name string
		ep   Endpoint
		id   *Identity
		want bool
	}{
		{"member of group", restricted, member, true},
		{"not in group", restricted, other, false},
		{"admin bypasses groups", restricted, admin, true},
		{"anonymous on protected", everyone, nil, false},
		{"any user when no groups", everyone, other, true},
		{"anonymous on public", public, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ep.CanAccess(tt.id); got != tt.want {
				t.Errorf("CanAccess = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAppOrigin(t *testing.T) {
	tests := []struct {
		portal string
		want   string
	}{
		{"https://nas.example.com", "https://app.example.com"},
		{"http://nas.local:8080", "http://app.example.com:8080"},
		{"", "https://app.example.com"},
	}
	for _, tt := range tests {
		e := Endpoint{Hostname: "app.example.com", PortalOrigin: tt.portal}
		if got := e.AppOrigin(); got != tt.want {
			t.Errorf("AppOrigin(%q) = %q, want %q", tt.portal, got, tt.want)
		}
	}
}
