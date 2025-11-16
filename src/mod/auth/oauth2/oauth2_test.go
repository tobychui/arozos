package oauth2

import (
	"testing"
)

func TestOAuth2ConfigStruct(t *testing.T) {
	config := Config{
		Enabled:      true,
		ClientID:     "test-client-id",
		ClientSecret: "test-secret",
	}
	if !config.Enabled {
		t.Error("Config should be enabled")
	}
	if config.ClientID != "test-client-id" {
		t.Error("ClientID mismatch")
	}
}
