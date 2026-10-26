package agi

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/agi/static"
	cnn "imuslab.com/arozos/mod/aiservers/cnn"
	"imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI CNN Inference Library

	This library lets AGI scripts run image classification, object detection,
	segmentation, pose, oriented (OBB) detection and face analysis (detection,
	landmarks, embedding, comparison, attributes) against an external CXNNAIO
	vision-inference server. The transport/wire-format logic lives in the
	standalone mod/aiservers/cnn client package; this file only owns the
	ArozOS-specific bits: admin-configured connection settings (System
	Settings > AI Integration > CNN Inference) and the Otto VM bindings.

	Author: tobychui (AGI), CNN Inference lib addition
*/

const (
	//cnnDBTable is the system database table used to persist the CNN server
	//connection settings.
	cnnDBTable = "cnnserver"

	//cnnTokenMask is the sentinel value the frontend submits when the token
	//field was left untouched. When received, the stored token is kept.
	cnnTokenMask = "********"

	//cnnDefaultTimeoutSeconds is used when no timeout has been configured.
	cnnDefaultTimeoutSeconds = 60
)

// CNNServerConfig holds the admin-configured connection settings for the
// external CXNNAIO vision-inference server.
type CNNServerConfig struct {
	Endpoint       string `json:"endpoint"`       //Base URL, e.g. http://localhost:8080
	Token          string `json:"token"`          //Bearer token; empty for a server running in no_auth mode
	TimeoutSeconds int    `json:"timeoutSeconds"` //Per-request client timeout
}

// ── Library registration ─────────────────────────────────────────────────────

