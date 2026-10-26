package cnn

import (
	"encoding/json"
	"net/http"
)

// AnalyzeOptions are the parameters for Analyze.
type AnalyzeOptions struct {
	//Tasks selects which recognition tasks to run in this single request, e.g.
	//"classify", "detect", "segment", "pose", "oriented", "faces", "landmarks",
	//"attributes".
	Tasks []string `json:"tasks"`
	//Options carries per-task parameters, keyed by task name, using the same
	//fields as RequestOptions (raw passthrough - shapes differ per task).
	Options map[string]json.RawMessage `json:"options,omitempty"`
	Render  bool                       `json:"render,omitempty"`
	Async   bool                       `json:"async,omitempty"`
}

type analyzeRequest struct {
	Image   string                     `json:"image"`
	Tasks   []string                   `json:"tasks"`
	Options map[string]json.RawMessage `json:"options,omitempty"`
	Render  bool                       `json:"render,omitempty"`
	Async   bool                       `json:"async,omitempty"`
}

// AnalyzeResult is the response of POST /v1/vision/analyze. Results is keyed
// by task name; each value is that task's own envelope shape (raw passthrough
// since the shape differs per task and callers re-serialize it anyway).
type AnalyzeResult struct {
	Object        string                     `json:"object"`
	Created       int64                      `json:"created"`
	Image         *Dims                      `json:"image,omitempty"`
	Results       map[string]json.RawMessage `json:"results"`
	RenderedImage string                     `json:"rendered_image,omitempty"`
}

// Analyze runs several recognition tasks over one image in a single request
// (the server decodes the image and warms models once).
func (c *Client) Analyze(image []byte, mimeType string, opt AnalyzeOptions) (*AnalyzeResult, *Job, error) {
	req := analyzeRequest{
		Image:   dataURI(image, mimeType),
		Tasks:   opt.Tasks,
		Options: opt.Options,
		Render:  opt.Render,
		Async:   opt.Async,
	}
	result := &AnalyzeResult{}
	job, err := c.do(http.MethodPost, "/v1/vision/analyze", req, result)
	if err != nil || job != nil {
		return nil, job, err
	}
	return result, nil, nil
}
