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

	These execute the real .agi scripts inside an otto VM with the real llm
	library injected (pointed at a mock OpenAI-compatible server), so the demo
	app's backend logic is verified without a running arozos server or a real
	model endpoint.
*/

// runAIChatBackend loads a backend script, injects the llm lib + stubs for
// requirelib/sendJSONResp, sets the given POST params and returns whatever the
// script passed to sendJSONResp.
func runAIChatBackend(t *testing.T, g *Gateway, scriptRelPath string, params map[string]string) string {
	t.Helper()
	vm := otto.New()
	g.injectLLMFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

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
	sysdb.Write(llmDBTable, "config", LLMConfig{Endpoint: srv.URL, DefaultModel: "test-model", Currency: "USD"})

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

func TestAIChatBackend_ChatSurfacesReasoning(t *testing.T) {
	//A reasoning model returns its chain-of-thought in reasoning_content; the
	//backend must forward it to the frontend as the "reasoning" field so the
	//UI can show it in a collapsible thinking section.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"reasoner",
			"choices":[{"message":{"role":"assistant","content":"4","reasoning_content":"2 plus 2 is 4."}}],
			"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`)
	}))
	defer srv.Close()

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{Endpoint: srv.URL, DefaultModel: "reasoner", Currency: "USD"})

	out := runAIChatBackend(t, g, "AIChat/backend/chat.agi", map[string]string{
		"messages": `[{"role":"user","content":"2+2?"}]`,
		"options":  `{"model":"reasoner"}`,
	})

	if !strings.Contains(out, `"ok":true`) {
		t.Fatalf("expected ok:true, got: %s", out)
	}
	if !strings.Contains(out, `"reasoning":"2 plus 2 is 4."`) {
		t.Errorf("reasoning was not surfaced in the response: %s", out)
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

// runAIChatStreamBackend runs the streaming backend script with the llm lib
// injected and a stubbed websocket object: the first read() yields reqJSON,
// send() captures every outgoing frame, and exit()/close() end the script.
// Returns the ordered list of JSON frames the script sent to the "client".
func runAIChatStreamBackend(t *testing.T, g *Gateway, reqJSON string) []string {
	t.Helper()
	vm := otto.New()
	g.injectLLMFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

	vm.Set("requirelib", func(call otto.FunctionCall) otto.Value {
		v, _ := vm.ToValue(true)
		return v
	})
	vm.Set("sendResp", func(call otto.FunctionCall) otto.Value { return otto.UndefinedValue() })
	vm.Set("exit", func(call otto.FunctionCall) otto.Value {
		panic(vm.MakeCustomError("AGIExit", "exit"))
	})

	var frames []string
	readCount := 0
	vm.Set("_ws_upgrade", func(call otto.FunctionCall) otto.Value { return otto.TrueValue() })
	vm.Set("_ws_read", func(call otto.FunctionCall) otto.Value {
		readCount++
		if readCount == 1 {
			v, _ := vm.ToValue(reqJSON)
			return v
		}
		return otto.FalseValue()
	})
	vm.Set("_ws_send", func(call otto.FunctionCall) otto.Value {
		s, _ := call.Argument(0).ToString()
		frames = append(frames, s)
		return otto.TrueValue()
	})
	vm.Set("_ws_close", func(call otto.FunctionCall) otto.Value { return otto.TrueValue() })
	vm.Run(`var websocket = { upgrade:_ws_upgrade, read:_ws_read, send:_ws_send, close:_ws_close, isClosed:function(){return false;} };`)

	scriptPath := filepath.Join("..", "..", "web", "AIChat/backend/chat_stream.agi")
	content, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Fatalf("cannot read chat_stream.agi: %v", err)
	}
	if _, err := vm.Run(string(content)); err != nil && !strings.Contains(err.Error(), "exit") {
		t.Fatalf("chat_stream.agi errored: %v", err)
	}
	return frames
}

func TestAIChatBackend_Stream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"stream":true`) {
			t.Errorf("streaming backend did not request a stream; body=%s", string(body))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"model\":\"m\",\"choices\":[{\"delta\":{\"reasoning_content\":\"pondering\"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hi \"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"there\"},\"finish_reason\":\"stop\"}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n")
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	g := dbGateway(t)
	g.Option.UserHandler.GetDatabase().Write(llmDBTable, "config", LLMConfig{Endpoint: srv.URL, DefaultModel: "m", Currency: "USD"})

	frames := runAIChatStreamBackend(t, g, `{"messages":[{"role":"user","content":"hi"}],"options":{"model":"m"}}`)

	joined := strings.Join(frames, "\n")
	if !strings.Contains(joined, `"type":"start"`) {
		t.Errorf("missing start frame; frames=%v", frames)
	}
	if !strings.Contains(joined, `"type":"reasoning"`) || !strings.Contains(joined, "pondering") {
		t.Errorf("reasoning was not streamed; frames=%v", frames)
	}
	if !strings.Contains(joined, `"type":"delta"`) || !strings.Contains(joined, "there") {
		t.Errorf("answer deltas were not streamed; frames=%v", frames)
	}
	//The terminal "done" frame carries the fully assembled reply + usage.
	last := frames[len(frames)-1]
	if !strings.Contains(last, `"type":"done"`) {
		t.Fatalf("last frame should be done, got: %s", last)
	}
	if !strings.Contains(last, `"content":"Hi there"`) {
		t.Errorf("done frame missing assembled content: %s", last)
	}
	if !strings.Contains(last, `"total_tokens":5`) {
		t.Errorf("done frame missing usage: %s", last)
	}
}

func TestAIChatBackend_StreamRecordsUsage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"model\":\"m\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":4,\"total_tokens\":12}}\n\n")
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	g := dbGateway(t)
	g.Option.UserHandler.GetDatabase().Write(llmDBTable, "config", LLMConfig{Endpoint: srv.URL, DefaultModel: "m", Currency: "USD"})

	runAIChatStreamBackend(t, g, `{"messages":[{"role":"user","content":"hi"}],"options":{"model":"m"}}`)

	//Streaming must feed the same metrics board as the blocking path.
	m := g.getLLMMetrics()
	if m.TotalRequests != 1 || m.TotalTokens != 12 {
		t.Errorf("streaming usage not recorded in metrics: %+v", m)
	}
}

func TestAIChatBackend_Models(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.Write(llmDBTable, "config", LLMConfig{DefaultModel: "test-model", Currency: "USD"})
	sysdb.Write(llmDBTable, "pricing", map[string]LLMPricing{
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
