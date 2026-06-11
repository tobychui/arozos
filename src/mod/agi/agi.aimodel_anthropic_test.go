package agi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── Anthropic request flow ─────────────────────────────────────────────────

func TestAIModelDoRequestAnthropicFlow(t *testing.T) {
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

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{
		Endpoint: srv.URL, APIKey: "anthropic-key", DefaultModel: "claude-x", APIFormat: "anthropic", Currency: "USD",
	})

	//A system message in the unified array must be lifted to the top-level field.
	msgs := []aiChatMessage{
		{Role: "system", Content: "be brief"},
		{Role: "user", Content: "hello"},
	}
	resp, err := g.aiModelDoRequest("", msgs, aiChatOptions{})
	if err != nil {
		t.Fatalf("anthropic request errored: %v", err)
	}
	if content := aiModelExtractContent(resp); content != "Hi from Claude" {
		t.Errorf("unexpected content: %q", content)
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
	m := g.getAIModelMetrics()
	if m.TotalPromptTokens != 30 || m.TotalCompletionTokens != 12 || m.TotalTokens != 42 {
		t.Errorf("usage not mapped/recorded correctly: %+v", m)
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

// ─── Quota enforcement ──────────────────────────────────────────────────────

func TestAIModelQuotaEnforcement(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "quota", AIModelQuota{Enabled: true, MaxTokens: 100, Period: "total"})

	//Under the cap -> allowed.
	if err := g.aiModelCheckQuota(); err != nil {
		t.Fatalf("expected no error under quota, got %v", err)
	}

	//Consume past the cap.
	g.recordAIModelUsage("m", 80, 40) // 120 tokens > 100
	if err := g.aiModelCheckQuota(); err == nil {
		t.Error("expected quota error after exceeding token cap")
	} else if !strings.Contains(err.Error(), "quota") {
		t.Errorf("expected a quota error, got %v", err)
	}

	//Disabling the quota lifts the block.
	sysdb.Write(aiModelDBTable, "quota", AIModelQuota{Enabled: false, MaxTokens: 100, Period: "total"})
	if err := g.aiModelCheckQuota(); err != nil {
		t.Errorf("disabled quota should not block, got %v", err)
	}
}

func TestAIModelDoRequestBlockedByQuota(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{Endpoint: "http://127.0.0.1:0", DefaultModel: "m", APIFormat: "openai"})
	sysdb.Write(aiModelDBTable, "quota", AIModelQuota{Enabled: true, MaxTokens: 10, Period: "total"})
	g.recordAIModelUsage("m", 20, 0) // exceed

	_, err := g.aiModelDoRequest("m", []aiChatMessage{{Role: "user", Content: "hi"}}, aiChatOptions{})
	if err == nil || !strings.Contains(err.Error(), "quota") {
		t.Errorf("expected request to be blocked by quota, got %v", err)
	}
}

func TestAIModelRecordsTokensPerSecond(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(25 * time.Millisecond) //ensure a measurable generation time
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"m","choices":[{"message":{"role":"assistant","content":"hello world"}}],
			"usage":{"prompt_tokens":5,"completion_tokens":20,"total_tokens":25}}`)
	}))
	defer srv.Close()

	g := dbGateway(t)
	g.Option.UserHandler.GetDatabase().Write(aiModelDBTable, "config", AIModelConfig{Endpoint: srv.URL, DefaultModel: "m", APIFormat: "openai"})

	resp, err := g.aiModelDoRequest("", []aiChatMessage{{Role: "user", Content: "hi"}}, aiChatOptions{})
	if err != nil {
		t.Fatalf("request errored: %v", err)
	}
	if resp.Usage.GenerationMs <= 0 {
		t.Errorf("expected generation_ms > 0, got %d", resp.Usage.GenerationMs)
	}
	if resp.Usage.TokensPerSecond <= 0 {
		t.Errorf("expected tokens_per_second > 0, got %v", resp.Usage.TokensPerSecond)
	}

	m := g.getAIModelMetrics()
	if m.TotalGenerationMs <= 0 {
		t.Errorf("expected total generation ms recorded, got %d", m.TotalGenerationMs)
	}
	if m.SpeedSamples != 1 || m.SpeedSum <= 0 {
		t.Errorf("expected one speed sample recorded, got samples=%d sum=%v", m.SpeedSamples, m.SpeedSum)
	}
	if rec := m.PerModel["m"]; rec == nil || rec.GenerationMs <= 0 || rec.SpeedSamples != 1 {
		t.Errorf("per-model speed sample not recorded: %+v", rec)
	}
}

// The average speed must be the mean of per-request speeds, not total tokens
// over total time (which is token-weighted and skews toward large requests).
func TestAIModelAverageSpeedIsMeanOfRequests(t *testing.T) {
	g := dbGateway(t)
	//Request A: 10 tokens in 1000ms -> 10 tok/s
	g.recordAIModelUsage("m", 0, 10, 1000)
	//Request B: 1000 tokens in 10000ms -> 100 tok/s
	g.recordAIModelUsage("m", 0, 1000, 10000)

	m := g.getAIModelMetrics()
	if m.SpeedSamples != 2 {
		t.Fatalf("expected 2 speed samples, got %d", m.SpeedSamples)
	}
	avg := m.SpeedSum / float64(m.SpeedSamples)
	//Mean of speeds = (10 + 100) / 2 = 55 (NOT throughput 1010/11 ≈ 91.8).
	if avg < 54.9 || avg > 55.1 {
		t.Errorf("expected average speed ~55 tok/s, got %v", avg)
	}
}

func TestAIModelWindowExpired(t *testing.T) {
	now := time.Date(2026, 6, 11, 12, 0, 0, 0, time.UTC)
	if !aiModelWindowExpired(0, "daily", now) {
		t.Error("zero start should be considered expired")
	}
	yesterday := now.AddDate(0, 0, -1).Unix()
	if !aiModelWindowExpired(yesterday, "daily", now) {
		t.Error("yesterday should be expired for daily period")
	}
	if aiModelWindowExpired(now.Add(-1*time.Hour).Unix(), "daily", now) {
		t.Error("same day should not be expired for daily period")
	}
	lastMonth := now.AddDate(0, -1, 0).Unix()
	if !aiModelWindowExpired(lastMonth, "monthly", now) {
		t.Error("last month should be expired for monthly period")
	}
	if aiModelWindowExpired(now.AddDate(0, -1, 0).Unix(), "total", now) {
		t.Error("total period should never expire")
	}
}
