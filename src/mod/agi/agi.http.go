package agi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
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

func (g *Gateway) injectHTTPFunctions(vm *otto.Otto, u *user.User) {
	vm.Set("_http_get", func(call otto.FunctionCall) otto.Value {
		//Get URL from function variable
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NaNValue()
		}

		//Get respond of the url
		res, err := http.Get(url)
		if err != nil {
			return otto.NaNValue()
		}

		bodyContent, err := ioutil.ReadAll(res.Body)
		if err != nil {
			return otto.NaNValue()
		}

		returnValue, err := vm.ToValue(string(bodyContent))
		if err != nil {
			return otto.NaNValue()
		}

		return returnValue
	})

	vm.Set("_http_post", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NaNValue()
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

		//Send the request
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			log.Println(err)
			return otto.NaNValue()
		}
		defer resp.Body.Close()

		bodyContent, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return otto.NaNValue()
		}

		returnValue, _ := vm.ToValue(string(bodyContent))

		return returnValue
	})

	vm.Set("_http_head", func(call otto.FunctionCall) otto.Value {
		//Get URL from function paramter
		url, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NaNValue()
		}

		//Request the url
		resp, err := http.Get(url)
		if err != nil {
			return otto.NaNValue()
		}

		headerKey, err := call.Argument(1).ToString()
		if err != nil || headerKey == "undefined" {
			//No headkey set. Return the whole header as JSON
			js, _ := json.Marshal(resp.Header)
			log.Println(resp.Header)
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
		rpath, err := u.VirtualPathToRealPath(vpath)
		if err != nil {
			return otto.FalseValue()
		}

		if !fileExists(rpath) || !IsDir(rpath) {
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
		out, err := os.Create(downloadDest)
		if err != nil {
			return otto.FalseValue()
		}
		defer out.Close()

		// Write the body to file
		_, err = io.Copy(out, resp.Body)
		return otto.TrueValue()
	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var http = {};
		http.get = _http_get;
		http.post = _http_post;
		http.head = _http_head;
		http.download = _http_download;
	`)

}
