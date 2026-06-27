package docker

import "testing"

func TestValidateImageRef(t *testing.T) {
	tests := []struct {
		name    string
		ref     string
		wantErr bool
	}{
		{"empty", "", true},
		{"simple", "nginx", false},
		{"repo tag", "nginx:alpine", false},
		{"registry repo tag", "registry.example.com:5000/team/app:1.2.3", false},
		{"digest", "nginx@sha256:abc123", false},
		{"image id", "sha256:9f2e4c1b8a7d", false},
		{"leading dash", "-rm", true},
		{"space", "nginx latest", true},
		{"pipe", "nginx|cat", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImageRef(tt.ref)
			if tt.wantErr && err == nil {
				t.Errorf("validateImageRef(%q) = nil, want error", tt.ref)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateImageRef(%q) = %v, want nil", tt.ref, err)
			}
		})
	}
}

func TestParseImageList(t *testing.T) {
	input := `{"ID":"abc","Repository":"nginx","Tag":"alpine","Size":"23MB","CreatedSince":"2 weeks ago"}

garbage
{"ID":"def","Repository":"postgres","Tag":"16","Size":"400MB"}`
	got, err := parseImageList([]byte(input))
	if err != nil {
		t.Fatalf("parseImageList() error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("parseImageList() returned %d, want 2", len(got))
	}
	if got[0].Repository != "nginx" || got[1].Tag != "16" {
		t.Errorf("unexpected parse result: %+v", got)
	}
}
