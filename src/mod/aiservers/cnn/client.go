package cnn

/*
	CXNNAIO Client

	A minimal Go client for the CXNNAIO vision-inference REST API (see
	E:\golang\ncnn\docs\API.md for the upstream design doc). This package only
	speaks the wire protocol - it carries no ArozOS-specific knowledge (no AGI,
	no virtual paths, no system database), so it can be reused from anywhere in
	the codebase. The AGI binding that exposes it to WebApp backend scripts
	lives in mod/agi/agi.cnn.go.

	Author: tobychui (AGI/ArozOS integration)
*/

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultTimeout is used when NewClient is called with timeout <= 0.
const DefaultTimeout = 60 * time.Second

// Client talks to one CXNNAIO server instance.
type Client struct {
	Endpoint string //Base URL, e.g. http://localhost:8080
	Token    string //Bearer token; leave empty for a server running in no_auth mode
	HTTP     *http.Client
}

// NewClient creates a client for the given endpoint. timeout <= 0 uses DefaultTimeout.
func NewClient(endpoint string, token string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &Client{
		Endpoint: strings.TrimRight(strings.TrimSpace(endpoint), "/"),
		Token:    strings.TrimSpace(token),
		HTTP:     &http.Client{Timeout: timeout},
	}
}

// do sends a request to path and decodes the response.
//   - On a 2xx success, the body is decoded into out (which may be nil to
//     discard it) and the returned *Job is nil.
//   - On a 202 Accepted (async submission), the body is decoded into a *Job
//     and returned; out is left untouched.
//   - On any other status, the body is decoded as the API's error envelope
//     and returned as a *APIError.
func (c *Client) do(method, path string, body interface{}, out interface{}) (*Job, error) {
	if strings.TrimSpace(c.Endpoint) == "" {
		return nil, fmt.Errorf("cnn: server endpoint is not configured")
	}

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("cnn: failed to encode request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, c.Endpoint+path, reader)
	if err != nil {
		return nil, fmt.Errorf("cnn: failed to build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "arozos-cnn-client/1.0")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: DefaultTimeout}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cnn: request to %s failed: %w", path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("cnn: failed to read response: %w", err)
	}

	switch {
	case resp.StatusCode == http.StatusAccepted:
		job := &Job{}
		if err := json.Unmarshal(respBody, job); err != nil {
			return nil, fmt.Errorf("cnn: unexpected 202 response: %s", truncate(string(respBody), 300))
		}
		return job, nil
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		if out != nil && len(respBody) > 0 {
			if err := json.Unmarshal(respBody, out); err != nil {
				return nil, fmt.Errorf("cnn: failed to decode response (HTTP %d): %s", resp.StatusCode, truncate(string(respBody), 300))
			}
		}
		return nil, nil
	default:
		var envelope struct {
			Error APIError `json:"error"`
		}
		if err := json.Unmarshal(respBody, &envelope); err != nil || envelope.Error.Message == "" {
			return nil, &APIError{Status: resp.StatusCode, Message: truncate(string(respBody), 300), Type: "server_error"}
		}
		envelope.Error.Status = resp.StatusCode
		return nil, &envelope.Error
	}
}

// doImageCall posts a single-image request and decodes the response into an
// envelope[T]. A non-nil *Job means the server accepted the call
// asynchronously instead of returning the result immediately.
func doImageCall[T any](c *Client, path string, req imageRequest) (*envelope[T], *Job, error) {
	result := &envelope[T]{}
	job, err := c.do(http.MethodPost, path, req, result)
	if err != nil || job != nil {
		return nil, job, err
	}
	return result, nil, nil
}

// dataURI builds a base64 data URI for the given raw image bytes.
func dataURI(image []byte, mimeType string) string {
	if strings.TrimSpace(mimeType) == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(image)
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
