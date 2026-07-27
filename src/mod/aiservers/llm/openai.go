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

type openaiStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type openaiChatRequest struct {
	Model         string               `json:"model"`
	Messages      []Message            `json:"messages"`
	Temperature   *float64             `json:"temperature,omitempty"`
	MaxTokens     *int                 `json:"max_tokens,omitempty"`
	Stream        bool                 `json:"stream"`
	StreamOptions *openaiStreamOptions `json:"stream_options,omitempty"`
}

// openaiStreamChunk is one SSE "data:" payload from a streaming completion.
type openaiStreamChunk struct {
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role             string `json:"role"`
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
		TotalTokens      int64 `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

type openaiChatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
			//Reasoning / "thinking" text, exposed under different keys by
			//different OpenAI-compatible providers (reasoning_content by
			//DeepSeek, reasoning by OpenRouter and some local runtimes).
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"`
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

// chatOpenAI performs an OpenAI-compatible chat completion call.
func (c *Client) chatOpenAI(messages []Message, opt ChatOptions) (*ChatResponse, error) {
	reqStruct := openaiChatRequest{
		Model:       opt.Model,
		Messages:    messages,
		Temperature: opt.Temperature,
		MaxTokens:   opt.MaxTokens,
		Stream:      false,
	}
	body, err := json.Marshal(reqStruct)
	if err != nil {
		return nil, err
	}

	requestURL := strings.TrimRight(c.Endpoint, "/")
	if !strings.HasSuffix(requestURL, "/chat/completions") {
		requestURL += "/chat/completions"
	}
	req, err := http.NewRequest("POST", requestURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "arozos-llm-client/1.0")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
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

	parsed := &openaiChatResponse{}
	if err := json.Unmarshal(respBody, parsed); err != nil {
		return nil, fmt.Errorf("unexpected response (HTTP %d): %s", resp.StatusCode, truncate(string(respBody), 300))
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, errors.New("AI endpoint error: " + parsed.Error.Message)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI endpoint returned HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	out := &ChatResponse{Model: parsed.Model}
	for _, ch := range parsed.Choices {
		choice := Choice{Index: ch.Index, FinishReason: ch.FinishReason}
		choice.Message.Role = ch.Message.Role
		choice.Message.Content = ch.Message.Content
		//Prefer reasoning_content (DeepSeek) and fall back to reasoning
		//(OpenRouter) so either provider's thinking output is surfaced.
		choice.Message.ReasoningContent = ch.Message.ReasoningContent
		if choice.Message.ReasoningContent == "" {
			choice.Message.ReasoningContent = ch.Message.Reasoning
		}
		out.Choices = append(out.Choices, choice)
	}
	out.Usage = Usage{
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		TotalTokens:      parsed.Usage.TotalTokens,
	}
	return out, nil
}

// chatOpenAIStream performs a streaming OpenAI-compatible chat completion,
// invoking cb for each delta and returning the assembled response. It requests
// usage via stream_options.include_usage so the final chunk carries token
// counts (endpoints that ignore the field simply yield zero usage).
func (c *Client) chatOpenAIStream(messages []Message, opt ChatOptions, cb StreamCallback) (*ChatResponse, error) {
	reqStruct := openaiChatRequest{
		Model:         opt.Model,
		Messages:      messages,
		Temperature:   opt.Temperature,
		MaxTokens:     opt.MaxTokens,
		Stream:        true,
		StreamOptions: &openaiStreamOptions{IncludeUsage: true},
	}
	body, err := json.Marshal(reqStruct)
	if err != nil {
		return nil, err
	}

	requestURL := strings.TrimRight(c.Endpoint, "/")
	if !strings.HasSuffix(requestURL, "/chat/completions") {
		requestURL += "/chat/completions"
	}
	req, err := http.NewRequest("POST", requestURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("User-Agent", "arozos-llm-client/1.0")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
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

	var contentB, reasoningB strings.Builder
	var model, finishReason string
	var usage Usage

	reader := bufio.NewReader(resp.Body)
	for {
		line, readErr := reader.ReadString('\n')
		if trimmed := strings.TrimRight(line, "\r\n"); strings.HasPrefix(trimmed, "data:") {
			data := strings.TrimSpace(trimmed[len("data:"):])
			if data == "" {
				// keep reading
			} else if data == "[DONE]" {
				break
			} else {
				var chunk openaiStreamChunk
				if json.Unmarshal([]byte(data), &chunk) == nil {
					if chunk.Error != nil && chunk.Error.Message != "" {
						return nil, errors.New("AI endpoint error: " + chunk.Error.Message)
					}
					if chunk.Model != "" {
						model = chunk.Model
					}
					for _, ch := range chunk.Choices {
						d := StreamDelta{Content: ch.Delta.Content}
						d.Reasoning = ch.Delta.ReasoningContent
						if d.Reasoning == "" {
							d.Reasoning = ch.Delta.Reasoning
						}
						if d.Content != "" {
							contentB.WriteString(d.Content)
						}
						if d.Reasoning != "" {
							reasoningB.WriteString(d.Reasoning)
						}
						if ch.FinishReason != "" {
							finishReason = ch.FinishReason
						}
						if cb != nil && (d.Content != "" || d.Reasoning != "") {
							cb(d)
						}
					}
					if chunk.Usage != nil {
						usage.PromptTokens = chunk.Usage.PromptTokens
						usage.CompletionTokens = chunk.Usage.CompletionTokens
						usage.TotalTokens = chunk.Usage.TotalTokens
					}
				}
			}
		}
		if readErr != nil {
			break
		}
	}

	out := &ChatResponse{Model: model}
	choice := Choice{FinishReason: finishReason}
	choice.Message.Role = "assistant"
	choice.Message.Content = contentB.String()
	choice.Message.ReasoningContent = reasoningB.String()
	out.Choices = append(out.Choices, choice)
	out.Usage = usage
	return out, nil
}

// openaiErrorMessage extracts the human-readable message from an OpenAI-style
// error envelope, or returns "" when the body is not such an envelope.
func openaiErrorMessage(body []byte) string {
	var env struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &env) == nil && env.Error != nil {
		return env.Error.Message
	}
	return ""
}

// listModelsOpenAI lists model IDs from an OpenAI-compatible /models endpoint.
func (c *Client) listModelsOpenAI() ([]string, error) {
	base := strings.TrimRight(c.Endpoint, "/")
	requestURL := base
	if !strings.HasSuffix(base, "/models") {
		requestURL = base + "/models"
	}

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, err
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
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
