package agi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
)

/*
	AJGI HTTP Request Library

	This is a library for allowing AGI script to make HTTP Request from the VM
	Returning either the head or the body of the request

	Author: tobychui
*/

func (g *Gateway) HTTPLibRegister() {
	err := g.RegisterLib("http", g.injectHTTPFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectHTTPFunctions(vm *otto.Otto, u *user.User, scriptFsh *filesystem.FileSystemHandler, scriptPath string) {
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
			log.Println(err)
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
			g.raiseError(err)
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
			g.raiseError(errors.New("Permission Denied"))
			return otto.FalseValue()
		}

		//Convert the vpath to realpath. Check if it exists
		fsh, rpath, err := virtualPathToRealPath(vpath, u)
		if err != nil {
			return otto.FalseValue()
		}

		if !fsh.FileSystemAbstraction.FileExists(rpath) || !fsh.FileSystemAbstraction.IsDir(rpath) {
			g.raiseError(errors.New(vpath + " is a file not a directory."))
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
			log.Println(err.Error())
			return otto.NullValue()
		}
		return r
	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var http = {};
		http.get = _http_get;
		http.post = _http_post;
		http.head = _http_head;
		http.download = _http_download;
		http.getb64 = _http_getb64;
		http.getCode = _http_code;
	`)

}
