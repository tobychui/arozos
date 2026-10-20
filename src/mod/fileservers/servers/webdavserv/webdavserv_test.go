package webdavserv

import "testing"

// Every storage is a folder under one virtual root, so only the root
// endpoint is listed.
func TestWebDavGetEndpoints(t *testing.T) {
	tests := []struct {
		useTls       bool
		wantProtocol string
	}{
		{false, "http://"},
		{true, "https://"},
	}
	for _, tt := range tests {
		m := &Manager{option: &ManagerOption{Port: 8080, UseTls: tt.useTls}}
		eps := m.WebDavGetEndpoints(nil)
		if len(eps) != 1 {
			t.Fatalf("UseTls=%v: expected 1 endpoint, got %d", tt.useTls, len(eps))
		}
		if eps[0].ProtocolName != tt.wantProtocol || eps[0].Port != 8080 || eps[0].Subpath != "/webdav/" {
			t.Errorf("UseTls=%v: got %+v, want %s port 8080 at /webdav/", tt.useTls, eps[0], tt.wantProtocol)
		}
	}
}
