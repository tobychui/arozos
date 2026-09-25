package main

import (
	"encoding/json"
	"flag"
	"testing"
)

func testDefaultBootFlags() bootFlags {
	return bootFlags{
		Hostname:          "My ArOZ",
		MaxUploadSize:     8192,
		MaxFileUploadBuff: 25,
		FileIOBuffer:      1024,
		DisableIPResolver: false,
		EnableHomePage:    true,
		EnableDirListing:  true,
	}
}

func testStoredBootFlags(t *testing.T, fields map[string]interface{}) map[string]json.RawMessage {
	t.Helper()
	js, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("marshal stored fields: %v", err)
	}
	stored := map[string]json.RawMessage{}
	if err := json.Unmarshal(js, &stored); err != nil {
		t.Fatalf("unmarshal stored fields: %v", err)
	}
	return stored
}

func TestMergeBootFlags(t *testing.T) {
	fullStored := map[string]interface{}{
		"Hostname":          "Saved Host",
		"MaxUploadSize":     1024,
		"MaxFileUploadBuff": 50,
		"FileIOBuffer":      4096,
		"DisableIPResolver": true,
		"EnableHomePage":    false,
		"EnableDirListing":  false,
	}

	tests := []struct {
		name     string
		runtime  bootFlags
		stored   map[string]interface{}
		explicit map[string]bool
		want     bootFlags
	}{
		{
			name:    "nothing stored keeps runtime defaults",
			runtime: testDefaultBootFlags(),
			stored:  map[string]interface{}{},
			want:    testDefaultBootFlags(),
		},
		{
			name:    "stored values restored when no start flag given",
			runtime: testDefaultBootFlags(),
			stored:  fullStored,
			want: bootFlags{
				Hostname:          "Saved Host",
				MaxUploadSize:     1024,
				MaxFileUploadBuff: 50,
				FileIOBuffer:      4096,
				DisableIPResolver: true,
				EnableHomePage:    false,
				EnableDirListing:  false,
			},
		},
		{
			name: "explicit start flags win over stored values",
			runtime: bootFlags{
				Hostname:          "Flag Host",
				MaxUploadSize:     8192,
				MaxFileUploadBuff: 25,
				FileIOBuffer:      1024,
				EnableHomePage:    true,
				EnableDirListing:  true,
			},
			stored:   fullStored,
			explicit: map[string]bool{"hostname": true, "homepage": true},
			want: bootFlags{
				Hostname:          "Flag Host",
				MaxUploadSize:     1024,
				MaxFileUploadBuff: 50,
				FileIOBuffer:      4096,
				DisableIPResolver: true,
				EnableHomePage:    true,
				EnableDirListing:  false,
			},
		},
		{
			name:    "partial stored config only restores its fields",
			runtime: testDefaultBootFlags(),
			stored:  map[string]interface{}{"MaxUploadSize": 2048},
			want: func() bootFlags {
				c := testDefaultBootFlags()
				c.MaxUploadSize = 2048
				return c
			}(),
		},
		{
			name:    "invalid stored values fall back to runtime",
			runtime: testDefaultBootFlags(),
			stored: map[string]interface{}{
				"Hostname":          "  ",
				"MaxUploadSize":     0,
				"MaxFileUploadBuff": -1,
				"FileIOBuffer":      "not a number",
			},
			want: testDefaultBootFlags(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mergeBootFlags(tt.runtime, testStoredBootFlags(t, tt.stored), tt.explicit)
			if got != tt.want {
				t.Errorf("mergeBootFlags() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestValidateBootFlags(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(c *bootFlags)
		wantErr bool
	}{
		{name: "defaults are valid", mutate: func(c *bootFlags) {}},
		{name: "host name is trimmed", mutate: func(c *bootFlags) { c.Hostname = "  Box  " }},
		{name: "empty host name", mutate: func(c *bootFlags) { c.Hostname = "   " }, wantErr: true},
		{name: "zero upload size", mutate: func(c *bootFlags) { c.MaxUploadSize = 0 }, wantErr: true},
		{name: "negative upload buffer", mutate: func(c *bootFlags) { c.MaxFileUploadBuff = -5 }, wantErr: true},
		{name: "zero io buffer", mutate: func(c *bootFlags) { c.FileIOBuffer = 0 }, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := testDefaultBootFlags()
			tt.mutate(&c)
			err := validateBootFlags(&c)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateBootFlags() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err == nil && c.Hostname != "My ArOZ" && c.Hostname != "Box" {
				t.Errorf("unexpected host name after validation: %q", c.Hostname)
			}
		})
	}
}

func TestBootFlagNamesCoverFlags(t *testing.T) {
	for field, name := range bootFlagNames {
		if flag.Lookup(name) == nil {
			t.Errorf("field %s maps to unknown start flag -%s", field, name)
		}
	}
	if len(bootFlagNames) != 7 {
		t.Errorf("expected 7 mapped fields, got %d", len(bootFlagNames))
	}
}
