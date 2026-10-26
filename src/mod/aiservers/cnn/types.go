package cnn

import (
	"encoding/json"
	"fmt"
)

// Dims is the decoded source image's dimensions in pixels.
type Dims struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Box is an absolute-pixel axis-aligned bounding box in the original image.
type Box struct {
	X1 int `json:"x1"`
	Y1 int `json:"y1"`
	X2 int `json:"x2"`
	Y2 int `json:"y2"`
}

// Point is an absolute-pixel coordinate in the original image.
type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// envelope is the common response shape shared by every single-image
// recognition endpoint; only the item type carried in Data differs per task.
type envelope[T any] struct {
	Object        string `json:"object"`
	Model         string `json:"model,omitempty"`
	Created       int64  `json:"created"`
	Image         *Dims  `json:"image,omitempty"`
	TimingMs      int64  `json:"timing_ms"`
	Data          []T    `json:"data,omitempty"`
	RenderedImage string `json:"rendered_image,omitempty"`
}

// APIError is the server's OpenAI-style error envelope; it also satisfies error.
type APIError struct {
	Status  int    `json:"-"`
	Message string `json:"message"`
	Type    string `json:"type"`
	Param   string `json:"param,omitempty"`
	Code    string `json:"code,omitempty"`
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("cnn: %s (%s)", e.Message, e.Code)
	}
	return "cnn: " + e.Message
}

// Job is an async inference job: returned immediately on submission (HTTP
// 202, when the request set "async":true) and again by GetJob while polling.
type Job struct {
	ID      string          `json:"id"`
	Object  string          `json:"object"`
	Status  string          `json:"status"` //"queued" | "running" | "succeeded" | "failed"
	Created int64           `json:"created"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

// ModelInfo describes one model registered on the server.
type ModelInfo struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Task    string `json:"task"`
	Classes int    `json:"classes,omitempty"`
	Input   int    `json:"input,omitempty"`
}

// ModelList is the response of GET /v1/models.
type ModelList struct {
	Object string      `json:"object"`
	Data   []ModelInfo `json:"data"`
}

// Health is the response of GET /v1/health.
type Health struct {
	Status       string `json:"status"`
	Version      string `json:"version"`
	ModelsLoaded int    `json:"models_loaded"`
	Sessions     int    `json:"sessions"`
	UptimeS      int64  `json:"uptime_s"`
}

// RequestOptions are the common per-call parameters shared by every
// single-image recognition endpoint. Field names mirror the server's own
// wire format (snake_case) so they can be set directly from AGI scripts
// using the same names documented in the CXNNAIO API doc.
type RequestOptions struct {
	Model          string   `json:"model,omitempty"`
	ScoreThreshold *float32 `json:"score_threshold,omitempty"`
	NMSThreshold   *float32 `json:"nms_threshold,omitempty"`
	TopK           int      `json:"top_k,omitempty"`
	MaxResults     int      `json:"max_results,omitempty"`
	Render         bool     `json:"render,omitempty"`
	Cropped        bool     `json:"cropped,omitempty"`
	Async          bool     `json:"async,omitempty"`
}

// imageRequest is the common single-image JSON request body. The same shape
// is sent to every image/face recognition endpoint; fields that don't apply
// to a given task (e.g. top_k for detection) are simply ignored server-side.
type imageRequest struct {
	Model          string   `json:"model,omitempty"`
	Image          string   `json:"image"`
	ScoreThreshold *float32 `json:"score_threshold,omitempty"`
	NMSThreshold   *float32 `json:"nms_threshold,omitempty"`
	TopK           int      `json:"top_k,omitempty"`
	MaxResults     int      `json:"max_results,omitempty"`
	Render         bool     `json:"render,omitempty"`
	Cropped        bool     `json:"cropped,omitempty"`
	Async          bool     `json:"async,omitempty"`
}

func newImageRequest(image []byte, mimeType string, opt RequestOptions) imageRequest {
	return imageRequest{
		Model:          opt.Model,
		Image:          dataURI(image, mimeType),
		ScoreThreshold: opt.ScoreThreshold,
		NMSThreshold:   opt.NMSThreshold,
		TopK:           opt.TopK,
		MaxResults:     opt.MaxResults,
		Render:         opt.Render,
		Cropped:        opt.Cropped,
		Async:          opt.Async,
	}
}
