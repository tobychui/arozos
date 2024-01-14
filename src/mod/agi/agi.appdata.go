package agi

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
)

/*
	AGI Appdata Access Library
	Author: tobychui

	This library allow agi script to access files located in the web root
	*This library provide READ ONLY function*
	You cannot write to web folder due to security reasons. If you need to read write
	web root (which is not recommended), ask the user to mount it top web:/ manually
*/

var webRoot string = "./web" //The web folder root

func (g *Gateway) AppdataLibRegister() {
	err := g.RegisterLib("appdata", g.injectAppdataLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectAppdataLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	//u := payload.User
	//scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request
	vm.Set("_appdata_readfile", func(call otto.FunctionCall) otto.Value {
		relpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Check if this is path escape
		escaped, err := static.CheckRootEscape(webRoot, filepath.Join(webRoot, relpath))
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		if escaped {
			g.RaiseError(errors.New("Path escape detected"))
			return otto.FalseValue()
		}

		//Check if file exists
		targetFile := filepath.Join(webRoot, relpath)
		if utils.FileExists(targetFile) && !filesystem.IsDir(targetFile) {
			content, err := os.ReadFile(targetFile)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}

			//OK. Return the content of the file
			result, _ := vm.ToValue(string(content))
			return result
		} else if filesystem.IsDir(targetFile) {
			g.RaiseError(errors.New("Cannot read from directory"))
			return otto.FalseValue()

		} else {
			g.RaiseError(errors.New("File not exists"))
			return otto.FalseValue()
		}
	})

	vm.Set("_appdata_listdir", func(call otto.FunctionCall) otto.Value {
		relpath, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Check if this is path escape
		escaped, err := static.CheckRootEscape(webRoot, filepath.Join(webRoot, relpath))
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		if escaped {
			g.RaiseError(errors.New("Path escape detected"))
			return otto.FalseValue()
		}

		//Check if file exists
		targetFolder := filepath.Join(webRoot, relpath)
		if utils.FileExists(targetFolder) && filesystem.IsDir(targetFolder) {
			//Glob the directory for filelist
			files, err := filepath.Glob(filepath.ToSlash(filepath.Clean(targetFolder)) + "/*")
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}

			results := []string{}
			for _, file := range files {
				rel, _ := filepath.Rel(webRoot, file)
				rel = filepath.ToSlash(rel)
				results = append(results, rel)
			}

			js, _ := json.Marshal(results)

			//OK. Return the content of the file
			result, _ := vm.ToValue(string(js))
			return result

		} else {
			g.RaiseError(errors.New("Directory not exists"))
			return otto.FalseValue()
		}
	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var appdata = {};
		appdata.readFile = _appdata_readfile;
		appdata.listDir = _appdata_listdir;
	`)
}
