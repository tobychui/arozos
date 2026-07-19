package docker

import (
	"strings"
	"testing"
)

func TestBuildRunArgs(t *testing.T) {
	tests := []struct {
		name     string
		cfg      RunConfig
		create   bool
		wantErr  bool
		contains []string // argv tokens that must all be present
		absent   []string // argv tokens that must NOT be present
	}{
		{
			name:     "minimal run is detached",
			cfg:      RunConfig{Image: "nginx:alpine"},
			contains: []string{"run", "-d", "nginx:alpine"},
		},
		{
			name:     "create is not detached",
			cfg:      RunConfig{Image: "nginx:alpine"},
			create:   true,
			contains: []string{"create", "nginx:alpine"},
			absent:   []string{"-d"},
		},
		{
			name: "full config",
			cfg: RunConfig{
				Image:         "registry.example.com:5000/team/app:1.0",
				Name:          "web1",
				Ports:         []string{"8080:80", "127.0.0.1:443:443/tcp"},
				Volumes:       []string{"/srv/data:/data", "named:/var/lib:ro"},
				Env:           []string{"FOO=bar", "DEBUG=1"},
				RestartPolicy: "unless-stopped",
				Network:       "mynet",
				Command:       "nginx -g daemon off;",
			},
			contains: []string{"--name", "web1", "-p", "8080:80", "-v", "/srv/data:/data",
				"-e", "FOO=bar", "--restart", "unless-stopped", "--network", "mynet",
				"registry.example.com:5000/team/app:1.0", "daemon"},
		},
		{"bad image", RunConfig{Image: "-rm"}, false, true, nil, nil},
		{"bad name", RunConfig{Image: "nginx", Name: "-x"}, false, true, nil, nil},
		{"bad port", RunConfig{Image: "nginx", Ports: []string{"--privileged"}}, false, true, nil, nil},
		{"bad volume relative dst", RunConfig{Image: "nginx", Volumes: []string{"/host:data"}}, false, true, nil, nil},
		{"bad env", RunConfig{Image: "nginx", Env: []string{"not-an-env"}}, false, true, nil, nil},
		{"bad restart", RunConfig{Image: "nginx", RestartPolicy: "sometimes"}, false, true, nil, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args, err := buildRunArgs(tt.cfg, tt.create)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("buildRunArgs() expected error, got args %v", args)
				}
				return
			}
			if err != nil {
				t.Fatalf("buildRunArgs() unexpected error: %v", err)
			}
			joined := strings.Join(args, " ")
			for _, tok := range tt.contains {
				if !containsToken(args, tok) {
					t.Errorf("argv %q missing token %q", joined, tok)
				}
			}
			for _, tok := range tt.absent {
				if containsToken(args, tok) {
					t.Errorf("argv %q should not contain token %q", joined, tok)
				}
			}
		})
	}
}

func containsToken(args []string, tok string) bool {
	for _, a := range args {
		if a == tok {
			return true
		}
	}
	return false
}

func TestValidateVolume(t *testing.T) {
	tests := []struct {
		v       string
		wantErr bool
	}{
		{"/host:/container", false},
		{"named:/data", false},
		{"/host:/container:ro", false},
		{"/host:relative", true},
		{"-flag:/x", true},
		{"justonepart", true},
		{"a:b:c:d", true},
	}
	for _, tt := range tests {
		if err := validateVolume(tt.v); (err != nil) != tt.wantErr {
			t.Errorf("validateVolume(%q) err=%v, wantErr=%v", tt.v, err, tt.wantErr)
		}
	}
}
