package agi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

// ─── pure helpers ─────────────────────────────────────────────────────────────

func TestCNNMaskToken(t *testing.T) {
	cases := map[string]string{
		"":               "",
		"abc":            "•••",
		"cxn-1234567890": "••••7890",
	}
	for in, want := range cases {
		if got := cnnMaskToken(in); got != want {
			t.Errorf("cnnMaskToken(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCNNIsImageExt(t *testing.T) {
	if !cnnIsImageExt(".png") || !cnnIsImageExt(".jpeg") || !cnnIsImageExt(".webp") {
		t.Error("expected image extensions to be detected")
	}
	if cnnIsImageExt(".txt") {
		t.Error(".txt should not be an image")
	}
}

func TestParseCNNOptions(t *testing.T) {
	if opt := parseCNNOptions(""); opt.Model != "" {
		t.Errorf("empty string should yield zero options")
	}
	if opt := parseCNNOptions("undefined"); opt.Model != "" {
		t.Errorf("'undefined' should yield zero options")
	}
	if opt := parseCNNOptions("null"); opt.Model != "" {
		t.Errorf("'null' should yield zero options")
	}
	opt := parseCNNOptions(`{"model":"yolo11n","score_threshold":0.3,"render":true,"top_k":5}`)
	if opt.Model != "yolo11n" || !opt.Render || opt.TopK != 5 {
		t.Errorf("unexpected parse: %+v", opt)
	}
	if opt.ScoreThreshold == nil || *opt.ScoreThreshold != 0.3 {
		t.Errorf("score_threshold not parsed: %+v", opt)
	}
}

func TestParseCNNComparisonOptions(t *testing.T) {
	opt := parseCNNComparisonOptions(`{"threshold":0.5,"a_cropped":true}`)
	if opt.Threshold == nil || *opt.Threshold != 0.5 || !opt.ACropped {
		t.Errorf("unexpected parse: %+v", opt)
	}
	if opt := parseCNNComparisonOptions(""); opt.Threshold != nil {
		t.Errorf("empty string should yield zero options")
	}
}

// ─── persistence ──────────────────────────────────────────────────────────────

func TestCNNConfigDefaultsAndPersistence(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)

	cfg := g.getCNNConfig()
	if cfg.TimeoutSeconds != cnnDefaultTimeoutSeconds {
		t.Errorf("expected default timeout %d, got %d", cnnDefaultTimeoutSeconds, cfg.TimeoutSeconds)
	}

	sysdb.Write(cnnDBTable, "config", CNNServerConfig{Endpoint: "http://localhost:8080", Token: "tok", TimeoutSeconds: 30})
	cfg = g.getCNNConfig()
	if cfg.Endpoint != "http://localhost:8080" || cfg.Token != "tok" || cfg.TimeoutSeconds != 30 {
		t.Errorf("unexpected config after write: %+v", cfg)
	}
}

func TestCNNClientRequiresEndpoint(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)

	if _, err := g.cnnClient(); err == nil {
		t.Fatal("expected an error when endpoint is not configured")
	}
}

// ─── VM injection ─────────────────────────────────────────────────────────────

// TestCNNFunctionsInjected verifies every cnn.* binding is exposed as a
// function after injection. The file-reading bindings (classify, detect, ...)
// are checked for existence only here, mirroring how aimodel.chatWithFile is
// checked for the aimodel lib (agi.aimodel_test.go) - actually invoking them
// needs a fully wired virtual filesystem + user permission set that isn't
// modelled anywhere in this test suite.
func TestCNNFunctionsInjected(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)

	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}}
	g.injectCNNFunctions(payload)

	methods := []string{
		"classify", "detect", "segment", "pose", "oriented",
		"faceDetect", "faceLandmarks", "faceEmbedding", "faceAttributes",
		"faceCompare", "analyze", "job", "models", "health",
	}
	for _, method := range methods {
		val, err := vm.Run(`typeof cnn.` + method)
		if err != nil {
			t.Fatalf("evaluating cnn.%s: %v", method, err)
		}
		if s, _ := val.ToString(); s != "function" {
			t.Errorf("cnn.%s should be a function, got %q", method, s)
		}
	}
}

// TestCNNHealthAndModelsRoundTrip exercises the full native-func -> JSON ->
// JS-shim round trip for the file-free bindings against a mock CXNNAIO server.
func TestCNNHealthAndModelsRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/health":
			json.NewEncoder(w).Encode(map[string]any{"status": "ok", "version": "0.1.0", "models_loaded": 12, "uptime_s": 100})
		case "/v1/models":
			json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []map[string]any{{"id": "yolo11n", "object": "model", "task": "detection"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)
	sysdb.Write(cnnDBTable, "config", CNNServerConfig{Endpoint: srv.URL, TimeoutSeconds: 5})

	vm := otto.New()
	g.injectCNNFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

	val, err := vm.Run(`cnn.health().status`)
	if err != nil {
		t.Fatalf("cnn.health() errored: %v", err)
	}
	if s, _ := val.ToString(); s != "ok" {
		t.Errorf("expected status ok, got %q", s)
	}

	val, err = vm.Run(`cnn.models().data[0].id`)
	if err != nil {
		t.Fatalf("cnn.models() errored: %v", err)
	}
	if s, _ := val.ToString(); s != "yolo11n" {
		t.Errorf("expected yolo11n, got %q", s)
	}
}

// TestCNNJobPoll exercises the async job-poll binding end-to-end.
func TestCNNJobPoll(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/jobs/job-1" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"id": "job-1", "object": "job", "status": "succeeded",
			"result": map[string]any{"object": "image.detection", "data": []any{}},
		})
	}))
	defer srv.Close()

	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)
	sysdb.Write(cnnDBTable, "config", CNNServerConfig{Endpoint: srv.URL, TimeoutSeconds: 5})

	vm := otto.New()
	g.injectCNNFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

	val, err := vm.Run(`cnn.job("job-1").status`)
	if err != nil {
		t.Fatalf("cnn.job() errored: %v", err)
	}
	if s, _ := val.ToString(); s != "succeeded" {
		t.Errorf("expected succeeded, got %q", s)
	}
}

// TestCNNHealthErrorsWhenUnconfigured checks the CNNError surfaces cleanly
// when no endpoint has been saved yet.
func TestCNNHealthErrorsWhenUnconfigured(t *testing.T) {
	g := dbGateway(t)
	sysdb := g.Option.UserHandler.GetDatabase()
	sysdb.NewTable(cnnDBTable)

	vm := otto.New()
	g.injectCNNFunctions(&static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "tester"}})

	_, err := vm.Run(`cnn.health()`)
	if err == nil {
		t.Fatal("expected an error when CNN server is not configured")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Errorf("expected a 'not configured' error, got: %v", err)
	}
}
