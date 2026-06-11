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

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	database "imuslab.com/arozos/mod/database"
	user "imuslab.com/arozos/mod/user"
)

// dbGateway returns a Gateway backed by a throwaway bolt database so the
// config / pricing / metrics persistence paths can be exercised in tests.
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
	sysdb.NewTable(aiModelDBTable)
	return g
}

// ─── pure helpers ─────────────────────────────────────────────────────────────

func TestParseAIModelOptions(t *testing.T) {
	if opt := parseAIModelOptions(""); opt.Model != "" {
		t.Errorf("empty string should yield zero options")
	}
	if opt := parseAIModelOptions("undefined"); opt.Model != "" {
		t.Errorf("'undefined' should yield zero options")
	}
	if opt := parseAIModelOptions("null"); opt.Model != "" {
		t.Errorf("'null' should yield zero options")
	}
	opt := parseAIModelOptions(`{"model":"gpt-4o","system":"be brief","temperature":0.5,"max_tokens":42}`)
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

func TestAIModelMaskKey(t *testing.T) {
	cases := map[string]string{
		"":              "",
		"abc":           "•••",
		"sk-1234567890": "••••7890",
	}
	for in, want := range cases {
		if got := aiModelMaskKey(in); got != want {
			t.Errorf("maskKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAIModelExtClassification(t *testing.T) {
	if !aiModelIsImageExt(".png") || !aiModelIsImageExt(".jpeg") {
		t.Error("expected image extensions to be detected")
	}
	if aiModelIsImageExt(".txt") {
		t.Error(".txt should not be an image")
	}
	if !aiModelIsTextExt(".md") || !aiModelIsTextExt(".go") {
		t.Error("expected text extensions to be detected")
	}
	if aiModelIsTextExt(".png") {
		t.Error(".png should not be classified as text")
	}
}

// ─── persistence ──────────────────────────────────────────────────────────────

func TestRecordAIModelUsageAccumulatesAndCosts(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()

	//Pricing: $2.50 / 1M input, $10.00 / 1M output
	sysdb.Write(aiModelDBTable, "pricing", map[string]AIModelPricing{
		"test-model": {InputPrice: 2.5, OutputPrice: 10.0},
	})

	g.recordAIModelUsage("test-model", 1000, 500)
	g.recordAIModelUsage("test-model", 1000, 500)

	m := g.getAIModelMetrics()
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

func TestGetAIModelConfigDefaultsCurrency(t *testing.T) {
	g := dbGateway(t)
	cfg := g.getAIModelConfig()
	if cfg.Currency != "USD" {
		t.Errorf("expected default currency USD, got %q", cfg.Currency)
	}
}

// ─── full request flow against a mock OpenAI-compatible server ──────────────────

func TestAIModelDoRequestFlow(t *testing.T) {
	var gotPath, gotAuth, gotModel string
	var sawUserMessage bool

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		var req aiChatRequest
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
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{
		Endpoint:     srv.URL,
		APIKey:       "test-key",
		DefaultModel: "test-model",
		Currency:     "USD",
	})
	sysdb.Write(aiModelDBTable, "pricing", map[string]AIModelPricing{
		"test-model": {InputPrice: 2.5, OutputPrice: 10.0},
	})

	resp, err := g.aiModelDoRequest("", []aiChatMessage{{Role: "user", Content: "hi"}}, aiChatOptions{})
	if err != nil {
		t.Fatalf("aiModelDoRequest returned error: %v", err)
	}
	if content := aiModelExtractContent(resp); content != "Hello from mock" {
		t.Errorf("unexpected content: %q", content)
	}
	if gotPath != "/chat/completions" {
		t.Errorf("expected /chat/completions, got %q", gotPath)
	}
	if gotAuth != "Bearer test-key" {
		t.Errorf("expected bearer auth header, got %q", gotAuth)
	}
	if gotModel != "test-model" {
		t.Errorf("expected default model to be used, got %q", gotModel)
	}
	if !sawUserMessage {
		t.Error("server did not receive a user message")
	}

	//Metrics should have been recorded from the usage block
	m := g.getAIModelMetrics()
	if m.TotalRequests != 1 || m.TotalTokens != 1500 {
		t.Errorf("metrics not recorded after request: %+v", m)
	}
}

func TestAIModelDoRequestNoEndpoint(t *testing.T) {
	g := dbGateway(t)
	_, err := g.aiModelDoRequest("m", []aiChatMessage{{Role: "user", Content: "hi"}}, aiChatOptions{})
	if err == nil {
		t.Error("expected error when endpoint is not configured")
	}
}

// ─── config handler masking ─────────────────────────────────────────────────────

func TestHandleAIModelConfigMaskingAndKeyRetention(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{
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

	cfg := g.getAIModelConfig()
	if cfg.APIKey != "sk-supersecret9999" {
		t.Errorf("API key should have been retained, got %q", cfg.APIKey)
	}
	if cfg.Endpoint != "https://new.example.com/v1" || cfg.DefaultModel != "m2" || cfg.Currency != "EUR" {
		t.Errorf("config not updated correctly: %+v", cfg)
	}
}

// ─── JS object exposure ─────────────────────────────────────────────────────────

func TestInjectAIModelLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "alice"}}
	g.injectAIModelFunctions(payload)

	for _, method := range []string{"chat", "chatWithFile", "request", "usage", "models"} {
		val, err := vm.Run(`typeof aimodel.` + method)
		if err != nil {
			t.Fatalf("evaluating aimodel.%s: %v", method, err)
		}
		s, _ := val.ToString()
		if s != "function" {
			t.Errorf("aimodel.%s should be a function, got %q", method, s)
		}
	}
}
