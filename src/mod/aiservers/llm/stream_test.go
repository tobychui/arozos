package llm

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// collectDeltas runs a streaming Chat against srv and returns the assembled
// response plus the ordered content and reasoning pieces seen by the callback.
func collectDeltas(t *testing.T, srv *httptest.Server, format string) (*ChatResponse, []string, []string) {
	t.Helper()
	var contentSeen, reasoningSeen []string
	c := NewClient(srv.URL, "k", format, 0)
	resp, err := c.ChatStream([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"}, func(d StreamDelta) {
		if d.Content != "" {
			contentSeen = append(contentSeen, d.Content)
		}
		if d.Reasoning != "" {
			reasoningSeen = append(reasoningSeen, d.Reasoning)
		}
	})
	if err != nil {
		t.Fatalf("ChatStream error: %v", err)
	}
	return resp, contentSeen, reasoningSeen
}

func TestChatStreamOpenAI(t *testing.T) {
	var gotStream, gotIncludeUsage bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotStream = strings.Contains(string(body), `"stream":true`)
		gotIncludeUsage = strings.Contains(string(body), `"include_usage":true`)
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"model\":\"m\",\"choices\":[{\"delta\":{\"reasoning_content\":\"think \"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"more\"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2,\"total_tokens\":9}}\n\n")
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	resp, content, reasoning := collectDeltas(t, srv, "openai")

	if !gotStream {
		t.Error("request did not set stream:true")
	}
	if !gotIncludeUsage {
		t.Error("request did not ask for usage via stream_options.include_usage")
	}
	if got := strings.Join(content, ""); got != "Hello" {
		t.Errorf("assembled content = %q, want Hello", got)
	}
	if len(content) != 2 {
		t.Errorf("expected 2 content deltas, got %d (%v)", len(content), content)
	}
	if got := strings.Join(reasoning, ""); got != "think more" {
		t.Errorf("assembled reasoning = %q, want 'think more'", got)
	}
	if resp.Choices[0].Message.Content != "Hello" || resp.Choices[0].Message.ReasoningContent != "think more" {
		t.Errorf("final message wrong: %+v", resp.Choices[0].Message)
	}
	if resp.Usage.TotalTokens != 9 {
		t.Errorf("usage not captured from final chunk: %+v", resp.Usage)
	}
}

func TestChatStreamOpenAIErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":{"message":"bad key","type":"auth"}}`)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "bad", "openai", 0)
	_, err := c.ChatStream([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"}, nil)
	if err == nil || !strings.Contains(err.Error(), "bad key") {
		t.Fatalf("expected the endpoint error to surface, got: %v", err)
	}
}

func TestChatStreamAnthropic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"stream":true`) {
			t.Error("anthropic stream request did not set stream:true")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-x\",\"usage\":{\"input_tokens\":11,\"output_tokens\":0}}}\n\n")
		io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"reason \"}}\n\n")
		io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"bit\"}}\n\n")
		io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\n")
		io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"there\"}}\n\n")
		io.WriteString(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":4}}\n\n")
		io.WriteString(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer srv.Close()

	resp, content, reasoning := collectDeltas(t, srv, "anthropic")

	if got := strings.Join(content, ""); got != "Hi there" {
		t.Errorf("assembled content = %q, want 'Hi there'", got)
	}
	if got := strings.Join(reasoning, ""); got != "reason bit" {
		t.Errorf("assembled reasoning = %q, want 'reason bit'", got)
	}
	if resp.Choices[0].Message.Content != "Hi there" || resp.Choices[0].Message.ReasoningContent != "reason bit" {
		t.Errorf("final message wrong: %+v", resp.Choices[0].Message)
	}
	//Usage spans message_start (input) and message_delta (output).
	if resp.Usage.PromptTokens != 11 || resp.Usage.CompletionTokens != 4 || resp.Usage.TotalTokens != 15 {
		t.Errorf("usage not assembled correctly: %+v", resp.Usage)
	}
}

func TestChatStreamAnthropicErrorEvent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"overloaded\"}}\n\n")
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "k", "anthropic", 0)
	_, err := c.ChatStream([]Message{{Role: "user", Content: "hi"}}, ChatOptions{Model: "m"}, nil)
	if err == nil || !strings.Contains(err.Error(), "overloaded") {
		t.Fatalf("expected the streamed error event to surface, got: %v", err)
	}
}
