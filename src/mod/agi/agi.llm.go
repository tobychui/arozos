package agi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/agi/static"
	llm "imuslab.com/arozos/mod/aiservers/llm"
	"imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI LLM Library

	This library allows AGI scripts to call any OpenAI-compatible or
	Anthropic chat completion endpoint. It supports both plain text prompts
	and file-based prompts (images for vision models and text documents
	inlined into the conversation).

	The actual wire-protocol logic (OpenAI / Anthropic request building and
	response parsing) lives in the standalone mod/aiservers/llm client
	package; this file only owns the ArozOS-specific bits: the admin-
	configured connection / pricing / quota (System Settings > AI Integration
	> AI Model - still named "AI Model" there; only the requirelib identifier
	exposed to scripts changed from "aimodel" to "llm") and the Otto VM
	bindings.

	The sysdb table name and the System Settings HTTP handler names
	deliberately keep their original "aimodel" spelling so previously saved
	settings and routes are not affected by this rename.

	Author: tobychui (AGI), LLM lib addition
*/

const (
	//llmDBTable is the system database table used to persist the LLM
	//configuration, per-model pricing and aggregated usage metrics. The
	//string value is kept as "aimodel" (its original name) so settings
	//saved before this library was renamed to "llm" keep working.
	llmDBTable = "aimodel"

	//llmKeyMask is the sentinel value the frontend submits when the API
	//key field was left untouched. When received, the stored key is kept.
	llmKeyMask = "********"

	//llmRequestTimeout is the maximum time to wait for a completion. Large
	//reasoning / agentic models can legitimately take many minutes to reply,
	//so this is set generously to 60 minutes to avoid cutting long calls short.
	llmRequestTimeout = 60 * time.Minute
)

// llmMetricsMux guards read-modify-write cycles on the metrics record so
// concurrent AGI scripts do not clobber each other's usage updates.
var llmMetricsMux sync.Mutex

// ── Persisted data structures ───────────────────────────────────────────────

// LLMConfig holds the global, admin-configured connection settings.
type LLMConfig struct {
	Endpoint     string `json:"endpoint"`     //Base URL, e.g. https://api.openai.com/v1 or https://api.anthropic.com
	APIKey       string `json:"apikey"`       //API key (Bearer for OpenAI, x-api-key for Anthropic)
	DefaultModel string `json:"defaultModel"` //Model used when a script does not specify one
	APIFormat    string `json:"apiFormat"`    //Wire format: "openai" (default) or "anthropic"
	Currency     string `json:"currency"`     //Currency label used by the metrics board (default USD)
}

// LLMQuota defines an optional cap on token / cost consumption so the
// system cannot keep spending once a budget is reached.
type LLMQuota struct {
	Enabled   bool    `json:"enabled"`   //When true, requests are blocked once a cap is hit
	MaxTokens int64   `json:"maxTokens"` //Total token cap for the period (0 = no token cap)
	MaxCost   float64 `json:"maxCost"`   //Total cost cap for the period (0 = no cost cap)
	Period    string  `json:"period"`    //Reset window: "total" (never), "daily" or "monthly"
}

// periodLabel returns a human-friendly label for the quota period.
func (q LLMQuota) periodLabel() string {
	switch q.Period {
	case "daily":
		return "day"
	case "monthly":
		return "month"
	default:
		return "total"
	}
}

// LLMPricing defines the price per 1,000,000 tokens for a given model.
type LLMPricing struct {
	InputPrice  float64 `json:"inputPrice"`  //Cost per 1M prompt (input) tokens
	OutputPrice float64 `json:"outputPrice"` //Cost per 1M completion (output) tokens
}

// LLMUsageRecord is the accumulated usage of a single model.
type LLMUsageRecord struct {
	PromptTokens     int64   `json:"promptTokens"`
	CompletionTokens int64   `json:"completionTokens"`
	TotalTokens      int64   `json:"totalTokens"`
	Cost             float64 `json:"cost"`
	Requests         int64   `json:"requests"`
	GenerationMs     int64   `json:"generationMs"` //total generation time
	//Sum and count of per-request tokens/sec, so the average speed is the mean
	//of the per-request speeds (matching what is shown on each reply).
	SpeedSum     float64 `json:"speedSum"`
	SpeedSamples int64   `json:"speedSamples"`
}

