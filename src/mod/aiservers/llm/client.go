package llm

/*
	LLM Client

	A minimal Go client for OpenAI-compatible and Anthropic chat completion
	endpoints (OpenAI, Azure OpenAI, OpenRouter, Ollama, LM Studio, llama.cpp
	server, vLLM, Anthropic Claude, ...). This package only speaks the wire
	protocol - it carries no ArozOS-specific knowledge (no AGI, no virtual
	paths, no system database, no pricing/quota), so it can be reused from
	anywhere in the codebase. The AGI binding that exposes it to WebApp
	backend scripts (config persistence, pricing, quota, usage metrics, Otto
	VM bindings) lives in mod/agi/agi.llm.go.

	Author: tobychui (AGI/ArozOS integration)
*/

import (
	"net/http"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// Client talks to one OpenAI- or Anthropic-compatible chat completion endpoint.
type Client struct {
	Endpoint  string //Base URL, e.g. https://api.openai.com/v1 or https://api.anthropic.com
	APIKey    string //Bearer token (OpenAI) or x-api-key (Anthropic)
	APIFormat string //Wire format: "openai" (default) or "anthropic"
	HTTP      *http.Client
}

// NewClient creates a client for the given endpoint. timeout <= 0 uses
// DefaultTimeout; format defaults to "openai" unless exactly "anthropic".
func NewClient(endpoint, apikey, format string, timeout time.Duration) (out0 *Client) {
	defer logger.Out1(logger.In4("aiservers/llm", "NewClient", "endpoint", endpoint, "format", format, "&timeout", &timeout, "!apikey", apikey), &out0)
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	if strings.TrimSpace(format) != "anthropic" {
		format = "openai"
	}
	return &Client{
		Endpoint:  strings.TrimSpace(endpoint),
		APIKey:    strings.TrimSpace(apikey),
		APIFormat: format,
		HTTP:      &http.Client{Timeout: timeout},
	}
}

// Chat sends a chat completion request and returns the unified response,
// dispatching to the configured wire format. GenerationMs/TokensPerSecond
// in the returned Usage are computed from the wall-clock request duration.
func (c *Client) Chat(messages []Message, opt ChatOptions) (out0 *ChatResponse, out1 error) {
	defer logger.Out2(logger.In3("aiservers/llm", "Client.Chat", "c", c, "messages", messages, "&opt", &opt), &out0, &out1)
	start := time.Now()
	var resp *ChatResponse
	var err error
	if c.APIFormat == "anthropic" {
		resp, err = c.chatAnthropic(messages, opt)
	} else {
		resp, err = c.chatOpenAI(messages, opt)
	}
	if err != nil {
		logger.DebugErr("aiservers/llm", err)
		return nil, err
	}
	elapsed := time.Since(start)
	resp.Usage.GenerationMs = elapsed.Milliseconds()
	if resp.Usage.CompletionTokens > 0 && elapsed.Seconds() > 0 {
		resp.Usage.TokensPerSecond = float64(resp.Usage.CompletionTokens) / elapsed.Seconds()
	}
	return resp, nil
}

// ChatStream sends a streaming chat completion request, invoking cb for each
// incremental delta as it arrives, and returns the fully assembled response
// (with accumulated content/reasoning and usage) once the stream ends. It
// dispatches to the configured wire format. GenerationMs/TokensPerSecond are
// computed from the wall-clock request duration, exactly like Chat.
func (c *Client) ChatStream(messages []Message, opt ChatOptions, cb StreamCallback) (out0 *ChatResponse, out1 error) {
	defer logger.Out2(logger.In4("aiservers/llm", "Client.ChatStream", "c", c, "messages", messages, "&opt", &opt, "&cb", &cb), &out0, &out1)
	start := time.Now()
	var resp *ChatResponse
	var err error
	if c.APIFormat == "anthropic" {
		resp, err = c.chatAnthropicStream(messages, opt, cb)
	} else {
		resp, err = c.chatOpenAIStream(messages, opt, cb)
	}
	if err != nil {
		logger.DebugErr("aiservers/llm", err)
		return nil, err
	}
	elapsed := time.Since(start)
	resp.Usage.GenerationMs = elapsed.Milliseconds()
	if resp.Usage.CompletionTokens > 0 && elapsed.Seconds() > 0 {
		resp.Usage.TokensPerSecond = float64(resp.Usage.CompletionTokens) / elapsed.Seconds()
	}
	return resp, nil
}

// ListModels lists model IDs exposed by the endpoint, dispatching to the
// configured wire format. Used by connectivity tests and AGI scripts; does
// not consume any tokens.
func (c *Client) ListModels() (out0 []string, out1 error) {
	defer logger.Out2(logger.In1("aiservers/llm", "Client.ListModels", "c", c), &out0, &out1)
	if c.APIFormat == "anthropic" {
		return c.listModelsAnthropic()
	}
	return c.listModelsOpenAI()
}

func (c *Client) httpClient() (out0 *http.Client) {
	defer logger.Out1(logger.In1("aiservers/llm", "Client.httpClient", "c", c), &out0)
	if c.HTTP == nil {
		return &http.Client{Timeout: DefaultTimeout}
	}
	return c.HTTP
}

func truncate(s string, max int) (out0 string) {
	defer logger.Out1(logger.In2("aiservers/llm", "truncate", "s", s, "max", max), &out0)
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
