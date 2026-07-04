package docker

import (
	"sort"
	"testing"
)

func TestParseRegistryConfig(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []string
		wantErr bool
	}{
		{
			name:  "two registries",
			input: `{"auths":{"https://index.docker.io/v1/":{"auth":"x"},"registry.example.com:5000":{"auth":"y"}}}`,
			want:  []string{"https://index.docker.io/v1/", "registry.example.com:5000"},
		},
		{
			name:  "no auths",
			input: `{"credsStore":"desktop"}`,
			want:  []string{},
		},
		{
			name:    "malformed",
			input:   `nope`,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRegistryConfig([]byte(tt.input))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseRegistryConfig() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseRegistryConfig() unexpected error: %v", err)
			}
			sort.Strings(got)
			sort.Strings(tt.want)
			if len(got) != len(tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestParseSearchResults(t *testing.T) {
	input := `{"Name":"nginx","Description":"Official","StarCount":"19000","IsOfficial":"[OK]"}
{"Name":"bitnami/nginx","Description":"Bitnami","StarCount":"170","IsOfficial":""}`
	got, err := parseSearchResults([]byte(input))
	if err != nil {
		t.Fatalf("parseSearchResults() error: %v", err)
	}
	if len(got) != 2 || got[0].Name != "nginx" {
		t.Fatalf("unexpected result: %+v", got)
	}
}
