package cnn

import (
	"net/http"
	"net/url"

	"imuslab.com/arozos/mod/info/logger"
)

// Health calls GET /v1/health. This endpoint is always public on the server
// side (no auth required), but the client still sends its token if one is set.
func (c *Client) Health() (out0 *Health, out1 error) {
	defer logger.Out2(logger.In1("aiservers/cnn", "Client.Health", "c", c), &out0, &out1)
	result := &Health{}
	if _, err := c.do(http.MethodGet, "/v1/health", nil, result); err != nil {
		logger.DebugErr("aiservers/cnn", err)
		return nil, err
	}
	return result, nil
}

// ListModels calls GET /v1/models.
func (c *Client) ListModels() (out0 *ModelList, out1 error) {
	defer logger.Out2(logger.In1("aiservers/cnn", "Client.ListModels", "c", c), &out0, &out1)
	result := &ModelList{}
	if _, err := c.do(http.MethodGet, "/v1/models", nil, result); err != nil {
		logger.DebugErr("aiservers/cnn", err)
		return nil, err
	}
	return result, nil
}

// GetModel calls GET /v1/models/{id}.
func (c *Client) GetModel(id string) (out0 *ModelInfo, out1 error) {
	defer logger.Out2(logger.In2("aiservers/cnn", "Client.GetModel", "c", c, "id", id), &out0, &out1)
	result := &ModelInfo{}
	if _, err := c.do(http.MethodGet, "/v1/models/"+url.PathEscape(id), nil, result); err != nil {
		logger.DebugErr("aiservers/cnn", err)
		return nil, err
	}
	return result, nil
}

// GetJob polls an async job submitted by any of the recognition calls with
// opt.Async = true. Status is one of "queued", "running", "succeeded" or
// "failed"; Result/Error are populated once the job leaves "running".
func (c *Client) GetJob(id string) (out0 *Job, out1 error) {
	defer logger.Out2(logger.In2("aiservers/cnn", "Client.GetJob", "c", c, "id", id), &out0, &out1)
	result := &Job{}
	if _, err := c.do(http.MethodGet, "/v1/jobs/"+url.PathEscape(id), nil, result); err != nil {
		logger.DebugErr("aiservers/cnn", err)
		return nil, err
	}
	return result, nil
}
