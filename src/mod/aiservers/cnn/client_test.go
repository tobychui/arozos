package cnn

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClientDefaults(t *testing.T) {
	c := NewClient(" http://localhost:8080/ ", "", 0)
	if c.Endpoint != "http://localhost:8080" {
		t.Errorf("endpoint not trimmed: %q", c.Endpoint)
	}
	if c.HTTP.Timeout != DefaultTimeout {
		t.Errorf("expected default timeout, got %v", c.HTTP.Timeout)
	}
}

func TestAuthHeaderSentWhenTokenSet(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","version":"0.1.0"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok123", 0)
	if _, err := c.Health(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("expected Bearer header, got %q", gotAuth)
	}
}

func TestAuthHeaderOmittedWhenNoToken(t *testing.T) {
	var gotAuth string
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	if _, err := c.Health(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("server was not called")
	}
	if gotAuth != "" {
		t.Errorf("expected no Authorization header, got %q", gotAuth)
	}
}

func TestErrorEnvelopeDecoded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message": `model "x" is not available`,
				"type":    "not_found_error",
				"code":    "model_not_found",
			},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	_, _, err := c.Detect([]byte{1, 2, 3}, "image/png", RequestOptions{Model: "x"})
	if err == nil {
		t.Fatal("expected an error")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusNotFound || apiErr.Code != "model_not_found" {
		t.Errorf("unexpected error fields: %+v", apiErr)
	}
}

func TestAsyncSubmissionReturnsJob(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(Job{ID: "job-1", Object: "job", Status: "queued", Created: 1})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, job, err := c.Detect([]byte{1, 2, 3}, "image/png", RequestOptions{Async: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result on async submission, got %+v", result)
	}
	if job == nil || job.ID != "job-1" || job.Status != "queued" {
		t.Fatalf("unexpected job: %+v", job)
	}
}

func TestEndpointNotConfigured(t *testing.T) {
	c := NewClient("", "", 0)
	if _, err := c.Health(); err == nil {
		t.Fatal("expected an error when endpoint is empty")
	}
}

func TestGetJob(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/jobs/job-1" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(Job{ID: "job-1", Status: "succeeded", Result: json.RawMessage(`{"object":"image.detection"}`)})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	job, err := c.GetJob("job-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job.Status != "succeeded" {
		t.Errorf("unexpected status: %s", job.Status)
	}
}

func TestHealthAndListModelsAndGetModel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/health":
			json.NewEncoder(w).Encode(Health{Status: "ok", Version: "0.1.0", ModelsLoaded: 12, UptimeS: 100})
		case "/v1/models":
			json.NewEncoder(w).Encode(ModelList{Object: "list", Data: []ModelInfo{{ID: "yolo11n", Object: "model", Task: "detection"}}})
		case "/v1/models/yolo11n":
			json.NewEncoder(w).Encode(ModelInfo{ID: "yolo11n", Object: "model", Task: "detection", Classes: 80, Input: 640})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	h, err := c.Health()
	if err != nil || h.Status != "ok" || h.ModelsLoaded != 12 {
		t.Fatalf("unexpected health: %+v, err=%v", h, err)
	}
	models, err := c.ListModels()
	if err != nil || len(models.Data) != 1 || models.Data[0].ID != "yolo11n" {
		t.Fatalf("unexpected models: %+v, err=%v", models, err)
	}
	model, err := c.GetModel("yolo11n")
	if err != nil || model.Classes != 80 {
		t.Fatalf("unexpected model: %+v, err=%v", model, err)
	}
}
