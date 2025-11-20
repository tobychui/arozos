package smtpn

import (
	"testing"
)

func TestGenerateEmptyConfigFile(t *testing.T) {
	// Test generating an empty config file
	err := GenerateEmptyConfigFile("/tmp/test_smtp_config.json")
	if err != nil {
		t.Errorf("Error generating config file: %v", err)
	}
}
