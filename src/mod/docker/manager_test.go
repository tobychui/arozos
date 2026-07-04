package docker

import (
	"testing"
)

// TestParseDockerVersionJSON is a table-driven test of the pure JSON parser
// used to enrich the engine status. It needs no running daemon.
func TestParseDockerVersionJSON(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantErr     bool
		wantVersion string
		wantOS      string
		wantArch    string
	}{
		{
			name:        "full server block",
			input:       `{"Client":{"Version":"24.0.5"},"Server":{"Version":"24.0.5","ApiVersion":"1.43","Os":"linux","Arch":"amd64"}}`,
			wantErr:     false,
			wantVersion: "24.0.5",
			wantOS:      "linux",
			wantArch:    "amd64",
		},
		{
			name:        "missing server block",
			input:       `{"Client":{"Version":"24.0.5"}}`,
			wantErr:     false,
			wantVersion: "",
			wantOS:      "",
			wantArch:    "",
		},
		{
			name:    "malformed json",
			input:   `not-json`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseDockerVersionJSON([]byte(tt.input))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseDockerVersionJSON(%q) expected error, got nil", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseDockerVersionJSON(%q) unexpected error: %v", tt.input, err)
			}
			if parsed.Server.Version != tt.wantVersion {
				t.Errorf("Server.Version = %q, want %q", parsed.Server.Version, tt.wantVersion)
			}
			if parsed.Server.Os != tt.wantOS {
				t.Errorf("Server.Os = %q, want %q", parsed.Server.Os, tt.wantOS)
			}
			if parsed.Server.Arch != tt.wantArch {
				t.Errorf("Server.Arch = %q, want %q", parsed.Server.Arch, tt.wantArch)
			}
		})
	}
}

// TestNewDockerManagerWhenUnavailable asserts the constructor refuses to build a
// manager when docker is not usable on the host. When docker IS usable we
// instead assert a manager is returned.
func TestNewDockerManagerWhenUnavailable(t *testing.T) {
	dm, err := NewDockerManager(Options{StackBaseDir: t.TempDir()})

	if !dockerCLIAvailable() {
		if err == nil {
			t.Error("NewDockerManager() returned nil error with docker absent")
		}
		if dm != nil {
			t.Error("NewDockerManager() returned a non-nil manager with docker absent")
		}
		return
	}

	// docker CLI present: result depends on whether the daemon is reachable.
	if err != nil {
		t.Skipf("docker present but daemon unreachable on this host: %v", err)
	}
	if dm == nil {
		t.Fatal("NewDockerManager() returned nil manager despite nil error")
	}
	status := dm.GetEngineStatus()
	if !status.Available {
		t.Error("GetEngineStatus().Available = false on a constructed manager")
	}
}
