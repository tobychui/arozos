package telegram

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	notification "imuslab.com/arozos/mod/notification"
)

func writeConfig(t *testing.T, botToken string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "telegram.json")
	data, _ := json.Marshal(config{BotToken: botToken})
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}
	return path
}

func TestNewTelegramNotificationAgent_MissingFile(t *testing.T) {
	_, err := NewTelegramNotificationAgent("/nonexistent/telegram.json", nil)
	if err == nil {
		t.Error("expected error for missing config file")
	}
}

func TestNewTelegramNotificationAgent_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	os.WriteFile(path, []byte("{not json"), 0644)
	_, err := NewTelegramNotificationAgent(path, nil)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestNewTelegramNotificationAgent_Valid(t *testing.T) {
	path := writeConfig(t, "123:abc")
	agent, err := NewTelegramNotificationAgent(path, func(u string) (string, error) { return "42", nil })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if agent.BotToken != "123:abc" {
		t.Errorf("unexpected bot token: %s", agent.BotToken)
	}
	if !agent.IsConfigured() {
		t.Error("expected agent to be configured")
	}
}

func TestGenerateEmptyConfigFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.json")
	if err := GenerateEmptyConfigFile(path); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var c config
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("generated file is invalid JSON: %v", err)
	}
	if c.BotToken != "" {
		t.Errorf("expected empty bot token, got %s", c.BotToken)
	}
}

func TestAgentMetadata(t *testing.T) {
	a := &Agent{}
	if a.Name() != "telegram" {
		t.Errorf("unexpected name: %s", a.Name())
	}
	if a.Desc() == "" {
		t.Error("expected non-empty description")
	}
	if !a.IsConsumer() {
		t.Error("expected telegram agent to be a consumer")
	}
	if a.IsProducer() {
		t.Error("expected telegram agent to not be a producer")
	}
}

func TestIsConfigured(t *testing.T) {
	if (&Agent{BotToken: ""}).IsConfigured() {
		t.Error("empty token should not be configured")
	}
	if (&Agent{BotToken: "   "}).IsConfigured() {
		t.Error("whitespace token should not be configured")
	}
	if !(&Agent{BotToken: "abc"}).IsConfigured() {
		t.Error("non-empty token should be configured")
	}
}

func TestFormatMessage(t *testing.T) {
	msg := FormatMessage(&notification.NotificationPayload{
		Title:    "Disk full",
		Message:  "Root volume at 99%",
		Sender:   "SMART Scanner",
		Priority: notification.PriorityHigh,
	})
	if !strings.Contains(msg, "[HIGH]") {
		t.Errorf("expected priority tag in message, got: %s", msg)
	}
	if !strings.Contains(msg, "Disk full") || !strings.Contains(msg, "SMART Scanner") {
		t.Errorf("expected title and sender in message, got: %s", msg)
	}
}

func TestConsumerNotification_NotConfigured(t *testing.T) {
	a := &Agent{BotToken: ""}
	err := a.ConsumerNotification(&notification.NotificationPayload{Receiver: []string{"alice"}})
	if err == nil {
		t.Error("expected error when agent not configured")
	}
}

func TestConsumerNotification_DeliversToLinkedChat(t *testing.T) {
	var gotChatID, gotText string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		gotChatID = r.FormValue("chat_id")
		gotText = r.FormValue("text")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	a := &Agent{
		BotToken: "token",
		Endpoint: server.URL,
		Client:   &http.Client{Timeout: 2 * time.Second},
		UsernameToChatID: func(u string) (string, error) {
			if u == "alice" {
				return "555", nil
			}
			return "", os.ErrNotExist
		},
	}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		Title:    "Hello",
		Message:  "World",
		Receiver: []string{"alice"},
		Priority: notification.PriorityMedium,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotChatID != "555" {
		t.Errorf("expected chat id 555, got %s", gotChatID)
	}
	if !strings.Contains(gotText, "Hello") {
		t.Errorf("expected message text to contain title, got %s", gotText)
	}
}

func TestConsumerNotification_SkipsUnlinkedUser(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	a := &Agent{
		BotToken: "token",
		Endpoint: server.URL,
		Client:   &http.Client{Timeout: 2 * time.Second},
		UsernameToChatID: func(u string) (string, error) {
			return "", os.ErrNotExist //no user linked
		},
	}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		Title:    "Hello",
		Receiver: []string{"bob"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if callCount != 0 {
		t.Errorf("expected no API calls for unlinked user, got %d", callCount)
	}
}

func TestConsumerNotification_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	a := &Agent{
		BotToken:         "token",
		Endpoint:         server.URL,
		Client:           &http.Client{Timeout: 2 * time.Second},
		UsernameToChatID: func(u string) (string, error) { return "1", nil },
	}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		Title:    "Hello",
		Receiver: []string{"alice"},
	})
	if err == nil {
		t.Error("expected error when Telegram API returns non-200")
	}
}

func TestProduceNotification_NoOp(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ProduceNotification panicked: %v", r)
		}
	}()
	(&Agent{}).ProduceNotification(nil)
}
