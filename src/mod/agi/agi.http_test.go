package agi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

// ─── body builder ────────────────────────────────────────────────────────────

func TestBuildHTTPRequestBody(t *testing.T) {
	//bodyBase64 takes precedence and decodes to raw bytes
	t.Run("base64", func(t *testing.T) {
		raw := []byte{0x00, 0x01, 0x02, 0xff}
		opt := httpRequestOptions{BodyBase64: base64.StdEncoding.EncodeToString(raw)}
		r, ct, err := buildHTTPRequestBody(opt)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ct != "application/octet-stream" {
			t.Errorf("unexpected content-type: %q", ct)
		}
		got, _ := io.ReadAll(r)
		if string(got) != string(raw) {
			t.Errorf("binary body not decoded correctly: %v", got)
		}
	})

	t.Run("invalid base64", func(t *testing.T) {
		_, _, err := buildHTTPRequestBody(httpRequestOptions{BodyBase64: "!!!not base64!!!"})
		if err == nil {
			t.Error("expected error for invalid base64 body")
		}
	})

	t.Run("form", func(t *testing.T) {
		opt := httpRequestOptions{Form: map[string]string{"a": "1", "b": "hello world"}}
		r, ct, err := buildHTTPRequestBody(opt)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ct != "application/x-www-form-urlencoded" {
			t.Errorf("unexpected content-type: %q", ct)
		}
		got, _ := io.ReadAll(r)
		values, _ := url.ParseQuery(string(got))
		if values.Get("a") != "1" || values.Get("b") != "hello world" {
			t.Errorf("form not encoded correctly: %q", string(got))
		}
	})

	t.Run("json", func(t *testing.T) {
		opt := httpRequestOptions{JSON: json.RawMessage(`{"x":1}`)}
		r, ct, err := buildHTTPRequestBody(opt)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ct != "application/json" {
			t.Errorf("unexpected content-type: %q", ct)
		}
		got, _ := io.ReadAll(r)
		if strings.TrimSpace(string(got)) != `{"x":1}` {
			t.Errorf("json body mismatch: %q", string(got))
		}
	})

	t.Run("raw", func(t *testing.T) {
		opt := httpRequestOptions{Body: "plain text"}
		r, ct, err := buildHTTPRequestBody(opt)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ct != "" {
			t.Errorf("raw body should carry no default content-type, got %q", ct)
		}
		got, _ := io.ReadAll(r)
		if string(got) != "plain text" {
			t.Errorf("raw body mismatch: %q", string(got))
		}
	})

	t.Run("empty", func(t *testing.T) {
		r, ct, err := buildHTTPRequestBody(httpRequestOptions{})
		if err != nil || r != nil || ct != "" {
			t.Errorf("empty options should yield no body, got r=%v ct=%q err=%v", r, ct, err)
		}
	})
}

// ─── request execution ───────────────────────────────────────────────────────

func TestDoHTTPRequestMethodHeadersAndBody(t *testing.T) {
	var gotMethod, gotHeader, gotBody, gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotHeader = r.Header.Get("X-Custom")
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("X-Reply", "pong")
		w.WriteHeader(201)
		io.WriteString(w, "created")
	}))
	defer srv.Close()

	resp := doHTTPRequest(httpRequestOptions{
		URL:     srv.URL,
		Method:  "put",
		Headers: map[string]string{"X-Custom": "yes"},
		Body:    "the payload",
	})

	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	if gotMethod != "PUT" {
		t.Errorf("method not applied/uppercased, got %q", gotMethod)
	}
	if gotHeader != "yes" {
		t.Errorf("custom header not sent, got %q", gotHeader)
	}
	if gotBody != "the payload" {
		t.Errorf("body not sent, got %q", gotBody)
	}
	if gotContentType != "" {
		t.Errorf("raw body should not set a content-type, got %q", gotContentType)
	}
	if resp.Status != 201 || !resp.Ok {
		t.Errorf("status/ok mismatch: status=%d ok=%v", resp.Status, resp.Ok)
	}
	if resp.Body != "created" {
		t.Errorf("response body mismatch: %q", resp.Body)
	}
	if len(resp.Headers["X-Reply"]) == 0 || resp.Headers["X-Reply"][0] != "pong" {
		t.Errorf("response headers not captured: %v", resp.Headers)
	}
}

