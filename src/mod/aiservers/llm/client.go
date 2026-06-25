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
func NewClient(endpoint, apikey, format string, timeout time.Duration) *Client {
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
func (c *Client) Chat(messages []Message, opt ChatOptions) (*ChatResponse, error) {
	start := time.Now()
	var resp *ChatResponse
	var err error
	if c.APIFormat == "anthropic" {
		resp, err = c.chatAnthropic(messages, opt)
	} else {
		resp, err = c.chatOpenAI(messages, opt)
	}
	if err != nil {
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
func (c *Client) ListModels() ([]string, error) {
	if c.APIFormat == "anthropic" {
		return c.listModelsAnthropic()
	}
	return c.listModelsOpenAI()
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP == nil {
		return &http.Client{Timeout: DefaultTimeout}
	}
	return c.HTTP
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