func (g *Gateway) CNNLibRegister() {
	//Make sure the storage table exists before any read / write happens.
	sysdb := g.Option.UserHandler.GetDatabase()
	if !sysdb.TableExists(cnnDBTable) {
		sysdb.NewTable(cnnDBTable)
	}

	err := g.RegisterLib("cnn", g.injectCNNFunctions)
	if err != nil {
		agiLogger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectCNNFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	//cnn.classify(file, options) => image.classification envelope
	vm.Set("_cnn_classify", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Classify(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.detect(file, options) => image.detection envelope
	vm.Set("_cnn_detect", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Detect(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.segment(file, options) => image.segmentation envelope
	vm.Set("_cnn_segment", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Segment(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.pose(file, options) => image.pose envelope
	vm.Set("_cnn_pose", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Pose(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.oriented(file, options) => image.oriented envelope
	vm.Set("_cnn_oriented", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Oriented(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.faceDetect(file, options) => face.detection envelope
	vm.Set("_cnn_faceDetect", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.FaceDetect(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.faceLandmarks(file, options) => face.landmarks envelope
	vm.Set("_cnn_faceLandmarks", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.FaceLandmarks(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.faceEmbedding(file, options) => face.embedding envelope
	vm.Set("_cnn_faceEmbedding", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.FaceEmbedding(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.faceAttributes(file, options) => face.gender envelope (see FaceAttributes doc)
	vm.Set("_cnn_faceAttributes", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNOptions(getOttoStringArg(call, 1))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.FaceAttributes(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.faceCompare(fileA, fileB, options) => face.comparison object (no async support)
	vm.Set("_cnn_faceCompare", func(call otto.FunctionCall) otto.Value {
		dataA, mimeA, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		dataB, mimeB, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 1))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		opt := parseCNNComparisonOptions(getOttoStringArg(call, 2))
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, err := client.FaceCompare(dataA, dataB, mimeA, mimeB, opt)
		return cnnRespond(vm, result, nil, err)
	})

	//cnn.analyze(file, tasks, options) => vision.analysis envelope
	//options may carry top-level "render"/"async" flags plus a per-task
	//options block keyed by task name (e.g. { detect: {...}, render: true }).
	vm.Set("_cnn_analyze", func(call otto.FunctionCall) otto.Value {
		data, mimeType, err := g.cnnReadImage(scriptFsh, vm, u, getOttoStringArg(call, 0))
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}

		var tasks []string
		if err := json.Unmarshal([]byte(getOttoStringArg(call, 1)), &tasks); err != nil || len(tasks) == 0 {
			panic(vm.MakeCustomError("CNNError", "no tasks specified"))
		}

		raw := map[string]json.RawMessage{}
		json.Unmarshal([]byte(getOttoStringArg(call, 2)), &raw)
		opt := cnn.AnalyzeOptions{Tasks: tasks, Options: map[string]json.RawMessage{}}
		for k, v := range raw {
			switch k {
			case "render":
				json.Unmarshal(v, &opt.Render)
			case "async":
				json.Unmarshal(v, &opt.Async)
			default:
				opt.Options[k] = v
			}
		}

		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		result, job, err := client.Analyze(data, mimeType, opt)
		return cnnRespond(vm, result, job, err)
	})

	//cnn.job(id) => poll an async job submitted with options.async = true
	vm.Set("_cnn_job", func(call otto.FunctionCall) otto.Value {
		id, _ := call.Argument(0).ToString()
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		job, err := client.GetJob(id)
		return cnnRespond(vm, job, nil, err)
	})

	//cnn.models() => live model registry from the configured server
	vm.Set("_cnn_models", func(call otto.FunctionCall) otto.Value {
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		models, err := client.ListModels()
		return cnnRespond(vm, models, nil, err)
	})

	//cnn.health() => live health/status from the configured server
	vm.Set("_cnn_health", func(call otto.FunctionCall) otto.Value {
		client, err := g.cnnClient()
		if err != nil {
			panic(vm.MakeCustomError("CNNError", err.Error()))
		}
		health, err := client.Health()
		return cnnRespond(vm, health, nil, err)
	})

	//Wrap the native functions into a clean cnn class
	vm.Run(`
		var cnn = {};
		cnn.classify = function(file, options){
			return JSON.parse(_cnn_classify(file, JSON.stringify(options || {})));
		};
		cnn.detect = function(file, options){
			return JSON.parse(_cnn_detect(file, JSON.stringify(options || {})));
		};
		cnn.segment = function(file, options){
			return JSON.parse(_cnn_segment(file, JSON.stringify(options || {})));
		};
		cnn.pose = function(file, options){
			return JSON.parse(_cnn_pose(file, JSON.stringify(options || {})));
		};
		cnn.oriented = function(file, options){
			return JSON.parse(_cnn_oriented(file, JSON.stringify(options || {})));
		};
		cnn.faceDetect = function(file, options){
			return JSON.parse(_cnn_faceDetect(file, JSON.stringify(options || {})));
		};
		cnn.faceLandmarks = function(file, options){
			return JSON.parse(_cnn_faceLandmarks(file, JSON.stringify(options || {})));
		};
		cnn.faceEmbedding = function(file, options){
			return JSON.parse(_cnn_faceEmbedding(file, JSON.stringify(options || {})));
		};
		cnn.faceAttributes = function(file, options){
			return JSON.parse(_cnn_faceAttributes(file, JSON.stringify(options || {})));
		};
		cnn.faceCompare = function(fileA, fileB, options){
			return JSON.parse(_cnn_faceCompare(fileA, fileB, JSON.stringify(options || {})));
		};
		cnn.analyze = function(file, tasks, options){
			return JSON.parse(_cnn_analyze(file, JSON.stringify(tasks || []), JSON.stringify(options || {})));
		};
		cnn.job = function(id){
			return JSON.parse(_cnn_job(id));
		};
		cnn.models = function(){
			return JSON.parse(_cnn_models());
		};
		cnn.health = function(){
			return JSON.parse(_cnn_health());
		};
	`)
}

// ── Core helpers ──────────────────────────────────────────────────────────────

// cnnClient builds a cnn.Client from the persisted configuration.
func (g *Gateway) cnnClient() (*cnn.Client, error) {
	cfg := g.getCNNConfig()
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, errors.New("CNN inference server is not configured (System Settings > AI Integration > CNN Inference)")
	}
	return cnn.NewClient(cfg.Endpoint, cfg.Token, time.Duration(cfg.TimeoutSeconds)*time.Second), nil
}

// cnnReadImage resolves a script vpath to its raw bytes and a best-effort
// mime type, enforcing the calling user's read permission.
func (g *Gateway) cnnReadImage(scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, u *user.User, vpath string) ([]byte, string, error) {
	//Resolve relative paths against the script's directory
	vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

	if !u.CanRead(vpath) {
		return nil, "", errors.New("permission denied: " + vpath)
	}

	fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
	if err != nil {
		return nil, "", err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		return nil, "", errors.New("file not found: " + vpath)
	}

	content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
	if err != nil {
		return nil, "", err
	}

	ext := strings.ToLower(filepath.Ext(rpath))
	if !cnnIsImageExt(ext) {
		return nil, "", errors.New("unsupported file type for CNN inference: " + filepath.Base(rpath) + " (expected an image)")
	}
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "image/" + strings.TrimPrefix(ext, ".")
	}
	return content, mimeType, nil
}

// cnnRespond converts a client call's (result, job, err) trio into the otto
// value returned to the script: an error panics, an async submission returns
// the job object, otherwise the typed result is marshalled back as-is so the
// script receives the exact server envelope shape.
func cnnRespond(vm *otto.Otto, result interface{}, job *cnn.Job, err error) otto.Value {
	if err != nil {
		panic(vm.MakeCustomError("CNNError", err.Error()))
	}
	var out []byte
	if job != nil {
		out, _ = json.Marshal(job)
	} else {
		out, _ = json.Marshal(result)
	}
	reply, _ := vm.ToValue(string(out))
	return reply
}

func cnnIsImageExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}

func parseCNNOptions(s string) cnn.RequestOptions {
	opt := cnn.RequestOptions{}
	s = strings.TrimSpace(s)
	if s == "" || s == "undefined" || s == "null" {
		return opt
	}
	json.Unmarshal([]byte(s), &opt)
	return opt
}

func parseCNNComparisonOptions(s string) cnn.ComparisonOptions {
	opt := cnn.ComparisonOptions{}
	s = strings.TrimSpace(s)
	if s == "" || s == "undefined" || s == "null" {
		return opt
	}
	json.Unmarshal([]byte(s), &opt)
	return opt
}

// ── Persistence helpers ───────────────────────────────────────────────────────

func (g *Gateway) getCNNConfig() CNNServerConfig {
	cfg := CNNServerConfig{TimeoutSeconds: cnnDefaultTimeoutSeconds}
	sysdb := g.Option.UserHandler.GetDatabase()
	if sysdb.KeyExists(cnnDBTable, "config") {
		sysdb.Read(cnnDBTable, "config", &cfg)
		if cfg.TimeoutSeconds <= 0 {
			cfg.TimeoutSeconds = cnnDefaultTimeoutSeconds
		}
	}
	return cfg
}

func cnnMaskToken(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 4 {
		return strings.Repeat("•", len(token))
	}
	return "••••" + token[len(token)-4:]
}

// ── HTTP handlers (System Settings) ──────────────────────────────────────────

// HandleCNNConfig serves GET (masked config) and POST (save config).
// GET  /system/cnn/config
// POST /system/cnn/config  (endpoint, timeoutSeconds, token, cleartoken)
func (g *Gateway) HandleCNNConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		cfg := g.getCNNConfig()
		js, _ := json.Marshal(map[string]interface{}{
			"endpoint":       cfg.Endpoint,
			"timeoutSeconds": cfg.TimeoutSeconds,
			"hasToken":       cfg.Token != "",
			"tokenHint":      cnnMaskToken(cfg.Token),
		})
		utils.SendJSONResponse(w, string(js))
		return
	}

	//POST - save. Read raw form values so an empty endpoint can intentionally
	//clear the configuration.
	r.ParseForm()
	cfg := g.getCNNConfig()
	cfg.Endpoint = strings.TrimSpace(r.Form.Get("endpoint"))
	if t, err := strconv.Atoi(strings.TrimSpace(r.Form.Get("timeoutSeconds"))); err == nil && t > 0 {
		cfg.TimeoutSeconds = t
	}

	//Token: only overwrite when a new, non-sentinel value is supplied.
	if clear, _ := utils.PostBool(r, "cleartoken"); clear {
		cfg.Token = ""
	} else if token := r.Form.Get("token"); token != "" && token != cnnTokenMask {
		cfg.Token = token
	}

	sysdb := g.Option.UserHandler.GetDatabase()
	if err := sysdb.Write(cnnDBTable, "config", cfg); err != nil {
		utils.SendErrorResponse(w, "failed to save config: "+err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleCNNTest performs a connectivity check against the CXNNAIO server:
// health status plus the live model registry. Accepts optional unsaved
// endpoint/token overrides so the admin can test before saving.
// POST /system/cnn/test
func (g *Gateway) HandleCNNTest(w http.ResponseWriter, r *http.Request) {
	cfg := g.getCNNConfig()
	endpoint := cfg.Endpoint
	token := cfg.Token
	timeoutSeconds := cfg.TimeoutSeconds
	if ep := strings.TrimSpace(r.FormValue("endpoint")); ep != "" {
		endpoint = ep
	}
	if tk := r.FormValue("token"); tk != "" && tk != cnnTokenMask {
		token = tk
	}

	if strings.TrimSpace(endpoint) == "" {
		utils.SendErrorResponse(w, "endpoint not configured")
		return
	}

	client := cnn.NewClient(endpoint, token, time.Duration(timeoutSeconds)*time.Second)
	health, err := client.Health()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	models, err := client.ListModels()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	out, _ := json.Marshal(map[string]interface{}{
		"ok":           true,
		"status":       health.Status,
		"version":      health.Version,
		"modelsLoaded": health.ModelsLoaded,
		"sessions":     health.Sessions,
		"uptimeS":      health.UptimeS,
		"modelCount":   len(models.Data),
		"models":       models.Data,
	})
	utils.SendJSONResponse(w, string(out))
}
