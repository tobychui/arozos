package webhookn

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	notification "imuslab.com/arozos/mod/notification"
)

func TestAgentMetadata(t *testing.T) {
	a := NewWebhookNotificationAgent(nil)
	if a.Name() != "webhook" {
		t.Errorf("unexpected name: %s", a.Name())
	}
	if a.Desc() == "" {
		t.Error("expected non-empty description")
	}
	if !a.IsConsumer() {
		t.Error("expected webhook agent to be a consumer")
	}
	if a.IsProducer() {
		t.Error("expected webhook agent to not be a producer")
	}
}

func TestRenderTemplate_DefaultJSONIsValid(t *testing.T) {
	body := RenderTemplate(defaultJSONBody, &notification.NotificationPayload{
		ID:        "id1",
		Title:     `Say "hi"`,
		Message:   "line1\nline2",
		Sender:    "tester",
		Priority:  notification.PriorityHigh,
		Timestamp: 1234,
	})
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("default body is not valid JSON: %v\nbody: %s", err, body)
	}
	if decoded["title"] != `Say "hi"` {
		t.Errorf("unexpected title after escaping: %v", decoded["title"])
	}
	if decoded["priority"] != "high" {
		t.Errorf("unexpected priority: %v", decoded["priority"])
	}
}

func TestRenderTemplate_CustomPlaceholders(t *testing.T) {
	out := RenderTemplate("T={{title}} P={{priority}}", &notification.NotificationPayload{
		Title:    "hello",
		Priority: notification.PriorityLow,
	})
	if out != "T=hello P=low" {
		t.Errorf("unexpected rendered template: %s", out)
	}
}

func TestValidateTarget(t *testing.T) {
	cases := []struct {
		url     string
		wantErr bool
	}{
		{"https://example.com/hook", false},
		{"http://localhost:9000/x", false},
		{"ftp://example.com", true},
		{"not a url", true},
		{"", true},
		{"https://", true},
	}
	for _, c := range cases {
		err := ValidateTarget(Target{URL: c.url})
		if (err != nil) != c.wantErr {
			t.Errorf("ValidateTarget(%q) err=%v, wantErr=%v", c.url, err, c.wantErr)
		}
	}
}

func TestConsumerNotification_PostDefaultBody(t *testing.T) {
	var gotBody string
	var gotContentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotContentType = r.Header.Get("Content-Type")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	a := NewWebhookNotificationAgent(func(u string) (Target, error) {
		return Target{URL: server.URL, Method: "POST"}, nil
	})
	a.Client = &http.Client{Timeout: 2 * time.Second}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		ID:       "n1",
		Title:    "Backup complete",
		Message:  "All good",
		Sender:   "Backup",
		Receiver: []string{"alice"},
		Priority: notification.PriorityMedium,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(gotBody, "Backup complete") {
		t.Errorf("expected title in body, got %s", gotBody)
	}
	if gotContentType != "application/json" {
		t.Errorf("expected default JSON content type, got %s", gotContentType)
	}
}

func TestConsumerNotification_GetAppendsQuery(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	a := NewWebhookNotificationAgent(func(u string) (Target, error) {
		return Target{URL: server.URL, Method: "GET"}, nil
	})
	a.Client = &http.Client{Timeout: 2 * time.Second}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		Title:    "Hello",
		Receiver: []string{"alice"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(gotQuery, "title=Hello") {
		t.Errorf("expected title query param, got %s", gotQuery)
	}
}

func TestConsumerNotification_SkipsUnconfiguredUser(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
	}))
	defer server.Close()

	a := NewWebhookNotificationAgent(func(u string) (Target, error) {
		return Target{}, nil //no URL configured
	})
	a.Client = &http.Client{Timeout: 2 * time.Second}

	if err := a.ConsumerNotification(&notification.NotificationPayload{Receiver: []string{"bob"}}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 0 {
		t.Errorf("expected no webhook calls, got %d", calls)
	}
}

func TestConsumerNotification_ErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	a := NewWebhookNotificationAgent(func(u string) (Target, error) {
		return Target{URL: server.URL, Method: "POST"}, nil
	})
	a.Client = &http.Client{Timeout: 2 * time.Second}

	err := a.ConsumerNotification(&notification.NotificationPayload{
		Title:    "Hi",
		Receiver: []string{"alice"},
	})
	if err == nil {
		t.Error("expected error for non-2xx webhook response")
	}
}

func TestConsumerNotification_NoResolver(t *testing.T) {
	a := &Agent{}
	if err := a.ConsumerNotification(&notification.NotificationPayload{Receiver: []string{"x"}}); err == nil {
		t.Error("expected error when no resolver configured")
	}
}

func TestProduceNotification_NoOp(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ProduceNotification panicked: %v", r)
		}
	}()
	NewWebhookNotificationAgent(nil).ProduceNotification(nil)
}
