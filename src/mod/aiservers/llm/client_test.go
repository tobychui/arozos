package llm

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewClientDefaults(t *testing.T) {
	c := NewClient(" https://api.openai.com/v1 ", "", "weird-format", 0)
	if c.Endpoint != "https://api.openai.com/v1" {
		t.Errorf("endpoint not trimmed: %q", c.Endpoint)
	}
	if c.APIFormat != "openai" {
		t.Errorf("unrecognised format should default to openai, got %q", c.APIFormat)
	}
	if c.HTTP.Timeout != DefaultTimeout {
		t.Errorf("expected default timeout, got %v", c.HTTP.Timeout)
	}
}

func TestClientChatOpenAI(t *testing.T) {
	var gotPath, gotAuth, gotModel string
	var sawUserMessage bool

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		var req openaiChatRequest
		json.Unmarshal(body, &req)
		gotModel = req.Model
		for _, msg := range req.Messages {
			if msg.Role == "user" {
				sawUserMessage = true
			}
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"test-model",
			"choices":[{"index":0,"message":{"role":"assistant","content":"Hello from mock"},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500}}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "test-key", "openai", 0)
	resp, err := c.Chat([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "test-model"})
	if err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content != "Hello from mock" {
		t.Errorf("unexpected response: %+v", resp)
	}
	if gotPath != "/chat/completions" {
		t.Errorf("expected /chat/completions, got %q", gotPath)
	}
	if gotAuth != "Bearer test-key" {
		t.Errorf("expected bearer auth header, got %q", gotAuth)
	}
	if gotModel != "test-model" {
		t.Errorf("model not forwarded, got %q", gotModel)
	}
	if !sawUserMessage {
		t.Error("server did not receive a user message")
	}
	if resp.Usage.TotalTokens != 1500 {
		t.Errorf("usage not decoded: %+v", resp.Usage)
	}
}

func TestClientChatOpenAINoAuthHeaderWhenNoKey(t *testing.T) {
	var gotAuth string
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gotAuth = r.Header.Get("Authorization")
		io.WriteString(w, `{"model":"m","choices":[{"message":{"role":"assistant","content":"hi"}}]}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", "openai", 0)
	if _, err := c.Chat([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("server was not called")
	}
	if gotAuth != "" {
		t.Errorf("expected no Authorization header, got %q", gotAuth)
	}
}

func TestClientChatOpenAIErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":{"message":"invalid api key","type":"authentication_error"}}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "bad-key", "openai", 0)
	_, err := c.Chat([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"})
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("expected the endpoint's error message to surface, got: %v", err)
	}
}

func TestClientChatTimingRecorded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(25 * time.Millisecond) //ensure a measurable generation time
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"m","choices":[{"message":{"role":"assistant","content":"hello world"}}],
			"usage":{"prompt_tokens":5,"completion_tokens":20,"total_tokens":25}}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", "openai", 0)
	resp, err := c.Chat([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Usage.GenerationMs <= 0 {
		t.Errorf("expected generation_ms > 0, got %d", resp.Usage.GenerationMs)
	}
	if resp.Usage.TokensPerSecond <= 0 {
		t.Errorf("expected tokens_per_second > 0, got %v", resp.Usage.TokensPerSecond)
	}
}

func TestClientListModelsOpenAI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		io.WriteString(w, `{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL+"/v1", "", "openai", 0)
	models, err := c.ListModels()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(models) != 2 || models[0] != "gpt-4o" {
		t.Errorf("unexpected models: %+v", models)
	}
}
