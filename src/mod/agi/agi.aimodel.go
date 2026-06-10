package agi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI AI Model Library

	This library allows AGI scripts to call any OpenAI-compatible chat
	completion endpoint (OpenAI, Azure OpenAI, OpenRouter, Ollama, LM Studio,
	llama.cpp server, vLLM ...). It supports both plain text prompts and
	file-based prompts (images for vision models and text documents inlined
	into the conversation).

	The global endpoint / API key / default model are configured by an admin
	in System Settings > Developer Options > AI Model. Per-model pricing is
	also defined there so the system can keep a running tally of how many
	tokens have been consumed and how much it has cost.

	Author: tobychui (AGI), AI Model lib addition
*/

const (
	//aiModelDBTable is the system database table used to persist the AI model
	//configuration, per-model pricing and aggregated usage metrics.
	aiModelDBTable = "aimodel"

	//aiModelKeyMask is the sentinel value the frontend submits when the API
	//key field was left untouched. When received, the stored key is kept.
	aiModelKeyMask = "********"

	//aiModelRequestTimeout is the maximum time to wait for a completion.
	aiModelRequestTimeout = 120 * time.Second
)

// aiModelMetricsMux guards read-modify-write cycles on the metrics record so
// concurrent AGI scripts do not clobber each other's usage updates.
var aiModelMetricsMux sync.Mutex

// ── Persisted data structures ───────────────────────────────────────────────

// AIModelConfig holds the global, admin-configured connection settings.
type AIModelConfig struct {
	Endpoint     string `json:"endpoint"`     //OpenAI-compatible base URL, e.g. https://api.openai.com/v1
	APIKey       string `json:"apikey"`       //Bearer token sent in the Authorization header
	DefaultModel string `json:"defaultModel"` //Model used when a script does not specify one
	Currency     string `json:"currency"`     //Currency label used by the metrics board (default USD)
}

// AIModelPricing defines the price per 1,000,000 tokens for a given model.
type AIModelPricing struct {
	InputPrice  float64 `json:"inputPrice"`  //Cost per 1M prompt (input) tokens
	OutputPrice float64 `json:"outputPrice"` //Cost per 1M completion (output) tokens
}

// AIModelUsageRecord is the accumulated usage of a single model.
type AIModelUsageRecord struct {
	PromptTokens     int64   `json:"promptTokens"`
	CompletionTokens int64   `json:"completionTokens"`
	TotalTokens      int64   `json:"totalTokens"`
	Cost             float64 `json:"cost"`
	Requests         int64   `json:"requests"`
}

// AIModelMetrics is the aggregated consumption across every model.
type AIModelMetrics struct {
	TotalPromptTokens     int64                          `json:"totalPromptTokens"`
	TotalCompletionTokens int64                          `json:"totalCompletionTokens"`
	TotalTokens           int64                          `json:"totalTokens"`
	TotalCost             float64                        `json:"totalCost"`
	TotalRequests         int64                          `json:"totalRequests"`
	PerModel              map[string]*AIModelUsageRecord `json:"perModel"`
	Currency              string                         `json:"currency"`
	UpdatedAt             int64                          `json:"updatedAt"`
}

// ── OpenAI-compatible wire structures ────────────────────────────────────────

type aiContentImageURL struct {
	URL string `json:"url"`
}

type aiContentPart struct {
	Type     string             `json:"type"`
	Text     string             `json:"text,omitempty"`
	ImageURL *aiContentImageURL `json:"image_url,omitempty"`
}

type aiChatMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` //string for text, []aiContentPart for multimodal
}

type aiChatRequest struct {
	Model       string          `json:"model"`
	Messages    []aiChatMessage `json:"messages"`
	Temperature *float64        `json:"temperature,omitempty"`
	MaxTokens   *int            `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream"`
}

type aiChatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
		TotalTokens      int64 `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// aiChatOptions are the per-call options a script may pass as a JS object.
type aiChatOptions struct {
	Model       string   `json:"model"`       //Override the configured default model
	System      string   `json:"system"`      //Optional system prompt
	Endpoint    string   `json:"endpoint"`    //Override the global endpoint
	APIKey      string   `json:"apikey"`      //Override the global API key
	Temperature *float64 `json:"temperature"` //Sampling temperature
	MaxTokens   *int     `json:"max_tokens"`  //Maximum tokens to generate
}

// ── Library registration ─────────────────────────────────────────────────────

func (g *Gateway) AIModelLibRegister() {
	//Make sure the storage table exists before any read / write happens.
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists(aiModelDBTable) {
		sysdb.NewTable(aiModelDBTable)
	}

	err := g.RegisterLib("aimodel", g.injectAIModelFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectAIModelFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	//aimodel.chat(prompt, options) => assistant reply text
	vm.Set("_aimodel_chat", func(call otto.FunctionCall) otto.Value {
		prompt, _ := call.Argument(0).ToString()
		opt := parseAIModelOptions(getOttoStringArg(call, 1))

		messages := []aiChatMessage{}
		if strings.TrimSpace(opt.System) != "" {
			messages = append(messages, aiChatMessage{Role: "system", Content: opt.System})
		}
		messages = append(messages, aiChatMessage{Role: "user", Content: prompt})

		resp, err := g.aiModelDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("AIModelError", err.Error()))
		}
		reply, _ := vm.ToValue(aiModelExtractContent(resp))
		return reply
	})

	//aimodel.chatWithFile(prompt, files, options) => assistant reply text
	//files may be a single vpath or an array of vpaths. Images are sent as
	//vision image_url parts; textual files are inlined as text parts.
	vm.Set("_aimodel_chatWithFile", func(call otto.FunctionCall) otto.Value {
		prompt, _ := call.Argument(0).ToString()
		filesJSON := getOttoStringArg(call, 1)
		opt := parseAIModelOptions(getOttoStringArg(call, 2))

		var vpaths []string
		if err := json.Unmarshal([]byte(filesJSON), &vpaths); err != nil || len(vpaths) == 0 {
			panic(vm.MakeCustomError("AIModelError", "no file path(s) provided"))
		}

		parts := []aiContentPart{}
		if strings.TrimSpace(prompt) != "" {
			parts = append(parts, aiContentPart{Type: "text", Text: prompt})
		}
		for _, vpath := range vpaths {
			fileParts, err := g.aiModelBuildFileParts(scriptFsh, vm, u, vpath)
			if err != nil {
				panic(vm.MakeCustomError("AIModelError", err.Error()))
			}
			parts = append(parts, fileParts...)
		}

		messages := []aiChatMessage{}
		if strings.TrimSpace(opt.System) != "" {
			messages = append(messages, aiChatMessage{Role: "system", Content: opt.System})
		}
		messages = append(messages, aiChatMessage{Role: "user", Content: parts})

		resp, err := g.aiModelDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("AIModelError", err.Error()))
		}
		reply, _ := vm.ToValue(aiModelExtractContent(resp))
		return reply
	})

	//aimodel.request(messages, options) => full response object (JSON string)
	//Gives advanced scripts access to usage information and finish reason.
	vm.Set("_aimodel_request", func(call otto.FunctionCall) otto.Value {
		messagesJSON := getOttoStringArg(call, 0)
		opt := parseAIModelOptions(getOttoStringArg(call, 1))

		var messages []aiChatMessage
		if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
			panic(vm.MakeCustomError("AIModelError", "invalid messages array: "+err.Error()))
		}

		resp, err := g.aiModelDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("AIModelError", err.Error()))
		}
		out, _ := json.Marshal(resp)
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//aimodel.usage() => aggregated metrics object (JSON string)
	vm.Set("_aimodel_usage", func(call otto.FunctionCall) otto.Value {
		out, _ := json.Marshal(g.getAIModelMetrics())
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//aimodel.models() => { default: "...", models: [...] } (JSON string)
	vm.Set("_aimodel_models", func(call otto.FunctionCall) otto.Value {
		cfg := g.getAIModelConfig()
		pricing := g.getAIModelPricing()
		models := []string{}
		for name := range pricing {
			models = append(models, name)
		}
		out, _ := json.Marshal(map[string]interface{}{
			"default": cfg.DefaultModel,
			"models":  models,
		})
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//Wrap the native functions into a clean aimodel class
	vm.Run(`
		var aimodel = {};
		aimodel.chat = function(prompt, options){
			return _aimodel_chat(prompt, JSON.stringify(options || {}));
		};
		aimodel.chatWithFile = function(prompt, files, options){
			if (typeof files === "string"){ files = [files]; }
			return _aimodel_chatWithFile(prompt, JSON.stringify(files || []), JSON.stringify(options || {}));
		};
		aimodel.request = function(messages, options){
			return JSON.parse(_aimodel_request(JSON.stringify(messages || []), JSON.stringify(options || {})));
		};
		aimodel.usage = function(){
			return JSON.parse(_aimodel_usage());
		};
		aimodel.models = function(){
			return JSON.parse(_aimodel_models());
		};
	`)
}

// ── Core request logic ───────────────────────────────────────────────────────

// aiModelDoRequest performs an OpenAI-compatible chat completion call,
// records the resulting token usage / cost and returns the parsed response.
func (g *Gateway) aiModelDoRequest(model string, messages []aiChatMessage, opt aiChatOptions) (*aiChatResponse, error) {
	cfg := g.getAIModelConfig()

	endpoint := strings.TrimSpace(cfg.Endpoint)
	apikey := cfg.APIKey
	if strings.TrimSpace(opt.Endpoint) != "" {
		endpoint = strings.TrimSpace(opt.Endpoint)
	}
	if strings.TrimSpace(opt.APIKey) != "" {
		apikey = strings.TrimSpace(opt.APIKey)
	}
	if strings.TrimSpace(model) == "" {
		model = cfg.DefaultModel
	}

	if endpoint == "" {
		return nil, errors.New("AI model endpoint is not configured (System Settings > Developer Options > AI Model)")
	}
	if strings.TrimSpace(model) == "" {
		return nil, errors.New("no model specified and no default model configured")
	}

	reqStruct := aiChatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: opt.Temperature,
		MaxTokens:   opt.MaxTokens,
		Stream:      false,
	}
	body, err := json.Marshal(reqStruct)
	if err != nil {
		return nil, err
	}

	requestURL := strings.TrimRight(endpoint, "/") + "/chat/completions"
	req, err := http.NewRequest("POST", requestURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "arozos-aimodel-client/1.0")
	if apikey != "" {
		req.Header.Set("Authorization", "Bearer "+apikey)
	}

	client := &http.Client{Timeout: aiModelRequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("request to AI endpoint failed: " + err.Error())
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	parsed := &aiChatResponse{}
	if err := json.Unmarshal(respBody, parsed); err != nil {
		//Could not parse as a chat completion. Surface the raw payload.
		return nil, fmt.Errorf("unexpected response (HTTP %d): %s", resp.StatusCode, aiModelTruncate(string(respBody), 300))
	}

	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, errors.New("AI endpoint error: " + parsed.Error.Message)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI endpoint returned HTTP %d: %s", resp.StatusCode, aiModelTruncate(string(respBody), 300))
	}

	//Record usage. Prefer the model echoed back by the server.
	usedModel := model
	if strings.TrimSpace(parsed.Model) != "" {
		usedModel = parsed.Model
	}
	g.recordAIModelUsage(usedModel, parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens)

	return parsed, nil
}

// aiModelBuildFileParts reads a file from the user's virtual file system and
// converts it into one or more OpenAI-compatible content parts. Images become
// base64 data-URI image_url parts (for vision models); textual files are
// inlined as a labelled text part.
func (g *Gateway) aiModelBuildFileParts(scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, u *user.User, vpath string) ([]aiContentPart, error) {
	//Resolve relative paths against the script's directory
	vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

	if !u.CanRead(vpath) {
		return nil, errors.New("permission denied: " + vpath)
	}

	fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
	if err != nil {
		return nil, err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		return nil, errors.New("file not found: " + vpath)
	}

	content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
	if err != nil {
		return nil, err
	}

	ext := strings.ToLower(filepath.Ext(rpath))
	filename := filepath.Base(rpath)

	if aiModelIsImageExt(ext) {
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "image/" + strings.TrimPrefix(ext, ".")
		}
		dataURI := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content)
		return []aiContentPart{{Type: "image_url", ImageURL: &aiContentImageURL{URL: dataURI}}}, nil
	}

	//Treat anything that is valid UTF-8 (or has a known text extension) as text.
	if aiModelIsTextExt(ext) || utf8.Valid(content) {
		text := "[Attached file: " + filename + "]\n" + string(content)
		return []aiContentPart{{Type: "text", Text: text}}, nil
	}

	return nil, errors.New("unsupported file type for file-based chat: " + filename + " (only images and text documents are supported)")
}

// ── Persistence helpers ──────────────────────────────────────────────────────

func (g *Gateway) getAIModelConfig() AIModelConfig {
	cfg := AIModelConfig{Currency: "USD"}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(aiModelDBTable, "config") {
		sysdb.Read(aiModelDBTable, "config", &cfg)
		if strings.TrimSpace(cfg.Currency) == "" {
			cfg.Currency = "USD"
		}
	}
	return cfg
}

func (g *Gateway) getAIModelPricing() map[string]AIModelPricing {
	pricing := map[string]AIModelPricing{}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(aiModelDBTable, "pricing") {
		sysdb.Read(aiModelDBTable, "pricing", &pricing)
	}
	return pricing
}

func (g *Gateway) getAIModelMetrics() *AIModelMetrics {
	metrics := &AIModelMetrics{PerModel: map[string]*AIModelUsageRecord{}}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(aiModelDBTable, "metrics") {
		sysdb.Read(aiModelDBTable, "metrics", metrics)
		if metrics.PerModel == nil {
			metrics.PerModel = map[string]*AIModelUsageRecord{}
		}
	}
	//Keep currency label in sync with the current config.
	metrics.Currency = g.getAIModelConfig().Currency
	return metrics
}

// recordAIModelUsage atomically adds the given token counts (and their
// computed cost from the configured pricing) into the persisted metrics.
func (g *Gateway) recordAIModelUsage(model string, promptTokens int64, completionTokens int64) {
	aiModelMetricsMux.Lock()
	defer aiModelMetricsMux.Unlock()

	sysdb := g.Option.UserHandler.GetDatabase()
	metrics := &AIModelMetrics{PerModel: map[string]*AIModelUsageRecord{}}
	if sysdb.KeyExists(aiModelDBTable, "metrics") {
		sysdb.Read(aiModelDBTable, "metrics", metrics)
		if metrics.PerModel == nil {
			metrics.PerModel = map[string]*AIModelUsageRecord{}
		}
	}

	pricing := g.getAIModelPricing()
	p := pricing[model]
	cost := float64(promptTokens)/1000000.0*p.InputPrice + float64(completionTokens)/1000000.0*p.OutputPrice

	rec := metrics.PerModel[model]
	if rec == nil {
		rec = &AIModelUsageRecord{}
		metrics.PerModel[model] = rec
	}
	rec.PromptTokens += promptTokens
	rec.CompletionTokens += completionTokens
	rec.TotalTokens += promptTokens + completionTokens
	rec.Cost += cost
	rec.Requests++

	metrics.TotalPromptTokens += promptTokens
	metrics.TotalCompletionTokens += completionTokens
	metrics.TotalTokens += promptTokens + completionTokens
	metrics.TotalCost += cost
	metrics.TotalRequests++
	metrics.UpdatedAt = time.Now().Unix()

	if err := sysdb.Write(aiModelDBTable, "metrics", metrics); err != nil {
		logger.PrintAndLog("Agi", "[AGI] Failed to persist AI model metrics: "+err.Error(), nil)
	}
}

// ── HTTP handlers (System Settings) ──────────────────────────────────────────

// HandleAIModelConfig serves GET (masked config) and POST (save config).
// GET  /system/aimodel/config
// POST /system/aimodel/config  (endpoint, defaultModel, currency, apikey, clearkey)
func (g *Gateway) HandleAIModelConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		cfg := g.getAIModelConfig()
		js, _ := json.Marshal(map[string]interface{}{
			"endpoint":     cfg.Endpoint,
			"defaultModel": cfg.DefaultModel,
			"currency":     cfg.Currency,
			"hasKey":       cfg.APIKey != "",
			"keyHint":      aiModelMaskKey(cfg.APIKey),
		})
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST - save. Read raw form values so empty strings are allowed for
	//endpoint / defaultModel (e.g. when intentionally clearing a field).
	r.ParseForm()
	cfg := g.getAIModelConfig()
	cfg.Endpoint = strings.TrimSpace(r.Form.Get("endpoint"))
	cfg.DefaultModel = strings.TrimSpace(r.Form.Get("defaultModel"))
	if currency := strings.TrimSpace(r.Form.Get("currency")); currency != "" {
		cfg.Currency = currency
	}

	//API key: only overwrite when a new, non-sentinel value is supplied.
	if clear, _ := utils.PostBool(r, "clearkey"); clear {
		cfg.APIKey = ""
	} else if apikey := r.Form.Get("apikey"); apikey != "" && apikey != aiModelKeyMask {
		cfg.APIKey = apikey
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(aiModelDBTable, "config", cfg); err != nil {
		utils.SendErrorResponse(w, "failed to save config: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleAIModelPricing serves GET (pricing map) and POST (save pricing map).
// GET  /system/aimodel/pricing
// POST /system/aimodel/pricing  (pricing = JSON of {model:{inputPrice,outputPrice}})
func (g *Gateway) HandleAIModelPricing(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		js, _ := json.Marshal(g.getAIModelPricing())
		utils.SendJSONResponse(w, string(js))
		return
	}

	raw, err := utils.PostPara(r, "pricing")
	if err != nil {
		utils.SendErrorResponse(w, "missing pricing data")
		return
	}
	pricing := map[string]AIModelPricing{}
	if err := json.Unmarshal([]byte(raw), &pricing); err != nil {
		utils.SendErrorResponse(w, "invalid pricing JSON: "+err.Error())
		return
	}
	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(aiModelDBTable, "pricing", pricing); err != nil {
		utils.SendErrorResponse(w, "failed to save pricing: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleAIModelMetrics returns the aggregated usage metrics.
// GET /system/aimodel/metrics
func (g *Gateway) HandleAIModelMetrics(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(g.getAIModelMetrics())
	utils.SendJSONResponse(w, string(js))
}

// HandleAIModelMetricsReset clears the aggregated usage metrics.
// POST /system/aimodel/metrics/reset
func (g *Gateway) HandleAIModelMetricsReset(w http.ResponseWriter, r *http.Request) {
	aiModelMetricsMux.Lock()
	defer aiModelMetricsMux.Unlock()

	metrics := &AIModelMetrics{
		PerModel:  map[string]*AIModelUsageRecord{},
		UpdatedAt: time.Now().Unix(),
	}
	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(aiModelDBTable, "metrics", metrics); err != nil {
		utils.SendErrorResponse(w, "failed to reset metrics: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleAIModelTest performs a lightweight connectivity check by listing the
// models exposed at {endpoint}/models. It does not consume any tokens.
// POST /system/aimodel/test  (optional: endpoint, apikey to test unsaved values)
func (g *Gateway) HandleAIModelTest(w http.ResponseWriter, r *http.Request) {
	cfg := g.getAIModelConfig()
	endpoint := cfg.Endpoint
	apikey := cfg.APIKey
	if ep := strings.TrimSpace(r.FormValue("endpoint")); ep != "" {
		endpoint = ep
	}
	if k := r.FormValue("apikey"); k != "" && k != aiModelKeyMask {
		apikey = k
	}

	if strings.TrimSpace(endpoint) == "" {
		utils.SendErrorResponse(w, "endpoint not configured")
		return
	}

	requestURL := strings.TrimRight(endpoint, "/") + "/models"
	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if apikey != "" {
		req.Header.Set("Authorization", "Bearer "+apikey)
	}

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		utils.SendErrorResponse(w, "connection failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		utils.SendErrorResponse(w, fmt.Sprintf("endpoint returned HTTP %d: %s", resp.StatusCode, aiModelTruncate(string(respBody), 200)))
		return
	}

	var modelList struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.Unmarshal(respBody, &modelList)
	models := []string{}
	for _, m := range modelList.Data {
		if strings.TrimSpace(m.ID) != "" {
			models = append(models, m.ID)
		}
	}

	out, _ := json.Marshal(map[string]interface{}{
		"ok":         true,
		"modelCount": len(models),
		"models":     models,
	})
	utils.SendJSONResponse(w, string(out))
}

// ── Small helpers ────────────────────────────────────────────────────────────

func aiModelExtractContent(resp *aiChatResponse) string {
	if resp == nil || len(resp.Choices) == 0 {
		return ""
	}
	return resp.Choices[0].Message.Content
}

func parseAIModelOptions(s string) aiChatOptions {
	opt := aiChatOptions{}
	s = strings.TrimSpace(s)
	if s == "" || s == "undefined" || s == "null" {
		return opt
	}
	json.Unmarshal([]byte(s), &opt)
	return opt
}

// getOttoStringArg safely reads the nth argument of a call as a string,
// returning an empty string when the argument is absent or undefined.
func getOttoStringArg(call otto.FunctionCall, idx int) string {
	arg := call.Argument(idx)
	if arg.IsUndefined() || arg.IsNull() {
		return ""
	}
	s, err := arg.ToString()
	if err != nil {
		return ""
	}
	return s
}

func aiModelMaskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("•", len(key))
	}
	return "••••" + key[len(key)-4:]
}

func aiModelTruncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func aiModelIsImageExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}

func aiModelIsTextExt(ext string) bool {
	switch ext {
	case ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
		".html", ".htm", ".js", ".ts", ".go", ".py", ".java", ".c", ".cpp", ".h", ".hpp",
		".css", ".log", ".ini", ".conf", ".sh", ".bat", ".sql", ".php", ".rb", ".rs",
		".toml", ".env", ".srt", ".vtt":
		return true
	}
	return false
}