func TestDoHTTPRequestFormAndContentTypeOverride(t *testing.T) {
	var gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		io.WriteString(w, "ok")
	}))
	defer srv.Close()

	//Form body sets the urlencoded content type by default.
	resp := doHTTPRequest(httpRequestOptions{URL: srv.URL, Method: "POST", Form: map[string]string{"k": "v"}})
	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	if gotContentType != "application/x-www-form-urlencoded" {
		t.Errorf("form content-type not defaulted, got %q", gotContentType)
	}
	if values, _ := url.ParseQuery(gotBody); values.Get("k") != "v" {
		t.Errorf("form body mismatch: %q", gotBody)
	}

	//Explicit contentType option overrides the default.
	doHTTPRequest(httpRequestOptions{URL: srv.URL, Method: "POST", Body: "x", ContentType: "text/csv"})
	if gotContentType != "text/csv" {
		t.Errorf("contentType override not applied, got %q", gotContentType)
	}
}

func TestDoHTTPRequestBinaryResponse(t *testing.T) {
	raw := []byte{0x10, 0x20, 0x30, 0xff, 0x00}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(raw)
	}))
	defer srv.Close()

	resp := doHTTPRequest(httpRequestOptions{URL: srv.URL, ResponseType: "base64"})
	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	decoded, err := base64.StdEncoding.DecodeString(resp.Body)
	if err != nil {
		t.Fatalf("response body was not valid base64: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Errorf("binary response mismatch: %v", decoded)
	}
}

func TestDoHTTPRequestBasicAuth(t *testing.T) {
	var gotUser, gotPass string
	var ok bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPass, ok = r.BasicAuth()
		io.WriteString(w, "ok")
	}))
	defer srv.Close()

	doHTTPRequest(httpRequestOptions{URL: srv.URL, Username: "alice", Password: "s3cr3t"})
	if !ok || gotUser != "alice" || gotPass != "s3cr3t" {
		t.Errorf("basic auth not applied: user=%q pass=%q ok=%v", gotUser, gotPass, ok)
	}
}

func TestDoHTTPRequestNoFollowRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/dest", http.StatusFound)
			return
		}
		io.WriteString(w, "final")
	}))
	defer srv.Close()

	follow := false
	resp := doHTTPRequest(httpRequestOptions{URL: srv.URL + "/start", FollowRedirect: &follow})
	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	if resp.Status != http.StatusFound {
		t.Errorf("expected 302 when not following redirect, got %d", resp.Status)
	}
	if len(resp.Headers["Location"]) == 0 || !strings.HasSuffix(resp.Headers["Location"][0], "/dest") {
		t.Errorf("expected Location header, got %v", resp.Headers)
	}
}

func TestDoHTTPRequestMissingURL(t *testing.T) {
	resp := doHTTPRequest(httpRequestOptions{})
	if resp.Error == "" {
		t.Error("expected an error when url is missing")
	}
}

// ─── JS object exposure ─────────────────────────────────────────────────────

func TestInjectHTTPLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "alice"}}
	g.injectHTTPFunctions(payload)

	for _, method := range []string{"request", "get", "post", "put", "patch", "delete", "postForm", "postJSON", "head", "download", "getb64", "getCode", "redirect"} {
		val, err := vm.Run(`typeof http.` + method)
		if err != nil {
			t.Fatalf("evaluating http.%s: %v", method, err)
		}
		s, _ := val.ToString()
		if s != "function" {
			t.Errorf("http.%s should be a function, got %q", method, s)
		}
	}
}

func TestHTTPRequestFromVM(t *testing.T) {
	var gotMethod, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		io.WriteString(w, "hello vm")
	}))
	defer srv.Close()

	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{VM: vm, User: &user.User{Username: "alice"}}
	g.injectHTTPFunctions(payload)

	val, err := vm.Run(`
		var resp = http.request({url: "` + srv.URL + `", method: "POST", body: "vm-body"});
		resp.status + "|" + resp.ok + "|" + resp.body;
	`)
	if err != nil {
		t.Fatalf("vm run error: %v", err)
	}
	out, _ := val.ToString()
	if out != "200|true|hello vm" {
		t.Errorf("unexpected VM response object: %q", out)
	}
	if gotMethod != "POST" || gotBody != "vm-body" {
		t.Errorf("request not sent as expected: method=%q body=%q", gotMethod, gotBody)
	}
}
