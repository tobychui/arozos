package agi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	llm "imuslab.com/arozos/mod/aiservers/llm"
	database "imuslab.com/arozos/mod/database"
	user "imuslab.com/arozos/mod/user"
)

// dbGateway returns a Gateway backed by a throwaway bolt database so the
// config / pricing / metrics persistence paths can be exercised in tests.
// Shared by every *_test.go file in this package (llm, cnn, ...).
func dbGateway(t *testing.T) *Gateway {
	t.Helper()
	dbfile := filepath.Join(t.TempDir(), "test.db")
	sysdb, err := database.NewDatabase(dbfile, false)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	t.Cleanup(func() { sysdb.Close() })

	uh, err := user.NewUserHandler(sysdb, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("failed to create user handler: %v", err)
	}

	g := minimalGateway()
	g.Option.UserHandler = uh
	sysdb.NewTable(llmDBTable)
	return g
}

// ─── pure helpers ─────────────────────────────────────────────────────────────

func TestParseLLMCallOptions(t *testing.T) {
	if opt := parseLLMCallOptions(""); opt.Model != "" {
		t.Errorf("empty string should yield zero options")
	}
	if opt := parseLLMCallOptions("undefined"); opt.Model != "" {
		t.Errorf("'undefined' should yield zero options")
	}
	if opt := parseLLMCallOptions("null"); opt.Model != "" {
		t.Errorf("'null' should yield zero options")
	}
	opt := parseLLMCallOptions(`{"model":"gpt-4o","system":"be brief","temperature":0.5,"max_tokens":42}`)
	if opt.Model != "gpt-4o" || opt.System != "be brief" {
		t.Errorf("unexpected parse: %+v", opt)
	}
	if opt.Temperature == nil || *opt.Temperature != 0.5 {
		t.Errorf("temperature not parsed")
	}
	if opt.MaxTokens == nil || *opt.MaxTokens != 42 {
		t.Errorf("max_tokens not parsed")
	}
}

func TestLLMMaskKey(t *testing.T) {
	cases := map[string]string{
		"":              "",
		"abc":           "•••",
		"sk-1234567890": "••••7890",
	}
	for in, want := range cases {
		if got := llmMaskKey(in); got != want {
			t.Errorf("maskKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLLMExtClassification(t *testing.T) {
	if !llmIsImageExt(".png") || !llmIsImageExt(".jpeg") {
		t.Error("expected image extensions to be detected")
	}
	if llmIsImageExt(".txt") {
		t.Error(".txt should not be an image")
	}
	if !llmIsTextExt(".md") || !llmIsTextExt(".go") {
		t.Error("expected text extensions to be detected")
	}
	if llmIsTextExt(".png") {
		t.Error(".png should not be classified as text")
	}
}

// ─── persistence ──────────────────────────────────────────────────────────────

func TestRecordLLMUsageAccumulatesAndCosts(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()

	//Pricing: $2.50 / 1M input, $10.00 / 1M output
	sysdb.Write(llmDBTable, "pricing", map[string]LLMPricing{
		"test-model": {InputPrice: 2.5, OutputPrice: 10.0},
	})

	g.recordLLMUsage("test-model", 1000, 500)
	g.recordLLMUsage("test-model", 1000, 500)

	m := g.getLLMMetrics()
	if m.TotalRequests != 2 {
		t.Errorf("expected 2 requests, got %d", m.TotalRequests)
	}
	if m.TotalPromptTokens != 2000 || m.TotalCompletionTokens != 1000 || m.TotalTokens != 3000 {
		t.Errorf("unexpected token totals: %+v", m)
	}
	//Each call: 1000/1e6*2.5 + 500/1e6*10 = 0.0075 ; two calls => 0.015
	if got := m.TotalCost; got < 0.01499 || got > 0.01501 {
		t.Errorf("expected total cost ~0.015, got %v", got)
	}
	rec := m.PerModel["test-model"]
	if rec == nil || rec.Requests != 2 || rec.TotalTokens != 3000 {
		t.Errorf("per-model record incorrect: %+v", rec)
	}
}

func TestGetLLMConfigDefaultsCurrency(t *testing.T) {
	g := dbGateway(t)
	cfg := g.getLLMConfig()
	if cfg.Currency != "USD" {
		t.Errorf("expected default currency USD, got %q", cfg.Currency)
	}
}

// ─── orchestration (config resolution + metrics recording) ──────────────────
// Wire-protocol mechanics (request shape, auth headers, response decoding)
// are covered by mod/aiservers/llm's own tests; these only verify that the
// AGI-layer orchestrator wires the client and the persisted config/metrics
// together correctly.

func TestLLMDoRequestFlow(t *testing.T) {
	var gotModel string
	var sawUserMessage bool

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Role string `json:"role"`
			} `json:"messages"`
		}
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

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{
		Endpoint:     srv.URL,
		APIKey:       "test-key",
		DefaultModel: "test-model",
		Currency:     "USD",
	})
	sysdb.Write(llmDBTable, "pricing", map[string]LLMPricing{
		"test-model": {InputPrice: 2.5, OutputPrice: 10.0},
	})

	resp, err := g.llmDoRequest("", []llm.Message{{Role: "user", Content: "hi"}}, llmCallOptions{})
	if err != nil {
		t.Fatalf("llmDoRequest returned error: %v", err)
	}
	if content := llmExtractContent(resp); content != "Hello from mock" {
		t.Errorf("unexpected content: %q", content)
	}
	if gotModel != "test-model" {
		t.Errorf("expected default model to be used, got %q", gotModel)
	}
	if !sawUserMessage {
		t.Error("server did not receive a user message")
	}

	//Metrics should have been recorded from the usage block
	m := g.getLLMMetrics()
	if m.TotalRequests != 1 || m.TotalTokens != 1500 {
		t.Errorf("metrics not recorded after request: %+v", m)
	}
}

