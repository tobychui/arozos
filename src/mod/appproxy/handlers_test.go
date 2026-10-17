package appproxy

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// TestHandleUserAppsContainers checks the desktop is told whether the host
// runs containers, which decides if it shows the Container Apps category
func TestHandleUserAppsContainers(t *testing.T) {
	cases := []struct {
		name      string
		available func() bool
		want      bool
	}{
		{"no callback", nil, false},
		{"docker missing", func() bool { return false }, false},
		{"docker usable", func() bool { return true }, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := newTestManager(t, nil)
			m.opts.ContainersAvailable = c.available
			if _, err := m.Save(pathEndpoint("grafana", "127.0.0.1:3000"), true, "admin", "nas.local"); err != nil {
				t.Fatalf("create: %v", err)
			}

			req := httptest.NewRequest("GET", "/system/appproxy/apps", nil)
			req.Header.Set("X-Test-User", "alice")
			rec := httptest.NewRecorder()
			m.HandleUserApps(rec, req)

			var resp struct {
				Apps       []AppInfo
				IsAdmin    bool
				Containers bool
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode %q: %v", rec.Body.String(), err)
			}
			if resp.Containers != c.want {
				t.Errorf("Containers = %v, want %v", resp.Containers, c.want)
			}
			if len(resp.Apps) != 1 || resp.Apps[0].Slug != "grafana" {
				t.Errorf("Apps = %+v, want the grafana app", resp.Apps)
			}
		})
	}
}
