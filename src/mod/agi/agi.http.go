package agi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	AJGI HTTP Request Library

	This is a library for allowing AGI script to make HTTP Request from the VM
	Returning either the head or the body of the request

	In addition to the classic helpers (get / post / head / download / getb64 /
	getCode / redirect), the library exposes a curl-like http.request(options)
	function that lets a script pick the method, set arbitrary request headers,
	send a raw / JSON / url-encoded form / binary (base64) body, use HTTP basic
	auth, set a timeout and control redirect following, then read back the
	status code, response headers and body of the reply.

	Author: tobychui
*/

// httpRequestOptions mirrors the JS options object passed to http.request. It
// covers the most common parameters curl supports (method, headers, request
// body in several shapes, basic auth, timeout and redirect handling).
type httpRequestOptions struct {
	URL            string            `json:"url"`            //Target URL (required)
	Method         string            `json:"method"`         //HTTP method, default GET
	Headers        map[string]string `json:"headers"`        //Request headers to set
	Body           string            `json:"body"`           //Raw text request body
	BodyBase64     string            `json:"bodyBase64"`     //Binary request body, base64 encoded
	Form           map[string]string `json:"form"`           //application/x-www-form-urlencoded body
	JSON           json.RawMessage   `json:"json"`           //JSON request body (sets Content-Type)
	ContentType    string            `json:"contentType"`    //Override the Content-Type header
	Username       string            `json:"username"`       //HTTP basic auth username
	Password       string            `json:"password"`       //HTTP basic auth password
	Timeout        float64           `json:"timeout"`        //Timeout in seconds (0 = no timeout)
	FollowRedirect *bool             `json:"followRedirect"` //Follow 3xx redirects (default true)
	ResponseType   string            `json:"responseType"`   //"text" (default) or "base64" for binary
}

// httpResponse is the object returned by http.request describing the reply.
type httpResponse struct {
	Ok         bool                `json:"ok"`         //True when the status code is in the 2xx range
	Status     int                 `json:"status"`     //HTTP status code
	StatusText string              `json:"statusText"` //HTTP status line text
	Headers    map[string][]string `json:"headers"`    //Response headers
	Body       string              `json:"body"`       //Response body (text, or base64 when responseType is "base64")
	Error      string              `json:"error"`      //Non-empty when the request could not be completed
}