func TestLLMDoRequestNoEndpoint(t *testing.T) {
	g := dbGateway(t)
	_, err := g.llmDoRequest("m", []llm.Message{{Role: "user", Content: "hi"}}, llmCallOptions{})
	if err == nil {
		t.Error("expected error when endpoint is not configured")
	}
}

func TestLLMDoRequestAnthropicFlow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"claude-x",
			"content":[{"type":"text","text":"Hi from Claude"}],
			"usage":{"input_tokens":30,"output_tokens":12},
			"stop_reason":"end_turn"}`)
	}))
	defer srv.Close()

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{
		Endpoint: srv.URL, APIKey: "anthropic-key", DefaultModel: "claude-x", APIFormat: "anthropic", Currency: "USD",
	})

	//A system message in the unified array must be lifted to the top-level field
	//(verified directly in mod/aiservers/llm); here we only check the result
	//that reaches the AGI layer and that usage gets recorded.
	msgs := []llm.Message{
		{Role: "system", Content: "be brief"},
		{Role: "user", Content: "hello"},
	}
	resp, err := g.llmDoRequest("", msgs, llmCallOptions{})
	if err != nil {
		t.Fatalf("anthropic request errored: %v", err)
	}
	if content := llmExtractContent(resp); content != "Hi from Claude" {
		t.Errorf("unexpected content: %q", content)
	}

	//Usage mapping: input->prompt, output->completion.
	m := g.getLLMMetrics()
	if m.TotalPromptTokens != 30 || m.TotalCompletionTokens != 12 || m.TotalTokens != 42 {
		t.Errorf("usage not mapped/recorded correctly: %+v", m)
	}
}

func TestLLMDoRequestRecordsTokensPerSecond(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(25 * time.Millisecond) //ensure a measurable generation time
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"m","choices":[{"message":{"role":"assistant","content":"hello world"}}],
			"usage":{"prompt_tokens":5,"completion_tokens":20,"total_tokens":25}}`)
	}))
	defer srv.Close()

	g := dbGateway(t)
	g.Option.UserHandler.GetDatabase().Write(llmDBTable, "config", LLMConfig{Endpoint: srv.URL, DefaultModel: "m", APIFormat: "openai"})

	resp, err := g.llmDoRequest("", []llm.Message{{Role: "user", Content: "hi"}}, llmCallOptions{})
	if err != nil {
		t.Fatalf("request errored: %v", err)
	}
	if resp.Usage.GenerationMs <= 0 {
		t.Errorf("expected generation_ms > 0, got %d", resp.Usage.GenerationMs)
	}
	if resp.Usage.TokensPerSecond <= 0 {
		t.Errorf("expected tokens_per_second > 0, got %v", resp.Usage.TokensPerSecond)
	}

	m := g.getLLMMetrics()
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
func TestLLMAverageSpeedIsMeanOfRequests(t *testing.T) {
	g := dbGateway(t)
	//Request A: 10 tokens in 1000ms -> 10 tok/s
	g.recordLLMUsage("m", 0, 10, 1000)
	//Request B: 1000 tokens in 10000ms -> 100 tok/s
	g.recordLLMUsage("m", 0, 1000, 10000)

	m := g.getLLMMetrics()
	if m.SpeedSamples != 2 {
		t.Fatalf("expected 2 speed samples, got %d", m.SpeedSamples)
	}
	avg := m.SpeedSum / float64(m.SpeedSamples)
	//Mean of speeds = (10 + 100) / 2 = 55 (NOT throughput 1010/11 ≈ 91.8).
	if avg < 54.9 || avg > 55.1 {
		t.Errorf("expected average speed ~55 tok/s, got %v", avg)
	}
}

