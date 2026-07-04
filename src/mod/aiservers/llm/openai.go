package llm

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type openaiChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature *float64  `json:"temperature,omitempty"`
	MaxTokens   *int      `json:"max_tokens,omitempty"`
	Stream      bool      `json:"stream"`
}

type openaiChatResponse struct {
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
		out.Choices = append(out.Choices, choice)
	}
	out.Usage = Usage{
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		TotalTokens:      parsed.Usage.TotalTokens,
	}
	return out, nil
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
