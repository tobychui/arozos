package agi

import (
	"io/ioutil"
	"net/http"

	"github.com/robertkrimen/otto"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	AGI Serverless Request Handler

	This script allow AGI script to access raw GET / POST parameters for serverless applications
	Author: tobychui
*/

func (g *Gateway) injectServerlessFunctions(vm *otto.Otto, scriptFile string, scriptScope string, u *user.User, r *http.Request) {
	vm.Set("REQ_METHOD", r.Method)
	vm.Set("getPara", func(call otto.FunctionCall) otto.Value {
		key, _ := call.Argument(0).ToString()
		if key == "" {
			return otto.NullValue()
		}
		value, err := utils.GetPara(r, key)
		if err != nil {
			return otto.NullValue()
		}

		r, err := vm.ToValue(value)
		if err != nil {
			return otto.NullValue()
		}

		return r
	})
	vm.Set("postPara", func(call otto.FunctionCall) otto.Value {
		key, _ := call.Argument(0).ToString()
		if key == "" {
			return otto.NullValue()
		}
		value, err := utils.PostPara(r, key)
		if err != nil {
			return otto.NullValue()
		}

		r, err := vm.ToValue(value)
		if err != nil {
			return otto.NullValue()
		}

		return r
	})
	vm.Set("readBody", func(call otto.FunctionCall) otto.Value {
		if r.Body == nil {
			return otto.NullValue()
		}

		bodyContent, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return otto.NullValue()
		}
		r, err := vm.ToValue(string(bodyContent))
		if err != nil {
			return otto.NullValue()
		}
		return r
	})
}
