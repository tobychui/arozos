package docker

import "testing"

func TestValidateContainerRef(t *testing.T) {
	tests := []struct {
		name    string
		ref     string
		wantErr bool
	}{
		{"empty", "", true},
		{"short id", "a1b2c3d4e5f6", false},
		{"full id", "9f2e4c1b8a7d6e5f4c3b2a190817263544556677889900aabbccddeeff001122", false},
		{"valid name", "my_web.app-1", false},
		{"leading dash flag injection", "-v", true},
		{"path traversal", "../etc/passwd", true},
		{"space", "my container", true},
		{"semicolon", "a;rm", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateContainerRef(tt.ref)
			if tt.wantErr && err == nil {
				t.Errorf("validateContainerRef(%q) = nil, want error", tt.ref)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateContainerRef(%q) = %v, want nil", tt.ref, err)
			}
		})
	}
}

func TestParseContainerList(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
		wantFirst string // expected Names of first parsed entry
	}{
		{
			name: "two valid lines",
			input: `{"ID":"abc123","Names":"web","Image":"nginx:alpine","State":"running","Status":"Up 2 minutes","Ports":"0.0.0.0:80->80/tcp"}
{"ID":"def456","Names":"db","Image":"postgres:16","State":"exited","Status":"Exited (0)"}`,
			wantCount: 2,
			wantFirst: "web",
		},
		{
			name: "skips blank and malformed lines",
			input: `{"ID":"abc123","Names":"web"}

not-json
{"ID":"def456","Names":"db"}`,
			wantCount: 2,
			wantFirst: "web",
		},
		{
			name:      "empty output",
			input:     "",
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseContainerList([]byte(tt.input))
			if err != nil {
				t.Fatalf("parseContainerList() unexpected error: %v", err)
			}
			if len(got) != tt.wantCount {
				t.Fatalf("parseContainerList() returned %d entries, want %d", len(got), tt.wantCount)
			}
			if tt.wantCount > 0 && got[0].Names != tt.wantFirst {
				t.Errorf("first entry Names = %q, want %q", got[0].Names, tt.wantFirst)
			}
		})
	}
}