func (g *Gateway) HTTPLibRegister() {
	err := g.RegisterLib("http", g.injectHTTPFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

// buildHTTPRequestBody resolves the request body and default Content-Type from
// the given options. Body precedence is: bodyBase64 > form > json > body.
func buildHTTPRequestBody(opt httpRequestOptions) (io.Reader, string, error) {
	switch {
	case opt.BodyBase64 != "":
		raw, err := base64.StdEncoding.DecodeString(opt.BodyBase64)
		if err != nil {
			return nil, "", errors.New("invalid bodyBase64: " + err.Error())
		}
		return bytes.NewReader(raw), "application/octet-stream", nil
	case len(opt.Form) > 0:
		values := url.Values{}
		for k, v := range opt.Form {
			values.Set(k, v)
		}
		return strings.NewReader(values.Encode()), "application/x-www-form-urlencoded", nil
	case len(opt.JSON) > 0:
		return bytes.NewReader(opt.JSON), "application/json", nil
	case opt.Body != "":
		return strings.NewReader(opt.Body), "", nil
	default:
		return nil, "", nil
	}
}

// doHTTPRequest builds and executes an HTTP request from the given options and
// returns a populated httpResponse. Any transport-level failure is reported via
// the Error field rather than as a Go error so scripts always get an object.
func doHTTPRequest(opt httpRequestOptions) httpResponse {
	if strings.TrimSpace(opt.URL) == "" {
		return httpResponse{Error: "missing request url"}
	}

	method := strings.ToUpper(strings.TrimSpace(opt.Method))
	if method == "" {
		method = "GET"
	}

	body, defaultContentType, err := buildHTTPRequestBody(opt)
	if err != nil {
		return httpResponse{Error: err.Error()}
	}

	req, err := http.NewRequest(method, opt.URL, body)
	if err != nil {
		return httpResponse{Error: err.Error()}
	}

	//Apply a default Content-Type for the chosen body, then let explicit
	//headers / the contentType option override it.
	if defaultContentType != "" {
		req.Header.Set("Content-Type", defaultContentType)
	}
	req.Header.Set("User-Agent", "arozos-http-client/1.1")
	for k, v := range opt.Headers {
		req.Header.Set(k, v)
	}
	if strings.TrimSpace(opt.ContentType) != "" {
		req.Header.Set("Content-Type", opt.ContentType)
	}
	if opt.Username != "" || opt.Password != "" {
		req.SetBasicAuth(opt.Username, opt.Password)
	}

	client := &http.Client{}
	if opt.Timeout > 0 {
		client.Timeout = time.Duration(opt.Timeout * float64(time.Second))
	}
	if opt.FollowRedirect != nil && !*opt.FollowRedirect {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return httpResponse{Error: err.Error()}
	}
	defer resp.Body.Close()

	bodyContent, err := io.ReadAll(resp.Body)
	if err != nil {
		return httpResponse{Error: err.Error()}
	}

	bodyString := string(bodyContent)
	if strings.ToLower(strings.TrimSpace(opt.ResponseType)) == "base64" {
		bodyString = base64.StdEncoding.EncodeToString(bodyContent)
	}

	return httpResponse{
		Ok:         resp.StatusCode >= 200 && resp.StatusCode < 300,
		Status:     resp.StatusCode,
		StatusText: resp.Status,
		Headers:    resp.Header,
		Body:       bodyString,
	}
}

func (g *Gateway) injectHTTPFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	//scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	w := payload.Writer
	//r := payload.Request

	//_http_request(optionsJSON) => response object as JSON string. This is the
	//curl-like entry point backing http.request and all method helpers.
	vm.Set("_http_request", func(call otto.FunctionCall) otto.Value {
		opt := httpRequestOptions{}
		optJSON := getOttoStringArg(call, 0)
		if s := strings.TrimSpace(optJSON); s != "" && s != "undefined" && s != "null" {
			if err := json.Unmarshal([]byte(optJSON), &opt); err != nil {
				out, _ := json.Marshal(httpResponse{Error: "invalid request options: " + err.Error()})
				rv, _ := vm.ToValue(string(out))
				return rv
			}
		}

		resp := doHTTPRequest(opt)
		out, _ := json.Marshal(resp)
		rv, _ := vm.ToValue(string(out))
		return rv
	})

	vm.Set("_http_get", func(call otto.FunctionCall) otto.Value {
		//Get URL from function variable
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}

		//Get respond of the url
		res, err := http.Get(url)
		if err != nil {
			return otto.NullValue()
		}

		bodyContent, err := io.ReadAll(res.Body)
		if err != nil {
			return otto.NullValue()
		}

		returnValue, err := vm.ToValue(string(bodyContent))
		if err != nil {
			return otto.NullValue()
		}

		return returnValue
	})

	vm.Set("_http_post", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}

		//Get JSON content from 2nd paramter
		sendWithPayload := true
		jsonContent, err := call.Argument(1).ToString()
		if err != nil {
			//Disable the payload send
			sendWithPayload = false
		}

		//Create the request
		var req *http.Request
		if sendWithPayload {
			req, _ = http.NewRequest("POST", url, bytes.NewBuffer([]byte(jsonContent)))
		} else {
			req, _ = http.NewRequest("POST", url, bytes.NewBuffer([]byte("")))
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "arozos-http-client/1.1")

		//Send the request
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
			return otto.NullValue()
		}
		defer resp.Body.Close()

		bodyContent, err := io.ReadAll(resp.Body)
		if err != nil {
			return otto.NullValue()
		}

		returnValue, _ := vm.ToValue(string(bodyContent))

		return returnValue
	})

	vm.Set("_http_head", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}

		//Request the url
		resp, err := http.Get(url)
		if err != nil {
			return otto.NullValue()
		}

		headerKey, err := call.Argument(1).ToString()
		if err != nil || headerKey == "undefined" {
			//No headkey set. Return the whole header as JSON
			js, _ := json.Marshal(resp.Header)
			returnValue, _ := vm.ToValue(string(js))
			return returnValue
		} else {
			//headerkey is set. Return if exists
			possibleValue := resp.Header.Get(headerKey)
			js, _ := json.Marshal(possibleValue)
			returnValue, _ := vm.ToValue(string(js))
			return returnValue
		}

	})

	//Get target status code for response
	vm.Set("_http_code", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		payload := ""
		client := new(http.Client)
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			//Redirection. Return the target location as well
			dest, _ := req.Response.Location()
			payload = dest.String()
			return errors.New("Redirect")
		}

		response, err := client.Do(req)
		if err != nil {
			return otto.FalseValue()
		}
		defer client.CloseIdleConnections()
		vm.Run(`var _location = "` + payload + `";`)
		value, _ := otto.ToValue(response.StatusCode)
		return value

	})

	vm.Set("_http_download", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		downloadURL, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		decodedURL, _ := url.QueryUnescape(downloadURL)

		//Get download desintation from paramter
		vpath, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		//Optional: filename paramter
		filename, err := call.Argument(2).ToString()
		if err != nil || filename == "undefined" {
			//Extract the filename from the url instead
			filename = filepath.Base(decodedURL)
		}

		//Check user acess permission
		if !u.CanWrite(vpath) {
			g.RaiseError(errors.New("Permission Denied"))
			return otto.FalseValue()
		}

		//Convert the vpath to realpath. Check if it exists
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			return otto.FalseValue()
		}

		if !fsh.FileSystemAbstraction.FileExists(rpath) || !fsh.FileSystemAbstraction.IsDir(rpath) {
			g.RaiseError(errors.New(vpath + " is a file not a directory."))
			return otto.FalseValue()
		}

		downloadDest := filepath.Join(rpath, filename)

		//Ok. Download the file
		resp, err := http.Get(decodedURL)
		if err != nil {
			return otto.FalseValue()
		}
		defer resp.Body.Close()

		// Create the file
		err = fsh.FileSystemAbstraction.WriteStream(downloadDest, resp.Body, 0775)
		if err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	vm.Set("_http_getb64", func(call otto.FunctionCall) otto.Value {
		//Get URL from function variable and return bytes as base64
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}

		//Get respond of the url
		res, err := http.Get(url)
		if err != nil {
			return otto.NullValue()
		}

		bodyContent, err := io.ReadAll(res.Body)
		if err != nil {
			return otto.NullValue()
		}

		sEnc := base64.StdEncoding.EncodeToString(bodyContent)

		r, err := otto.ToValue(string(sEnc))
		if err != nil {
			logger.PrintAndLog("Agi", err.Error(), nil)
			return otto.NullValue()
		}
		return r
	})

	vm.Set("_http_redirect", func(call otto.FunctionCall) otto.Value {
		//Redirect the current request to another url
		targetUrl, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}

		statusCode, err := call.Argument(1).ToInteger()
		if err != nil {
			//Default: Temporary redirect
			statusCode = 307
		}

		w.Header().Set("Location", targetUrl)
		w.WriteHeader(int(statusCode))
		return otto.TrueValue()
	})

	//Wrap all the native code function into an http class
	vm.Run(`
		var http = {};

		//http.request(options) => response object {ok, status, statusText, headers, body, error}
		//options: {url, method, headers, body, bodyBase64, form, json, contentType,
		//          username, password, timeout, followRedirect, responseType}
		http.request = function(options){
			return JSON.parse(_http_request(JSON.stringify(options || {})));
		};

		//Classic helpers. http.get / http.post now accept optional headers.
		http.get = function(url, headers){
			if (typeof headers == "undefined"){
				//Backward-compatible fast path: returns body string (or null on error)
				return _http_get(url);
			}
			return http.request({url: url, method: "GET", headers: headers}).body;
		};
		http.post = function(url, body, headers, contentType){
			if (typeof headers == "undefined" && typeof contentType == "undefined"){
				//Backward-compatible fast path: JSON body, returns body string
				return _http_post(url, body);
			}
			return http.request({
				url: url, method: "POST", body: body,
				headers: headers, contentType: contentType
			}).body;
		};

		//Method + body-shape convenience helpers built on http.request.
		http.put = function(url, body, headers, contentType){
			return http.request({url: url, method: "PUT", body: body, headers: headers, contentType: contentType});
		};
		http.patch = function(url, body, headers, contentType){
			return http.request({url: url, method: "PATCH", body: body, headers: headers, contentType: contentType});
		};
		http.delete = function(url, headers){
			return http.request({url: url, method: "DELETE", headers: headers});
		};
		http.postForm = function(url, form, headers){
			return http.request({url: url, method: "POST", form: form, headers: headers});
		};
		http.postJSON = function(url, obj, headers){
			return http.request({url: url, method: "POST", json: obj, headers: headers});
		};

		http.head = _http_head;
		http.download = _http_download;
		http.getb64 = _http_getb64;
		http.getCode = _http_code;
		http.redirect = function(t, c){
			if (typeof(c) == "undefined"){
				c = 307;
			}
			_http_redirect(t,c);
		};
	`)

}