// ─── quota enforcement ──────────────────────────────────────────────────────

func TestLLMQuotaEnforcement(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "quota", LLMQuota{Enabled: true, MaxTokens: 100, Period: "total"})

	//Under the cap -> allowed.
	if err := g.llmCheckQuota(); err != nil {
		t.Fatalf("expected no error under quota, got %v", err)
	}

	//Consume past the cap.
	g.recordLLMUsage("m", 80, 40) // 120 tokens > 100
	if err := g.llmCheckQuota(); err == nil {
		t.Error("expected quota error after exceeding token cap")
	} else if !strings.Contains(err.Error(), "quota") {
		t.Errorf("expected a quota error, got %v", err)
	}

	//Disabling the quota lifts the block.
	sysdb.Write(llmDBTable, "quota", LLMQuota{Enabled: false, MaxTokens: 100, Period: "total"})
	if err := g.llmCheckQuota(); err != nil {
		t.Errorf("disabled quota should not block, got %v", err)
	}
}

func TestLLMDoRequestBlockedByQuota(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{Endpoint: "http://127.0.0.1:0", DefaultModel: "m", APIFormat: "openai"})
	sysdb.Write(llmDBTable, "quota", LLMQuota{Enabled: true, MaxTokens: 10, Period: "total"})
	g.recordLLMUsage("m", 20, 0) // exceed

	_, err := g.llmDoRequest("m", []llm.Message{{Role: "user", Content: "hi"}}, llmCallOptions{})
	if err == nil || !strings.Contains(err.Error(), "quota") {
		t.Errorf("expected request to be blocked by quota, got %v", err)
	}
}

func TestLLMWindowExpired(t *testing.T) {
	now := time.Date(2026, 6, 11, 12, 0, 0, 0, time.UTC)
	if !llmWindowExpired(0, "daily", now) {
		t.Error("zero start should be considered expired")
	}
	yesterday := now.AddDate(0, 0, -1).Unix()
	if !llmWindowExpired(yesterday, "daily", now) {
		t.Error("yesterday should be expired for daily period")
	}
	if llmWindowExpired(now.Add(-1*time.Hour).Unix(), "daily", now) {
		t.Error("same day should not be expired for daily period")
	}
	lastMonth := now.AddDate(0, -1, 0).Unix()
	if !llmWindowExpired(lastMonth, "monthly", now) {
		t.Error("last month should be expired for monthly period")
	}
	if llmWindowExpired(now.AddDate(0, -1, 0).Unix(), "total", now) {
		t.Error("total period should never expire")
	}
}

// ─── config handler masking ─────────────────────────────────────────────────
// HandleAIModelConfig keeps its original name/route - only the requirelib
// identifier exposed to AGI scripts changed.

func TestHandleAIModelConfigMaskingAndKeyRetention(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{
		Endpoint: "https://api.example.com/v1", APIKey: "sk-supersecret9999", DefaultModel: "m", Currency: "USD",
	})

	//GET should mask the key
	rec := httptest.NewRecorder()
	g.HandleAIModelConfig(rec, httptest.NewRequest("GET", "/system/aimodel/config", nil))
	var got map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["hasKey"] != true {
		t.Errorf("expected hasKey true, got %v", got["hasKey"])
	}
	if hint, _ := got["keyHint"].(string); !strings.HasSuffix(hint, "9999") || strings.Contains(hint, "supersecret") {
		t.Errorf("key not properly masked: %v", got["keyHint"])
	}

	//POST without apikey should retain the saved key, but update endpoint
	form := url.Values{}
	form.Set("endpoint", "https://new.example.com/v1")
	form.Set("defaultModel", "m2")
	form.Set("currency", "EUR")
	req := httptest.NewRequest("POST", "/system/aimodel/config", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	g.HandleAIModelConfig(httptest.NewRecorder(), req)

	cfg := g.getLLMConfig()
	if cfg.APIKey != "sk-supersecret9999" {
		t.Errorf("API key should have been retained, got %q", cfg.APIKey)
	}
	if cfg.Endpoint != "https://new.example.com/v1" || cfg.DefaultModel != "m2" || cfg.Currency != "EUR" {
		t.Errorf("config not updated correctly: %+v", cfg)
	}
}

// ─── JS object exposure ─────────────────────────────────────────────────────

func TestInjectLLMLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "alice"}}
	g.injectLLMFunctions(payload)

	for _, method := range []string{"chat", "chatWithFile", "request", "usage", "models"} {
		val, err := vm.Run(`typeof llm.` + method)
		if err != nil {
			t.Fatalf("evaluating llm.%s: %v", method, err)
		}
		s, _ := val.ToString()
		if s != "function" {
			t.Errorf("llm.%s should be a function, got %q", method, s)
		}
	}
}
