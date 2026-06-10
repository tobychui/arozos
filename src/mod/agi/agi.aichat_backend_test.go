package agi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

/*
	Backend script tests for the AI Chat demo app (web/AIChat/backend/*.agi).

	These execute the real .agi scripts inside an otto VM with the real aimodel
	library injected (pointed at a mock OpenAI-compatible server), so the demo
	app's backend logic is verified without a running arozos server or a real
	model endpoint.
*/

// runAIChatBackend loads a backend script, injects the aimodel lib + stubs for
// requirelib/sendJSONResp, sets the given POST params and returns whatever the
// script passed to sendJSONResp.
func runAIChatBackend(t *testing.T, g *Gateway, scriptRelPath string, params map[string]string) string {
	t.Helper()
	vm := otto.New()
	g.injectAIModelFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

	//requirelib is a no-op here: the lib is already injected above.
	vm.Set("requirelib", func(call otto.FunctionCall) otto.Value {
		v, _ := vm.ToValue(true)
		return v
	})

	var captured string
	vm.Set("sendJSONResp", func(call otto.FunctionCall) otto.Value {
		captured, _ = call.Argument(0).ToString()
		return otto.UndefinedValue()
	})

	for k, v := range params {
		vm.Set(k, v)
	}

	scriptPath := filepath.Join("..", "..", "web", scriptRelPath)
	content, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Fatalf("cannot read backend script %s: %v", scriptPath, err)
	}
	if _, err := vm.Run(string(content)); err != nil {
		t.Fatalf("backend script %s errored: %v", scriptRelPath, err)
	}
	return captured
}

func TestAIChatBackend_Chat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		//The system prompt set via options must reach the endpoint.
		if !strings.Contains(string(body), "be a pirate") {
			t.Errorf("system prompt was not forwarded; body=%s", string(body))
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"test-model",
			"choices":[{"message":{"role":"assistant","content":"Arr, hello!"}}],
			"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}`)
	}))
	defer srv.Close()

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{Endpoint: srv.URL, DefaultModel: "test-model", Currency: "USD"})

	out := runAIChatBackend(t, g, "AIChat/backend/chat.agi", map[string]string{
		"messages": `[{"role":"user","content":"hi"}]`,
		"options":  `{"model":"test-model","system":"be a pirate"}`,
	})

	if !strings.Contains(out, `"ok":true`) {
		t.Fatalf("expected ok:true, got: %s", out)
	}
	if !strings.Contains(out, "Arr, hello!") {
		t.Errorf("assistant content missing from response: %s", out)
	}
	if !strings.Contains(out, `"total_tokens":16`) {
		t.Errorf("usage missing from response: %s", out)
	}
}

func TestAIChatBackend_ChatNoEndpointReturnsError(t *testing.T) {
	g := dbGateway(t) //no config written -> endpoint unset
	out := runAIChatBackend(t, g, "AIChat/backend/chat.agi", map[string]string{
		"messages": `[{"role":"user","content":"hi"}]`,
		"options":  `{}`,
	})
	if !strings.Contains(out, `"ok":false`) {
		t.Fatalf("expected ok:false when endpoint missing, got: %s", out)
	}
	if !strings.Contains(strings.ToLower(out), "endpoint") {
		t.Errorf("expected an endpoint-related error message, got: %s", out)
	}
}

func TestAIChatBackend_Models(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(aiModelDBTable, "config", AIModelConfig{DefaultModel: "test-model", Currency: "USD"})
	sysdb.Write(aiModelDBTable, "pricing", map[string]AIModelPricing{
		"test-model": {InputPrice: 1, OutputPrice: 2},
		"other":      {InputPrice: 3, OutputPrice: 4},
	})

	out := runAIChatBackend(t, g, "AIChat/backend/models.agi", map[string]string{})
	if !strings.Contains(out, `"default":"test-model"`) {
		t.Errorf("default model missing: %s", out)
	}
	if !strings.Contains(out, "test-model") || !strings.Contains(out, "other") {
		t.Errorf("configured models missing: %s", out)
	}
}
