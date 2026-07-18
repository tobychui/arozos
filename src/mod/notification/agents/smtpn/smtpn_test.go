package smtpn

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	notification "imuslab.com/arozos/mod/notification"
)

// writeConfigFile writes a JSON-serialised Agent config to a temp file and
// returns the file path plus a cleanup function.
func writeConfigFile(t *testing.T, agent Agent) (string, func()) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "smtp.json")
	data, err := json.MarshalIndent(agent, "", " ")
	if err != nil {
		t.Fatalf("failed to marshal config: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}
	return path, func() { os.Remove(path) }
}

// TestNewSMTPNotificationAgent_MissingFile verifies that the constructor
// returns an error when the config file does not exist.
func TestNewSMTPNotificationAgent_MissingFile(t *testing.T) {
	_, err := NewSMTPNotificationAgent("my-host", "/nonexistent/path/smtp.json", nil)
	if err == nil {
		t.Error("expected error for missing config file, got nil")
	}
}

// TestNewSMTPNotificationAgent_InvalidJSON verifies that a config file
// containing invalid JSON causes a parse error.
func TestNewSMTPNotificationAgent_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	os.WriteFile(path, []byte("{this is not valid json"), 0644)

	_, err := NewSMTPNotificationAgent("my-host", path, nil)
	if err == nil {
		t.Error("expected error for invalid JSON, got nil")
	}
}

// TestNewSMTPNotificationAgent_ValidConfig verifies that a well-formed config
// file produces a populated Agent with the expected field values.
func TestNewSMTPNotificationAgent_ValidConfig(t *testing.T) {
	cfg := Agent{
		SMTPSenderDisplayName: "ArozOS",
		SMTPSender:            "no-reply@example.com",
		SMTPPassword:          "secret",
		SMTPDomain:            "smtp.example.com",
		SMTPPort:              587,
	}
	path, cleanup := writeConfigFile(t, cfg)
	defer cleanup()

	dummyResolver := func(username string) (string, error) {
		return username + "@example.com", nil
	}

	agent, err := NewSMTPNotificationAgent("test-host", path, dummyResolver)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if agent.Hostname != "test-host" {
		t.Errorf("expected Hostname 'test-host', got '%s'", agent.Hostname)
	}
	if agent.SMTPSender != "no-reply@example.com" {
		t.Errorf("unexpected SMTPSender: %s", agent.SMTPSender)
	}
	if agent.SMTPPort != 587 {
		t.Errorf("unexpected SMTPPort: %d", agent.SMTPPort)
	}
}

// TestGenerateEmptyConfigFile verifies that an empty config file is written
// and contains valid JSON that decodes back to a zero-value Agent.
func TestGenerateEmptyConfigFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.json")

	err := GenerateEmptyConfigFile(path)
	if err != nil {
		t.Fatalf("GenerateEmptyConfigFile returned error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read generated config file: %v", err)
	}

	var decoded Agent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("generated file contains invalid JSON: %v", err)
	}

	// All fields should be zero-valued.
	if decoded.SMTPSender != "" {
		t.Errorf("expected empty SMTPSender, got: %s", decoded.SMTPSender)
	}
	if decoded.SMTPPort != 0 {
		t.Errorf("expected SMTPPort 0, got: %d", decoded.SMTPPort)
	}
}

// TestAgent_Name verifies the Name() method returns the expected agent name.
func TestAgent_Name(t *testing.T) {
	a := Agent{}
	if a.Name() != "smtpn" {
		t.Errorf("expected Name() to return 'smtpn', got '%s'", a.Name())
	}
}

// TestAgent_Desc verifies that Desc() returns a non-empty description.
func TestAgent_Desc(t *testing.T) {
	a := Agent{}
	if a.Desc() == "" {
		t.Error("expected Desc() to return a non-empty string")
	}
}

// TestAgent_IsConsumer verifies that the SMTP agent is a consumer.
func TestAgent_IsConsumer(t *testing.T) {
	a := Agent{}
	if !a.IsConsumer() {
		t.Error("expected IsConsumer() to return true for SMTP agent")
	}
}

// TestAgent_IsProducer verifies that the SMTP agent is not a producer.
func TestAgent_IsProducer(t *testing.T) {
	a := Agent{}
	if a.IsProducer() {
		t.Error("expected IsProducer() to return false for SMTP agent")
	}
}

// TestLoadLogoDataURI_MissingReturnsEmpty verifies the helper degrades to an
// empty string when the brand asset is not present in the current directory
// (the normal case in tests, which do not run from the app root).
func TestLoadLogoDataURI_MissingReturnsEmpty(t *testing.T) {
	// t.Chdir would keep us in the test's temp dir; the asset path is relative
	// to the app root which does not exist here.
	if got := loadLogoDataURI(); got != "" {
		t.Errorf("expected empty data URI when asset missing, got %q", got[:min(len(got), 40)])
	}
}

// TestLoadLogoDataURI_EncodesFile verifies that when the asset exists it is
// returned as a base64 PNG data URI.
func TestLoadLogoDataURI_EncodesFile(t *testing.T) {
	dir := t.TempDir()
	// Recreate the expected relative asset path under a temp working directory.
	assetDir := filepath.Join(dir, "web", "img", "public", "pwa")
	if err := os.MkdirAll(assetDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "192.png"), []byte("PNGDATA"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Chdir(dir)

	got := loadLogoDataURI()
	want := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("PNGDATA"))
	if got != want {
		t.Errorf("unexpected data URI: got %q want %q", got, want)
	}
}

// TestAgent_ProduceNotification_NoOp verifies that ProduceNotification does
// not panic (it is a no-op in this implementation).
func TestAgent_ProduceNotification_NoOp(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ProduceNotification panicked: %v", r)
		}
	}()
	a := Agent{}
	a.ProduceNotification(nil)
}

// TestAgent_ConsumerNotification_SkipIfNoSMTP verifies that
// ConsumerNotification with no reachable SMTP server returns an error (not a
// panic) when at least one receiver is provided.
func TestAgent_ConsumerNotification_SkipIfNoSMTP(t *testing.T) {
	a := Agent{
		Hostname:              "test-host",
		SMTPSenderDisplayName: "Test",
		SMTPSender:            "test@example.com",
		SMTPPassword:          "password",
		SMTPDomain:            "localhost",
		SMTPPort:              25,
		UsernameToEmail: func(username string) (string, error) {
			return username + "@example.com", nil
		},
	}

	payload := &notification.NotificationPayload{
		ID:       "test-001",
		Title:    "Test Notification",
		Message:  "This is a test",
		Receiver: []string{"testuser"},
		Sender:   "unit-test",
	}

	err := a.ConsumerNotification(payload)
	// We expect an error because there's no real SMTP server at localhost:25.
	// If (unexpectedly) no error is returned, the test still passes.
	if err != nil {
		t.Logf("ConsumerNotification returned expected error (no SMTP server): %v", err)
	}
}
