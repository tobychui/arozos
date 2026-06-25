package llm

import "time"

// DefaultTimeout is used when NewClient is called with timeout <= 0.
const DefaultTimeout = 120 * time.Second

// ImageURL is an OpenAI-style image content reference (data URI or remote URL).
type ImageURL struct {
	URL string `json:"url"`
}

// ContentPart is one part of a multimodal message's content array.
type ContentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
}

// Message is one OpenAI-style chat message. Content is either a plain string
// or a []ContentPart / []interface{} for multimodal (vision/file) messages.
type Message struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

// ChatOptions are the per-call parameters for Client.Chat.
type ChatOptions struct {
	Model       string   //Required: which model to use
	Temperature *float64 //Sampling temperature
	MaxTokens   *int     //Maximum tokens to generate
}

// Usage is the token usage / timing for one completion.
type Usage struct {
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	TokensPerSecond  float64 `json:"tokens_per_second"` //completion tokens / generation time
	GenerationMs     int64   `json:"generation_ms"`     //wall-clock duration of the request
}

// Choice is one completion choice.
type Choice struct {
	Index   int `json:"index"`
	Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"message"`
	FinishReason string `json:"finish_reason"`
}

// ChatResponse is the unified response shape returned by Client.Chat,
// regardless of whether the call went to an OpenAI- or Anthropic-shaped
// endpoint.
type ChatResponse struct {
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}