// LLMMetrics is the aggregated consumption across every model.
type LLMMetrics struct {
	TotalPromptTokens     int64                      `json:"totalPromptTokens"`
	TotalCompletionTokens int64                      `json:"totalCompletionTokens"`
	TotalTokens           int64                      `json:"totalTokens"`
	TotalCost             float64                    `json:"totalCost"`
	TotalRequests         int64                      `json:"totalRequests"`
	TotalGenerationMs     int64                      `json:"totalGenerationMs"`
	SpeedSum              float64                    `json:"speedSum"`     //sum of per-request tok/s
	SpeedSamples          int64                      `json:"speedSamples"` //count of timed requests
	PerModel              map[string]*LLMUsageRecord `json:"perModel"`
	Currency              string                     `json:"currency"`
	UpdatedAt             int64                      `json:"updatedAt"`

	//Windowed usage used for quota enforcement (reset per quota period).
	WindowStart  int64   `json:"windowStart"`  //Unix time the current quota window began
	WindowTokens int64   `json:"windowTokens"` //Tokens consumed in the current window
	WindowCost   float64 `json:"windowCost"`   //Cost consumed in the current window
}

// llmCallOptions are the per-call options a script may pass as a JS object.
type llmCallOptions struct {
	Model       string   `json:"model"`       //Override the configured default model
	System      string   `json:"system"`      //Optional system prompt
	Endpoint    string   `json:"endpoint"`    //Override the global endpoint
	APIKey      string   `json:"apikey"`      //Override the global API key
	APIFormat   string   `json:"apiFormat"`   //Override the wire format ("openai"/"anthropic")
	Temperature *float64 `json:"temperature"` //Sampling temperature
	MaxTokens   *int     `json:"max_tokens"`  //Maximum tokens to generate
}

// ── Library registration ─────────────────────────────────────────────────────

