package agi

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/robertkrimen/otto"
)

//Inject aroz online custom functions into the virtual machine
func (g *Gateway) injectStandardLibs(vm *otto.Otto, scriptFile string, scriptScope string) {
	//Define system core modules and definations
	sysdb := g.Option.UserHandler.GetDatabase()

	//Define VM global variables
	vm.Set("BUILD_VERSION", g.Option.BuildVersion)
	vm.Set("INTERNAL_VERSION", g.Option.InternalVersion)
	vm.Set("LOADED_MODULES", g.Option.LoadedModule)
	vm.Set("LOADED_STORAGES", g.Option.UserHandler.GetStoragePool())
	vm.Set("__FILE__", scriptFile)
	vm.Set("HTTP_RESP", "")
	vm.Set("HTTP_HEADER", "text/plain")

	//Response related
	vm.Set("sendResp", func(call otto.FunctionCall) otto.Value {
		argString, _ := call.Argument(0).ToString()
		vm.Set("HTTP_RESP", argString)
		return otto.Value{}
	})

	vm.Set("echo", func(call otto.FunctionCall) otto.Value {
		argString, _ := call.Argument(0).ToString()
		currentResp, err := vm.Get("HTTP_RESP")
		if err != nil {
			vm.Set("HTTP_RESP", argString)
		} else {
			currentRespText, err := currentResp.ToString()
			if err != nil {
				//Unable to parse this as string. Overwrite response
				vm.Set("HTTP_RESP", argString)
			}
			vm.Set("HTTP_RESP", currentRespText+argString)
		}

		return otto.Value{}
	})

	vm.Set("sendOK", func(call otto.FunctionCall) otto.Value {
		vm.Set("HTTP_RESP", "ok")
		return otto.Value{}
	})

	vm.Set("_sendJSONResp", func(call otto.FunctionCall) otto.Value {
		argString, _ := call.Argument(0).ToString()
		vm.Set("HTTP_HEADER", "application/json")
		vm.Set("HTTP_RESP", argString)
		return otto.Value{}
	})

	vm.Run(`
		sendJSONResp = function(object){
			if (typeof(object) === "object"){
				_sendJSONResp(JSON.stringify(object));
			}else{
				_sendJSONResp(object);
			}
		}
	`)

	vm.Set("addNightlyTask", func(call otto.FunctionCall) otto.Value {
		scriptPath, _ := call.Argument(0).ToString() //From web directory
		if isValidAGIScript(scriptPath) {
			g.NightlyScripts = append(g.NightlyScripts, scriptPath)
		} else {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Database related
	//newDBTableIfNotExists(tableName)
	vm.Set("newDBTableIfNotExists", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Create the table with given tableName
		if g.filterDBTable(tableName, false) {
			sysdb.NewTable(tableName)
			//Return true
			reply, _ := vm.ToValue(true)
			return reply
		}
		reply, _ := vm.ToValue(false)
		return reply
	})

	vm.Set("DBTableExists", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Create the table with given tableName
		if sysdb.TableExists(tableName) {
			return otto.TrueValue()
		}

		return otto.FalseValue()
	})

	//dropDBTable(tablename)
	vm.Set("dropDBTable", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Create the table with given tableName
		if g.filterDBTable(tableName, true) {
			sysdb.DropTable(tableName)
			reply, _ := vm.ToValue(true)
			return reply
		}

		//Return true
		reply, _ := vm.ToValue(false)
		return reply
	})

	//writeDBItem(tablename, key, value) => return true when suceed
	vm.Set("writeDBItem", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if the tablename is reserved
		if g.filterDBTable(tableName, true) {
			keyString, err := call.Argument(1).ToString()
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			valueString, err := call.Argument(2).ToString()
			if err != nil {
				g.raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			sysdb.Write(tableName, keyString, valueString)
			reply, _ := vm.ToValue(true)
			return reply
		}

		reply, _ := vm.ToValue(false)
		return reply

	})

	//readDBItem(tablename, key) => return value
	vm.Set("readDBItem", func(call otto.FunctionCall) otto.Value {
		tableName, _ := call.Argument(0).ToString()
		keyString, _ := call.Argument(1).ToString()
		returnValue := ""
		reply, _ := vm.ToValue(nil)
		if g.filterDBTable(tableName, true) {
			sysdb.Read(tableName, keyString, &returnValue)
			r, _ := vm.ToValue(returnValue)
			reply = r
		} else {
			reply = otto.FalseValue()
		}
		return reply
	})

	//listDBTable(tablename) => Return key values array
	vm.Set("listDBTable", func(call otto.FunctionCall) otto.Value {
		tableName, _ := call.Argument(0).ToString()
		returnValue := map[string]string{}
		reply, _ := vm.ToValue(nil)
		if g.filterDBTable(tableName, true) {
			entries, _ := sysdb.ListTable(tableName)
			for _, keypairs := range entries {
				//Decode the string
				result := ""
				json.Unmarshal(keypairs[1], &result)
				returnValue[string(keypairs[0])] = result
			}
			r, err := vm.ToValue(returnValue)
			if err != nil {
				return otto.NullValue()
			}
			return r
		} else {
			reply = otto.FalseValue()
		}
		return reply
	})

	//deleteDBItem(tablename, key) => Return true if success, false if failed
	vm.Set("deleteDBItem", func(call otto.FunctionCall) otto.Value {
		tableName, _ := call.Argument(0).ToString()
		keyString, _ := call.Argument(1).ToString()
		if g.filterDBTable(tableName, true) {
			err := sysdb.Delete(tableName, keyString)
			if err != nil {
				return otto.FalseValue()
			}
		} else {
			//Permission denied
			return otto.FalseValue()
		}

		return otto.TrueValue()
	})

	//Module registry
	vm.Set("registerModule", func(call otto.FunctionCall) otto.Value {
		jsonModuleConfig, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Try to decode it to a module Info
		g.Option.ModuleRegisterParser(jsonModuleConfig)
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		return otto.Value{}
	})

	//Package Executation. Only usable when called to a given script File.
	if scriptFile != "" && scriptScope != "" {
		//Package request --> Install linux package if not exists
		vm.Set("requirepkg", func(call otto.FunctionCall) otto.Value {
			packageName, err := call.Argument(0).ToString()
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
			requireComply, err := call.Argument(1).ToBoolean()
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			scriptRoot := getScriptRoot(scriptFile, scriptScope)

			//Check if this module already get registered.
			alreadyRegistered := false
			for _, pkgRequest := range g.AllowAccessPkgs[strings.ToLower(packageName)] {
				if pkgRequest.InitRoot == scriptRoot {
					alreadyRegistered = true
					break
				}
			}

			if !alreadyRegistered {
				//Register this packge to this script and allow the module to call this package
				g.AllowAccessPkgs[strings.ToLower(packageName)] = append(g.AllowAccessPkgs[strings.ToLower(packageName)], AgiPackage{
					InitRoot: scriptRoot,
				})
			}

			//Try to install the package via apt
			err = g.Option.PackageManager.InstallIfNotExists(packageName, requireComply)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			return otto.TrueValue()
		})

		//Exec required pkg with permission control
		vm.Set("execpkg", func(call otto.FunctionCall) otto.Value {
			//Check if the pkg is already registered
			scriptRoot := getScriptRoot(scriptFile, scriptScope)
			packageName, err := call.Argument(0).ToString()
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			if val, ok := g.AllowAccessPkgs[packageName]; ok {
				//Package already registered by at least one module. Check if this script root registered
				thisModuleRegistered := false
				for _, registeredPkgInterface := range val {
					if registeredPkgInterface.InitRoot == scriptRoot {
						//This package registered this command. Allow access
						thisModuleRegistered = true
					}
				}

				if !thisModuleRegistered {
					g.raiseError(errors.New("Package request not registered: " + packageName))
					return otto.FalseValue()
				}

			} else {
				g.raiseError(errors.New("Package request not registered: " + packageName))
				return otto.FalseValue()
			}

			//Ok. Allow paramter to be loaded
			execParamters, _ := call.Argument(1).ToString()

			// Split input paramters into []string
			r := csv.NewReader(strings.NewReader(execParamters))
			r.Comma = ' ' // space
			fields, err := r.Read()
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			//Run os.Exec on the given commands
			cmd := exec.Command(packageName, fields...)
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Println(string(out))
				g.raiseError(err)
				return otto.FalseValue()
			}

			reply, _ := vm.ToValue(string(out))
			return reply
		})

		//Include another js in runtime
		vm.Set("includes", func(call otto.FunctionCall) otto.Value {
			//Check if the pkg is already registered
			scriptName, err := call.Argument(0).ToString()
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			//Check if it is calling itself
			if filepath.Base(scriptFile) == filepath.Base(scriptName) {
				g.raiseError(errors.New("*AGI* Self calling is not allowed"))
				return otto.FalseValue()
			}

			//Check if the script file exists
			targetScriptPath := filepath.ToSlash(filepath.Join(filepath.Dir(scriptFile), scriptName))
			if !fileExists(targetScriptPath) {
				g.raiseError(errors.New("*AGI* Target path not exists!"))
				return otto.FalseValue()
			}

			//Run the script
			scriptContent, _ := ioutil.ReadFile(targetScriptPath)
			_, err = vm.Run(string(scriptContent))
			if err != nil {
				//Script execution failed
				log.Println("Script Execution Failed: ", err.Error())
				g.raiseError(err)
				return otto.FalseValue()
			}

			return otto.TrueValue()
		})

	}

	//Delay, sleep given ms
	vm.Set("delay", func(call otto.FunctionCall) otto.Value {
		delayTime, err := call.Argument(0).ToInteger()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		time.Sleep(time.Duration(delayTime) * time.Millisecond)
		return otto.TrueValue()
	})

	//Exit
	vm.Set("exit", func(call otto.FunctionCall) otto.Value {
		vm.Interrupt <- func() {
			panic(errExitcall)
		}
		return otto.NullValue()
	})
}
