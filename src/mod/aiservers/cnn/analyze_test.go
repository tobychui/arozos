package cnn

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAnalyze(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/vision/analyze" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &gotBody)
		json.NewEncoder(w).Encode(map[string]any{
			"object":  "vision.analysis",
			"created": 1,
			"results": map[string]any{
				"detect": map[string]any{"object": "image.detection", "data": []any{}},
			},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, job, err := c.Analyze([]byte("x"), "image/jpeg", AnalyzeOptions{Tasks: []string{"detect", "faces"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job != nil {
		t.Fatalf("did not expect an async job")
	}
	tasks, _ := gotBody["tasks"].([]any)
	if len(tasks) != 2 {
		t.Errorf("tasks not forwarded: %+v", gotBody["tasks"])
	}
	if _, ok := result.Results["detect"]; !ok {
		t.Errorf("expected a detect entry in results: %+v", result.Results)
	}
}

func TestAnalyzeAsync(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(Job{ID: "job-2", Status: "queued"})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, job, err := c.Analyze([]byte("x"), "image/jpeg", AnalyzeOptions{Tasks: []string{"detect"}, Async: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil || job == nil || job.ID != "job-2" {
		t.Fatalf("expected an async job, got result=%+v job=%+v", result, job)
	}
}
