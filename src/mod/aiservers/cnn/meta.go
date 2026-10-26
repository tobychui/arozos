package cnn

import (
	"net/http"
	"net/url"
)

// Health calls GET /v1/health. This endpoint is always public on the server
// side (no auth required), but the client still sends its token if one is set.
func (c *Client) Health() (*Health, error) {
	result := &Health{}
	if _, err := c.do(http.MethodGet, "/v1/health", nil, result); err != nil {
		return nil, err
	}
	return result, nil
}

// ListModels calls GET /v1/models.
func (c *Client) ListModels() (*ModelList, error) {
	result := &ModelList{}
	if _, err := c.do(http.MethodGet, "/v1/models", nil, result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetModel calls GET /v1/models/{id}.
func (c *Client) GetModel(id string) (*ModelInfo, error) {
	result := &ModelInfo{}
	if _, err := c.do(http.MethodGet, "/v1/models/"+url.PathEscape(id), nil, result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetJob polls an async job submitted by any of the recognition calls with
// opt.Async = true. Status is one of "queued", "running", "succeeded" or
// "failed"; Result/Error are populated once the job leaves "running".
func (c *Client) GetJob(id string) (*Job, error) {
	result := &Job{}
	if _, err := c.do(http.MethodGet, "/v1/jobs/"+url.PathEscape(id), nil, result); err != nil {
		return nil, err
	}
	return result, nil
}