func (g *Gateway) LLMLibRegister() {
	//Make sure the storage table exists before any read / write happens.
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists(llmDBTable) {
		sysdb.NewTable(llmDBTable)
	}

	err := g.RegisterLib("llm", g.injectLLMFunctions)
	if err != nil {
		agiLogger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectLLMFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	//llm.chat(prompt, options) => assistant reply text
	vm.Set("_llm_chat", func(call otto.FunctionCall) otto.Value {
		prompt, _ := call.Argument(0).ToString()
		opt := parseLLMCallOptions(getOttoStringArg(call, 1))

		messages := []llm.Message{}
		if strings.TrimSpace(opt.System) != "" {
			messages = append(messages, llm.Message{Role: "system", Content: opt.System})
		}
		messages = append(messages, llm.Message{Role: "user", Content: prompt})

		resp, err := g.llmDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("LLMError", err.Error()))
		}
		reply, _ := vm.ToValue(llmExtractContent(resp))
		return reply
	})

	//llm.chatWithFile(prompt, files, options) => assistant reply text
	//files may be a single vpath or an array of vpaths. Images are sent as
	//vision image_url parts; textual files are inlined as text parts.
	vm.Set("_llm_chatWithFile", func(call otto.FunctionCall) otto.Value {
		prompt, _ := call.Argument(0).ToString()
		filesJSON := getOttoStringArg(call, 1)
		opt := parseLLMCallOptions(getOttoStringArg(call, 2))

		var vpaths []string
		if err := json.Unmarshal([]byte(filesJSON), &vpaths); err != nil || len(vpaths) == 0 {
			panic(vm.MakeCustomError("LLMError", "no file path(s) provided"))
		}

		parts := []llm.ContentPart{}
		if strings.TrimSpace(prompt) != "" {
			parts = append(parts, llm.ContentPart{Type: "text", Text: prompt})
		}
		for _, vpath := range vpaths {
			fileParts, err := g.llmBuildFileParts(scriptFsh, vm, u, vpath)
			if err != nil {
				panic(vm.MakeCustomError("LLMError", err.Error()))
			}
			parts = append(parts, fileParts...)
		}

		messages := []llm.Message{}
		if strings.TrimSpace(opt.System) != "" {
			messages = append(messages, llm.Message{Role: "system", Content: opt.System})
		}
		messages = append(messages, llm.Message{Role: "user", Content: parts})

		resp, err := g.llmDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("LLMError", err.Error()))
		}
		reply, _ := vm.ToValue(llmExtractContent(resp))
		return reply
	})

	//llm.request(messages, options) => full response object (JSON string)
	//Gives advanced scripts access to usage information and finish reason.
	vm.Set("_llm_request", func(call otto.FunctionCall) otto.Value {
		messagesJSON := getOttoStringArg(call, 0)
		opt := parseLLMCallOptions(getOttoStringArg(call, 1))

		var messages []llm.Message
		if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
			panic(vm.MakeCustomError("LLMError", "invalid messages array: "+err.Error()))
		}

		resp, err := g.llmDoRequest(opt.Model, messages, opt)
		if err != nil {
			panic(vm.MakeCustomError("LLMError", err.Error()))
		}
		out, _ := json.Marshal(resp)
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//llm.usage() => aggregated metrics object (JSON string)
	vm.Set("_llm_usage", func(call otto.FunctionCall) otto.Value {
		out, _ := json.Marshal(g.getLLMMetrics())
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//llm.models() => { default: "...", models: [...] } (JSON string)
	vm.Set("_llm_models", func(call otto.FunctionCall) otto.Value {
		cfg := g.getLLMConfig()
		pricing := g.getLLMPricing()
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

	//llm.listModels() => { models: [...] } from the live endpoint (JSON string)
	vm.Set("_llm_listModels", func(call otto.FunctionCall) otto.Value {
		cfg := g.getLLMConfig()
		result := map[string]interface{}{"models": []string{}}
		client := llm.NewClient(cfg.Endpoint, cfg.APIKey, cfg.APIFormat, llmRequestTimeout)
		models, err := client.ListModels()
		if err != nil {
			result["error"] = err.Error()
		} else {
			result["models"] = models
		}
		out, _ := json.Marshal(result)
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//llm.fileParts(files) => JSON array of OpenAI-style content parts for
	//the given virtual file path(s). Images become image_url data URIs, text
	//documents are inlined. Scripts can embed these into a message's content.
	vm.Set("_llm_fileParts", func(call otto.FunctionCall) otto.Value {
		filesJSON := getOttoStringArg(call, 0)
		var vpaths []string
		if err := json.Unmarshal([]byte(filesJSON), &vpaths); err != nil {
			panic(vm.MakeCustomError("LLMError", "invalid files array: "+err.Error()))
		}
		parts := []llm.ContentPart{}
		for _, vp := range vpaths {
			fp, err := g.llmBuildFileParts(scriptFsh, vm, u, vp)
			if err != nil {
				panic(vm.MakeCustomError("LLMError", err.Error()))
			}
			parts = append(parts, fp...)
		}
		out, _ := json.Marshal(parts)
		reply, _ := vm.ToValue(string(out))
		return reply
	})

	//Wrap the native functions into a clean llm class
	vm.Run(`
		var llm = {};
		llm.chat = function(prompt, options){
			return _llm_chat(prompt, JSON.stringify(options || {}));
		};
		llm.chatWithFile = function(prompt, files, options){
			if (typeof files === "string"){ files = [files]; }
			return _llm_chatWithFile(prompt, JSON.stringify(files || []), JSON.stringify(options || {}));
		};
		llm.request = function(messages, options){
			return JSON.parse(_llm_request(JSON.stringify(messages || []), JSON.stringify(options || {})));
		};
		llm.usage = function(){
			return JSON.parse(_llm_usage());
		};
		llm.models = function(){
			return JSON.parse(_llm_models());
		};
		llm.listModels = function(){
			return JSON.parse(_llm_listModels());
		};
		llm.fileParts = function(files){
			if (typeof files === "string"){ files = [files]; }
			return JSON.parse(_llm_fileParts(JSON.stringify(files || [])));
		};
	`)
}

// ── Core request logic ───────────────────────────────────────────────────────

// llmDoRequest resolves the connection settings, enforces any usage quota,
// dispatches the call via mod/aiservers/llm, records the resulting token
// usage / cost and returns the unified response.
func (g *Gateway) llmDoRequest(model string, messages []llm.Message, opt llmCallOptions) (*llm.ChatResponse, error) {
	cfg := g.getLLMConfig()

	endpoint := strings.TrimSpace(cfg.Endpoint)
	apikey := cfg.APIKey
	format := cfg.APIFormat
	if strings.TrimSpace(opt.Endpoint) != "" {
		endpoint = strings.TrimSpace(opt.Endpoint)
	}
	if strings.TrimSpace(opt.APIKey) != "" {
		apikey = strings.TrimSpace(opt.APIKey)
	}
	if strings.TrimSpace(opt.APIFormat) != "" {
		format = strings.TrimSpace(opt.APIFormat)
	}
	if format == "" {
		format = "openai"
	}
	if strings.TrimSpace(model) == "" {
		model = cfg.DefaultModel
	}

	if endpoint == "" {
		return nil, errors.New("AI model endpoint is not configured (System Settings > AI Integration > AI Model)")
	}
	if strings.TrimSpace(model) == "" {
		return nil, errors.New("no model specified and no default model configured")
	}

	//Enforce the usage quota before spending any tokens.
	if err := g.llmCheckQuota(); err != nil {
		return nil, err
	}

	client := llm.NewClient(endpoint, apikey, format, llmRequestTimeout)
	resp, err := client.Chat(messages, llm.ChatOptions{Model: model, Temperature: opt.Temperature, MaxTokens: opt.MaxTokens})
	if err != nil {
		return nil, err
	}

	//Record usage. Prefer the model echoed back by the server.
	usedModel := model
	if strings.TrimSpace(resp.Model) != "" {
		usedModel = resp.Model
	}
	g.recordLLMUsage(usedModel, resp.Usage.PromptTokens, resp.Usage.CompletionTokens, resp.Usage.GenerationMs)

	return resp, nil
}

// llmBuildFileParts reads a file from the user's virtual file system and
// converts it into one or more OpenAI-compatible content parts. Images become
// base64 data-URI image_url parts (for vision models); textual files are
// inlined as a labelled text part.
func (g *Gateway) llmBuildFileParts(scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, u *user.User, vpath string) ([]llm.ContentPart, error) {
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

	if llmIsImageExt(ext) {
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "image/" + strings.TrimPrefix(ext, ".")
		}
		dataURI := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content)
		return []llm.ContentPart{{Type: "image_url", ImageURL: &llm.ImageURL{URL: dataURI}}}, nil
	}

	//Treat anything that is valid UTF-8 (or has a known text extension) as text.
	if llmIsTextExt(ext) || utf8.Valid(content) {
		text := "[Attached file: " + filename + "]\n" + string(content)
		return []llm.ContentPart{{Type: "text", Text: text}}, nil
	}

	return nil, errors.New("unsupported file type for file-based chat: " + filename + " (only images and text documents are supported)")
}

// ── Persistence helpers ──────────────────────────────────────────────────────

func (g *Gateway) getLLMConfig() LLMConfig {
	cfg := LLMConfig{Currency: "USD", APIFormat: "openai"}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(llmDBTable, "config") {
		sysdb.Read(llmDBTable, "config", &cfg)
		if strings.TrimSpace(cfg.Currency) == "" {
			cfg.Currency = "USD"
		}
		if strings.TrimSpace(cfg.APIFormat) == "" {
			cfg.APIFormat = "openai"
		}
	}
	return cfg
}

func (g *Gateway) getLLMQuota() LLMQuota {
	q := LLMQuota{Period: "total"}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(llmDBTable, "quota") {
		sysdb.Read(llmDBTable, "quota", &q)
		if strings.TrimSpace(q.Period) == "" {
			q.Period = "total"
		}
	}
	return q
}

// llmWindowExpired reports whether a quota window that started at startUnix
// has rolled over for the given period as of now.
func llmWindowExpired(startUnix int64, period string, now time.Time) bool {
	if startUnix <= 0 {
		return true
	}
	start := time.Unix(startUnix, 0).UTC()
	n := now.UTC()
	switch period {
	case "daily":
		return start.YearDay() != n.YearDay() || start.Year() != n.Year()
	case "monthly":
		return start.Month() != n.Month() || start.Year() != n.Year()
	default: //"total" never expires
		return false
	}
}

// llmCurrentWindowUsage returns the effective token / cost usage for the
// active quota window (zero if the window has rolled over).
func (g *Gateway) llmCurrentWindowUsage() (int64, float64) {
	q := g.getLLMQuota()
	m := g.getLLMMetrics()
	if llmWindowExpired(m.WindowStart, q.Period, time.Now()) {
		return 0, 0
	}
	return m.WindowTokens, m.WindowCost
}

// llmCheckQuota returns an error when a configured quota has been reached.
func (g *Gateway) llmCheckQuota() error {
	q := g.getLLMQuota()
	if !q.Enabled {
		return nil
	}
	usedTokens, usedCost := g.llmCurrentWindowUsage()
	if q.MaxTokens > 0 && usedTokens >= q.MaxTokens {
		return fmt.Errorf("AI usage quota reached: %d / %d tokens used this %s — new requests are blocked until the quota resets or is raised", usedTokens, q.MaxTokens, q.periodLabel())
	}
	if q.MaxCost > 0 && usedCost >= q.MaxCost {
		return fmt.Errorf("AI cost quota reached: %.4f / %.4f used this %s — new requests are blocked until the quota resets or is raised", usedCost, q.MaxCost, q.periodLabel())
	}
	return nil
}

func (g *Gateway) getLLMPricing() map[string]LLMPricing {
	pricing := map[string]LLMPricing{}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(llmDBTable, "pricing") {
		sysdb.Read(llmDBTable, "pricing", &pricing)
	}
	return pricing
}

func (g *Gateway) getLLMMetrics() *LLMMetrics {
	metrics := &LLMMetrics{PerModel: map[string]*LLMUsageRecord{}}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(llmDBTable, "metrics") {
		sysdb.Read(llmDBTable, "metrics", metrics)
		if metrics.PerModel == nil {
			metrics.PerModel = map[string]*LLMUsageRecord{}
		}
	}
	//Keep currency label in sync with the current config.
	metrics.Currency = g.getLLMConfig().Currency
	return metrics
}

// recordLLMUsage atomically adds the given token counts (and their computed
// cost from the configured pricing) into the persisted metrics. The optional
// genMs argument is the request's generation time, accumulated so the
// metrics board can report an average tokens-per-second.
func (g *Gateway) recordLLMUsage(model string, promptTokens int64, completionTokens int64, genMs ...int64) {
	var generationMs int64
	if len(genMs) > 0 {
		generationMs = genMs[0]
	}

	llmMetricsMux.Lock()
	defer llmMetricsMux.Unlock()

	sysdb := g.Option.UserHandler.GetDatabase()
	metrics := &LLMMetrics{PerModel: map[string]*LLMUsageRecord{}}
	if sysdb.KeyExists(llmDBTable, "metrics") {
		sysdb.Read(llmDBTable, "metrics", metrics)
		if metrics.PerModel == nil {
			metrics.PerModel = map[string]*LLMUsageRecord{}
		}
	}

	pricing := g.getLLMPricing()
	p := pricing[model]
	cost := float64(promptTokens)/1000000.0*p.InputPrice + float64(completionTokens)/1000000.0*p.OutputPrice

	rec := metrics.PerModel[model]
	if rec == nil {
		rec = &LLMUsageRecord{}
		metrics.PerModel[model] = rec
	}
	rec.PromptTokens += promptTokens
	rec.CompletionTokens += completionTokens
	rec.TotalTokens += promptTokens + completionTokens
	rec.Cost += cost
	rec.Requests++
	rec.GenerationMs += generationMs

	metrics.TotalPromptTokens += promptTokens
	metrics.TotalCompletionTokens += completionTokens
	metrics.TotalTokens += promptTokens + completionTokens
	metrics.TotalCost += cost
	metrics.TotalRequests++
	metrics.TotalGenerationMs += generationMs
	metrics.UpdatedAt = time.Now().Unix()

	//Accumulate this request's speed (tokens/sec) so the reported average is the
	//mean of per-request speeds, consistent with the per-reply figures.
	if completionTokens > 0 && generationMs > 0 {
		speed := float64(completionTokens) / (float64(generationMs) / 1000.0)
		rec.SpeedSum += speed
		rec.SpeedSamples++
		metrics.SpeedSum += speed
		metrics.SpeedSamples++
	}

	//Maintain the windowed usage used for quota enforcement. Reset the window
	//first if it has rolled over for the configured quota period.
	now := time.Now()
	period := g.getLLMQuota().Period
	if metrics.WindowStart == 0 || llmWindowExpired(metrics.WindowStart, period, now) {
		metrics.WindowStart = now.Unix()
		metrics.WindowTokens = 0
		metrics.WindowCost = 0
	}
	metrics.WindowTokens += promptTokens + completionTokens
	metrics.WindowCost += cost

	if err := sysdb.Write(llmDBTable, "metrics", metrics); err != nil {
		agiLogger.PrintAndLog("Agi", "[AGI] Failed to persist LLM usage metrics: "+err.Error(), nil)
	}
}

// ── HTTP handlers (System Settings) ──────────────────────────────────────────
// These serve the "AI Model" tab in System Settings > AI Integration and keep
// their original Handle* names / routes; only the requirelib identifier used
// by AGI scripts ("llm") changed.

// HandleAIModelConfig serves GET (masked config) and POST (save config).
// GET  /system/aimodel/config
// POST /system/aimodel/config  (endpoint, defaultModel, currency, apikey, clearkey)
func (g *Gateway) HandleAIModelConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		cfg := g.getLLMConfig()
		js, _ := json.Marshal(map[string]interface{}{
			"endpoint":     cfg.Endpoint,
			"defaultModel": cfg.DefaultModel,
			"apiFormat":    cfg.APIFormat,
			"currency":     cfg.Currency,
			"hasKey":       cfg.APIKey != "",
			"keyHint":      llmMaskKey(cfg.APIKey),
		})
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST - save. Read raw form values so empty strings are allowed for
	//endpoint / defaultModel (e.g. when intentionally clearing a field).
	r.ParseForm()
	cfg := g.getLLMConfig()
	cfg.Endpoint = strings.TrimSpace(r.Form.Get("endpoint"))
	cfg.DefaultModel = strings.TrimSpace(r.Form.Get("defaultModel"))
	if format := strings.TrimSpace(r.Form.Get("apiFormat")); format == "anthropic" || format == "openai" {
		cfg.APIFormat = format
	}
	if cfg.APIFormat == "" {
		cfg.APIFormat = "openai"
	}
	if currency := strings.TrimSpace(r.Form.Get("currency")); currency != "" {
		cfg.Currency = currency
	}

	//API key: only overwrite when a new, non-sentinel value is supplied.
	if clear, _ := utils.PostBool(r, "clearkey"); clear {
		cfg.APIKey = ""
	} else if apikey := r.Form.Get("apikey"); apikey != "" && apikey != llmKeyMask {
		cfg.APIKey = apikey
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(llmDBTable, "config", cfg); err != nil {
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
		js, _ := json.Marshal(g.getLLMPricing())
		utils.SendJSONResponse(w, string(js))
		return
	}

	raw, err := utils.PostPara(r, "pricing")
	if err != nil {
		utils.SendErrorResponse(w, "missing pricing data")
		return
	}
	pricing := map[string]LLMPricing{}
	if err := json.Unmarshal([]byte(raw), &pricing); err != nil {
		utils.SendErrorResponse(w, "invalid pricing JSON: "+err.Error())
		return
	}
	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(llmDBTable, "pricing", pricing); err != nil {
		utils.SendErrorResponse(w, "failed to save pricing: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleAIModelMetrics returns the aggregated usage metrics.
// GET /system/aimodel/metrics
func (g *Gateway) HandleAIModelMetrics(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(g.getLLMMetrics())
	utils.SendJSONResponse(w, string(js))
}

// HandleAIModelMetricsReset clears the aggregated usage metrics.
// POST /system/aimodel/metrics/reset
func (g *Gateway) HandleAIModelMetricsReset(w http.ResponseWriter, r *http.Request) {
	llmMetricsMux.Lock()
	defer llmMetricsMux.Unlock()

	metrics := &LLMMetrics{
		PerModel:  map[string]*LLMUsageRecord{},
		UpdatedAt: time.Now().Unix(),
	}
	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(llmDBTable, "metrics", metrics); err != nil {
		utils.SendErrorResponse(w, "failed to reset metrics: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleAIModelTest performs a lightweight connectivity check by listing the
// models exposed by the endpoint. It does not consume any tokens.
// POST /system/aimodel/test  (optional: endpoint, apikey, apiFormat to test unsaved values)
func (g *Gateway) HandleAIModelTest(w http.ResponseWriter, r *http.Request) {
	cfg := g.getLLMConfig()
	endpoint := cfg.Endpoint
	apikey := cfg.APIKey
	format := cfg.APIFormat
	if ep := strings.TrimSpace(r.FormValue("endpoint")); ep != "" {
		endpoint = ep
	}
	if k := r.FormValue("apikey"); k != "" && k != llmKeyMask {
		apikey = k
	}
	if f := strings.TrimSpace(r.FormValue("apiFormat")); f == "openai" || f == "anthropic" {
		format = f
	}

	if strings.TrimSpace(endpoint) == "" {
		utils.SendErrorResponse(w, "endpoint not configured")
		return
	}

	client := llm.NewClient(endpoint, apikey, format, llmRequestTimeout)
	models, err := client.ListModels()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	out, _ := json.Marshal(map[string]interface{}{
		"ok":         true,
		"modelCount": len(models),
		"models":     models,
	})
	utils.SendJSONResponse(w, string(out))
}

// HandleAIModelQuota serves GET (quota + current window usage) and POST (save).
// GET  /system/aimodel/quota
// POST /system/aimodel/quota  (enabled, maxTokens, maxCost, period)
func (g *Gateway) HandleAIModelQuota(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		q := g.getLLMQuota()
		usedTokens, usedCost := g.llmCurrentWindowUsage()
		js, _ := json.Marshal(map[string]interface{}{
			"enabled":    q.Enabled,
			"maxTokens":  q.MaxTokens,
			"maxCost":    q.MaxCost,
			"period":     q.Period,
			"usedTokens": usedTokens,
			"usedCost":   usedCost,
			"currency":   g.getLLMConfig().Currency,
		})
		utils.SendJSONResponse(w, string(js))
		return
	}

	r.ParseForm()
	q := g.getLLMQuota()
	q.Enabled, _ = utils.PostBool(r, "enabled")

	q.MaxTokens = 0
	if n, err := strconv.ParseInt(strings.TrimSpace(r.Form.Get("maxTokens")), 10, 64); err == nil && n >= 0 {
		q.MaxTokens = n
	}
	q.MaxCost = 0
	if f, err := strconv.ParseFloat(strings.TrimSpace(r.Form.Get("maxCost")), 64); err == nil && f >= 0 {
		q.MaxCost = f
	}
	if p := strings.TrimSpace(r.Form.Get("period")); p == "total" || p == "daily" || p == "monthly" {
		q.Period = p
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(llmDBTable, "quota", q); err != nil {
		utils.SendErrorResponse(w, "failed to save quota: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// ── Small helpers ────────────────────────────────────────────────────────────

func llmExtractContent(resp *llm.ChatResponse) string {
	if resp == nil || len(resp.Choices) == 0 {
		return ""
	}
	return resp.Choices[0].Message.Content
}

func parseLLMCallOptions(s string) llmCallOptions {
	opt := llmCallOptions{}
	s = strings.TrimSpace(s)
	if s == "" || s == "undefined" || s == "null" {
		return opt
	}
	json.Unmarshal([]byte(s), &opt)
	return opt
}

func llmMaskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("•", len(key))
	}
	return "••••" + key[len(key)-4:]
}

func llmIsImageExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}

func llmIsTextExt(ext string) bool {
	switch ext {
	case ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
		".html", ".htm", ".js", ".ts", ".go", ".py", ".java", ".c", ".cpp", ".h", ".hpp",
		".css", ".log", ".ini", ".conf", ".sh", ".bat", ".sql", ".php", ".rb", ".rs",
		".toml", ".env", ".srt", ".vtt":
		return true
	}
	return false
}

// getOttoStringArg safely reads the nth argument of a call as a string,
// returning an empty string when the argument is absent or undefined. Shared
// by every AGI lib file in this package (llm, cnn, ...).
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
