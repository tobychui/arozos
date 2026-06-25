package llm

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientChatAnthropic(t *testing.T) {
	var gotPath, gotKey, gotVersion string
	var captured anthropicRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &captured)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"claude-x",
			"content":[{"type":"text","text":"Hi from Claude"}],
			"usage":{"input_tokens":30,"output_tokens":12},
			"stop_reason":"end_turn"}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "anthropic-key", "anthropic", 0)

	//A system message in the unified array must be lifted to the top-level field.
	msgs := []Message{
		{Role: "system", Content: "be brief"},
		{Role: "user", Content: "hello"},
	}
	resp, err := c.Chat(msgs, ChatOptions{Model: "claude-x"})
	if err != nil {
		t.Fatalf("anthropic request errored: %v", err)
	}
	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content != "Hi from Claude" {
		t.Errorf("unexpected response: %+v", resp)
	}
	if gotPath != "/v1/messages" {
		t.Errorf("expected /v1/messages, got %q", gotPath)
	}
	if gotKey != "anthropic-key" {
		t.Errorf("expected x-api-key header, got %q", gotKey)
	}
	if gotVersion == "" {
		t.Errorf("expected anthropic-version header to be set")
	}
	if captured.System != "be brief" {
		t.Errorf("system prompt not lifted to top-level: %q", captured.System)
	}
	if captured.MaxTokens <= 0 {
		t.Errorf("anthropic requires max_tokens > 0, got %d", captured.MaxTokens)
	}
	for _, m := range captured.Messages {
		if m.Role == "system" {
			t.Errorf("system role must not appear in messages array")
		}
	}
	//Usage mapping: input->prompt, output->completion.
	if resp.Usage.PromptTokens != 30 || resp.Usage.CompletionTokens != 12 || resp.Usage.TotalTokens != 42 {
		t.Errorf("usage not mapped correctly: %+v", resp.Usage)
	}
}

func TestClientChatAnthropicErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"error":{"type":"invalid_request_error","message":"max_tokens is required"}}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "k", "anthropic", 0)
	_, err := c.Chat([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "claude-x"})
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestClientListModelsAnthropic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("anthropic-version") == "" {
			t.Errorf("expected anthropic-version header")
		}
		io.WriteString(w, `{"data":[{"id":"claude-3-5-sonnet"}]}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "k", "anthropic", 0)
	models, err := c.ListModels()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(models) != 1 || models[0] != "claude-3-5-sonnet" {
		t.Errorf("unexpected models: %+v", models)
	}
}

func TestAnthropicImageBlock(t *testing.T) {
	b := anthropicImageBlock("data:image/png;base64,AAAA")
	if b.Type != "image" || b.Source == nil || b.Source.Type != "base64" ||
		b.Source.MediaType != "image/png" || b.Source.Data != "AAAA" {
		t.Errorf("data URI not parsed into base64 source: %+v", b.Source)
	}
	u := anthropicImageBlock("https://example.com/cat.png")
	if u.Source == nil || u.Source.Type != "url" || u.Source.URL != "https://example.com/cat.png" {
		t.Errorf("remote URL not parsed into url source: %+v", u.Source)
	}
}

func TestToAnthropicContent(t *testing.T) {
	if s, ok := toAnthropicContent("plain").(string); !ok || s != "plain" {
		t.Errorf("string content should pass through")
	}
	//Simulate JSON-decoded OpenAI-style parts.
	parts := []interface{}{
		map[string]interface{}{"type": "text", "text": "look"},
		map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": "data:image/jpeg;base64,ZZ"}},
	}
	out, ok := toAnthropicContent(parts).([]anthropicContentBlock)
	if !ok || len(out) != 2 {
		t.Fatalf("expected 2 content blocks, got %#v", out)
	}
	if out[0].Type != "text" || out[1].Type != "image" {
		t.Errorf("unexpected block types: %+v", out)
	}
}

func TestAnthropicURL(t *testing.T) {
	cases := map[string]string{
		"https://api.anthropic.com":             "https://api.anthropic.com/v1/messages",
		"https://api.anthropic.com/v1":          "https://api.anthropic.com/v1/messages",
		"https://api.anthropic.com/v1/":         "https://api.anthropic.com/v1/messages",
		"https://api.anthropic.com/v1/messages": "https://api.anthropic.com/v1/messages",
	}
	for in, want := range cases {
		if got := anthropicURL(in); got != want {
			t.Errorf("anthropicURL(%q) = %q, want %q", in, got, want)
		}
	}
}
