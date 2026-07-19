package cnn

import (
	"encoding/base64"
	"net"
	"testing"
	"time"
)

// TestLiveSmoke is a throwaway sanity check against a real, locally running
// no_auth CXNNAIO instance. It's skipped unless one is actually reachable on
// localhost:8080, so it never affects normal `go test ./...` runs / CI.
func TestLiveSmoke(t *testing.T) {
	conn, err := net.DialTimeout("tcp", "localhost:8080", 300*time.Millisecond)
	if err != nil {
		t.Skip("no live CXNNAIO server on localhost:8080, skipping")
	}
	conn.Close()

	c := NewClient("http://localhost:8080", "", 10*time.Second)

	h, err := c.Health()
	if err != nil {
		t.Fatalf("Health() failed: %v", err)
	}
	t.Logf("health: %+v", h)
	if h.Status != "ok" {
		t.Errorf("expected status ok, got %q", h.Status)
	}

	models, err := c.ListModels()
	if err != nil {
		t.Fatalf("ListModels() failed: %v", err)
	}
	t.Logf("models loaded: %d", len(models.Data))
	if len(models.Data) == 0 {
		t.Errorf("expected at least one model")
	}

	//1x1 PNG, verified against this same live server via curl during planning.
	tinyPNG, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAarVyFEAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("failed to decode test PNG: %v", err)
	}
	result, job, err := c.Classify(tinyPNG, "image/png", RequestOptions{Model: "mobilenet-v2", TopK: 3})
	if err != nil {
		t.Fatalf("Classify() failed: %v", err)
	}
	if job != nil {
		t.Fatalf("did not expect an async job")
	}
	t.Logf("classify result: object=%s model=%s data=%+v", result.Object, result.Model, result.Data)
	if result.Object != "image.classification" || len(result.Data) == 0 {
		t.Errorf("unexpected classify result: %+v", result)
	}
}
