package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const (
	anthropicVersion          = "2023-06-01" //API version header sent to the Anthropic API
	anthropicDefaultMaxTokens = 4096         //Used when a call does not specify MaxTokens; Anthropic requires this field
)

type anthropicImageSource struct {
	Type      string `json:"type"`                 //"base64" or "url"
	MediaType string `json:"media_type,omitempty"` //e.g. image/png (base64 only)
	Data      string `json:"data,omitempty"`       //base64 payload (base64 only)
	URL       string `json:"url,omitempty"`        //remote URL (url source only)
}

type anthropicContentBlock struct {
	Type   string                `json:"type"` //"text" or "image"
	Text   string                `json:"text,omitempty"`
	Source *anthropicImageSource `json:"source,omitempty"`
}

type anthropicMessage struct {
	Role    string      `json:"role"`    //"user" or "assistant"
	Content interface{} `json:"content"` //string or []anthropicContentBlock
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	System      string             `json:"system,omitempty"`
	Messages    []anthropicMessage `json:"messages"`
	Temperature *float64           `json:"temperature,omitempty"`
	Stream      bool               `json:"stream"`
}

type anthropicResponse struct {
	Model   string `json:"model"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
		//Extended-thinking blocks carry their chain-of-thought in a
		//dedicated "thinking" field rather than "text".
		Thinking string `json:"thinking"`
	} `json:"content"`
	Usage struct {
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
	} `json:"usage"`
	StopReason string `json:"stop_reason"`
	Error      *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// chatAnthropic performs an Anthropic Messages API call and maps the result
// back into the unified ChatResponse shape.
func (c *Client) chatAnthropic(messages []Message, opt ChatOptions) (*ChatResponse, error) {
	//Anthropic takes the system prompt as a top-level field, not a message.
	system := ""
	amsgs := []anthropicMessage{}
	for _, m := range messages {
		if m.Role == "system" {
			if s, ok := m.Content.(string); ok {
				if system != "" {
					system += "\n\n"
				}
				system += s
			}
			continue
		}
		amsgs = append(amsgs, anthropicMessage{Role: m.Role, Content: toAnthropicContent(m.Content)})
	}

	maxTokens := anthropicDefaultMaxTokens
	if opt.MaxTokens != nil && *opt.MaxTokens > 0 {
		maxTokens = *opt.MaxTokens
	}

	reqStruct := anthropicRequest{
		Model:       opt.Model,
		MaxTokens:   maxTokens,
		System:      system,
		Messages:    amsgs,
		Temperature: opt.Temperature,
		Stream:      false,
	}
	body, err := json.Marshal(reqStruct)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", anthropicURL(c.Endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "arozos-llm-client/1.0")
	req.Header.Set("anthropic-version", anthropicVersion)
	if c.APIKey != "" {
		req.Header.Set("x-api-key", c.APIKey)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, errors.New("request to AI endpoint failed: " + err.Error())
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	parsed := &anthropicResponse{}
	if err := json.Unmarshal(respBody, parsed); err != nil {
		return nil, fmt.Errorf("unexpected response (HTTP %d): %s", resp.StatusCode, truncate(string(respBody), 300))
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, errors.New("AI endpoint error: " + parsed.Error.Message)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI endpoint returned HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	//Map the Anthropic response onto the unified ChatResponse. Text blocks
	//form the answer; thinking blocks are collected separately so callers can
	//show the model's reasoning in a dedicated (collapsible) section.
	var text, thinking strings.Builder
	for _, block := range parsed.Content {
		switch block.Type {
		case "text":
			text.WriteString(block.Text)
		case "thinking":
			thinking.WriteString(block.Thinking)
		}
	}
	unified := &ChatResponse{Model: parsed.Model}
	choice := Choice{FinishReason: parsed.StopReason}
	choice.Message.Role = "assistant"
	choice.Message.Content = text.String()
	choice.Message.ReasoningContent = thinking.String()
	unified.Choices = append(unified.Choices, choice)
	unified.Usage = Usage{
		PromptTokens:     parsed.Usage.InputTokens,
		CompletionTokens: parsed.Usage.OutputTokens,
		TotalTokens:      parsed.Usage.InputTokens + parsed.Usage.OutputTokens,
	}
	return unified, nil
}

// anthropicStreamEvent is one SSE "data:" payload from a streaming Messages
// call. A single struct covers every event type (message_start,
// content_block_delta, message_delta, error, ...) since they are
// distinguished by the Type field and use disjoint sub-objects.
type anthropicStreamEvent struct {
	Type    string `json:"type"`
	Message *struct {
		Model string `json:"model"`
		Usage *struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
	} `json:"message"`
	Delta *struct {
		Type       string `json:"type"`
		Text       string `json:"text"`
		Thinking   string `json:"thinking"`
		StopReason string `json:"stop_reason"`
	} `json:"delta"`
	Usage *struct {
		OutputTokens int64 `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// chatAnthropicStream performs a streaming Anthropic Messages call, invoking cb
// for each text/thinking delta and assembling the unified response. Anthropic
// splits usage across message_start (input tokens) and message_delta (output
// tokens), so both are accumulated before computing the total.
func (c *Client) chatAnthropicStream(messages []Message, opt ChatOptions, cb StreamCallback) (*ChatResponse, error) {
	system := ""
	amsgs := []anthropicMessage{}
	for _, m := range messages {
		if m.Role == "system" {
			if s, ok := m.Content.(string); ok {
				if system != "" {
					system += "\n\n"
				}
				system += s
			}
			continue
		}
		amsgs = append(amsgs, anthropicMessage{Role: m.Role, Content: toAnthropicContent(m.Content)})
	}

	maxTokens := anthropicDefaultMaxTokens
	if opt.MaxTokens != nil && *opt.MaxTokens > 0 {
		maxTokens = *opt.MaxTokens
	}

	reqStruct := anthropicRequest{
		Model:       opt.Model,
		MaxTokens:   maxTokens,
		System:      system,
		Messages:    amsgs,
		Temperature: opt.Temperature,
		Stream:      true,
	}
	body, err := json.Marshal(reqStruct)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", anthropicURL(c.Endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("User-Agent", "arozos-llm-client/1.0")
	req.Header.Set("anthropic-version", anthropicVersion)
	if c.APIKey != "" {
		req.Header.Set("x-api-key", c.APIKey)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, errors.New("request to AI endpoint failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		if msg := openaiErrorMessage(respBody); msg != "" {
			return nil, errors.New("AI endpoint error: " + msg)
		}
		return nil, fmt.Errorf("AI endpoint returned HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	var textB, thinkingB strings.Builder
	var model, stopReason string
	var inputTokens, outputTokens int64

	reader := bufio.NewReader(resp.Body)
	for {
		line, readErr := reader.ReadString('\n')
		if trimmed := strings.TrimRight(line, "\r\n"); strings.HasPrefix(trimmed, "data:") {
			data := strings.TrimSpace(trimmed[len("data:"):])
			if data != "" {
				var ev anthropicStreamEvent
				if json.Unmarshal([]byte(data), &ev) == nil {
					switch ev.Type {
					case "message_start":
						if ev.Message != nil {
							if ev.Message.Model != "" {
								model = ev.Message.Model
							}
							if ev.Message.Usage != nil {
								inputTokens = ev.Message.Usage.InputTokens
							}
						}
					case "content_block_delta":
						if ev.Delta != nil {
							d := StreamDelta{}
							if ev.Delta.Type == "thinking_delta" && ev.Delta.Thinking != "" {
								d.Reasoning = ev.Delta.Thinking
								thinkingB.WriteString(ev.Delta.Thinking)
							} else if ev.Delta.Text != "" {
								d.Content = ev.Delta.Text
								textB.WriteString(ev.Delta.Text)
							}
							if cb != nil && (d.Content != "" || d.Reasoning != "") {
								cb(d)
							}
						}
					case "message_delta":
						if ev.Delta != nil && ev.Delta.StopReason != "" {
							stopReason = ev.Delta.StopReason
						}
						if ev.Usage != nil {
							outputTokens = ev.Usage.OutputTokens
						}
					case "error":
						if ev.Error != nil && ev.Error.Message != "" {
							return nil, errors.New("AI endpoint error: " + ev.Error.Message)
						}
					}
				}
			}
		}
		if readErr != nil {
			break
		}
	}

	unified := &ChatResponse{Model: model}
	choice := Choice{FinishReason: stopReason}
	choice.Message.Role = "assistant"
	choice.Message.Content = textB.String()
	choice.Message.ReasoningContent = thinkingB.String()
	unified.Choices = append(unified.Choices, choice)
	unified.Usage = Usage{
		PromptTokens:     inputTokens,
		CompletionTokens: outputTokens,
		TotalTokens:      inputTokens + outputTokens,
	}
	return unified, nil
}

// listModelsAnthropic lists model IDs from the Anthropic /v1/models endpoint.
func (c *Client) listModelsAnthropic() ([]string, error) {
	base := strings.TrimRight(c.Endpoint, "/")
	var requestURL string
	if strings.HasSuffix(base, "/models") {
		requestURL = base
	} else if strings.HasSuffix(base, "/v1") {
		requestURL = base + "/models"
	} else {
		requestURL = base + "/v1/models"
	}

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, err
	}
	if c.APIKey != "" {
		req.Header.Set("x-api-key", c.APIKey)
		req.Header.Set("anthropic-version", anthropicVersion)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, errors.New("connection failed: " + err.Error())
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("endpoint returned HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 200))
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
	return models, nil
}

// anthropicURL builds the Messages endpoint URL from a base URL, tolerating
// bases with or without a trailing /v1 or /messages.
func anthropicURL(endpoint string) string {
	base := strings.TrimRight(endpoint, "/")
	if strings.HasSuffix(base, "/messages") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/messages"
	}
	return base + "/v1/messages"
}

// toAnthropicContent converts unified message content (a plain string or an
// array of OpenAI-style content parts) into Anthropic content blocks.
func toAnthropicContent(content interface{}) interface{} {
	switch v := content.(type) {
	case string:
		return v
	case []ContentPart:
		blocks := make([]anthropicContentBlock, 0, len(v))
		for _, p := range v {
			if p.Type == "text" {
				blocks = append(blocks, anthropicContentBlock{Type: "text", Text: p.Text})
			} else if p.Type == "image_url" && p.ImageURL != nil {
				blocks = append(blocks, anthropicImageBlock(p.ImageURL.URL))
			}
		}
		return blocks
	case []interface{}:
		blocks := make([]anthropicContentBlock, 0, len(v))
		for _, raw := range v {
			m, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			t, _ := m["type"].(string)
			if t == "text" {
				txt, _ := m["text"].(string)
				blocks = append(blocks, anthropicContentBlock{Type: "text", Text: txt})
			} else if t == "image_url" {
				if iu, ok := m["image_url"].(map[string]interface{}); ok {
					url, _ := iu["url"].(string)
					blocks = append(blocks, anthropicImageBlock(url))
				}
			}
		}
		return blocks
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// anthropicImageBlock converts an image URL (data URI or remote) into an
// Anthropic image content block.
func anthropicImageBlock(url string) anthropicContentBlock {
	if strings.HasPrefix(url, "data:") {
		meta := url[len("data:"):]
		if comma := strings.Index(meta, ","); comma >= 0 {
			head := meta[:comma]
			data := meta[comma+1:]
			mediaType := strings.TrimSuffix(head, ";base64")
			if mediaType == "" {
				mediaType = "image/png"
			}
			return anthropicContentBlock{Type: "image", Source: &anthropicImageSource{Type: "base64", MediaType: mediaType, Data: data}}
		}
	}
	return anthropicContentBlock{Type: "image", Source: &anthropicImageSource{Type: "url", URL: url}}
}
