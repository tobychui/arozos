package agi

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// injectStandardLibs injects system constants and core functions into the Otto VM.
// It generates a UUIDv4 execution ID, sets it as EXECUTION_ID on the VM, and
// returns it so callers can include it in external log messages.
func (g *Gateway) injectStandardLibs(vm *otto.Otto, scriptFile string, scriptScope string) string {
	//Define system core modules and definations
	sysdb := g.Option.UserHandler.GetDatabase()

	// Generate a unique ID for this script invocation.
	execID := uuid.NewV4().String()

	//Define VM global variables
	vm.Set("BUILD_VERSION", g.Option.BuildVersion)
	vm.Set("INTERNAL_VERSION", g.Option.InternalVersion)
	vm.Set("LOADED_MODULES", g.Option.LoadedModule)
	vm.Set("LOADED_STORAGES", g.Option.UserHandler.GetStoragePool())
	vm.Set("__FILE__", scriptFile)
	vm.Set("HTTP_RESP", "")
	vm.Set("HTTP_HEADER", "text/plain")

	// EXECUTION_ID is a UUIDv4 that uniquely identifies this script invocation.
	// Available in every AGI script — use it for log correlation, deduplication, etc.
	vm.Set("EXECUTION_ID", execID)

	// Override otto's built-in console.log (which maps to fmt.Println) so that
	// script output goes through the structured logger and carries the execID.
	// Use the system-wide logger (with file output) when available; fall back to
	// a tmp stdout-only logger if the Gateway was created without one.
	scriptLogger := g.Option.Logger
	if scriptLogger == nil {
		scriptLogger, _ = logger.NewTmpLogger()
	}
	vm.Set("_agi_console_log", func(call otto.FunctionCall) otto.Value {
		parts := make([]string, 0, len(call.ArgumentList))
		for _, arg := range call.ArgumentList {
			str, _ := arg.ToString()
			parts = append(parts, str)
		}
		scriptLogger.PrintAndLog("AGI", "["+execID+"] "+strings.Join(parts, " "), nil)
		return otto.UndefinedValue()
	})
	vm.Run(`var console = { log: _agi_console_log, warn: _agi_console_log, error: _agi_console_log, info: _agi_console_log };`) //nolint:errcheck

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
		if static.IsValidAGIScript(scriptPath) {
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
			g.RaiseError(err)
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
			g.RaiseError(err)
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
			g.RaiseError(err)
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
			g.RaiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if the tablename is reserved
		if g.filterDBTable(tableName, true) {
			keyString, err := call.Argument(1).ToString()
			if err != nil {
				g.RaiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			valueString, err := call.Argument(2).ToString()
			if err != nil {
				g.RaiseError(err)
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
			g.RaiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Parse the module config JSON to convert relative paths to absolute paths
		var moduleConfig map[string]interface{}
		err = json.Unmarshal([]byte(jsonModuleConfig), &moduleConfig)
		if err != nil {
			g.RaiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Get the module directory from the script file path
		//For example: ./web/Label Maker/init.agi -> Label Maker
		if scriptFile != "" && scriptScope != "" {
			moduleDir := static.GetScriptRoot(scriptFile, scriptScope)

			//Convert relative paths to absolute paths for IconPath, StartDir, and LaunchFWDir
			pathFields := []string{"IconPath", "StartDir", "LaunchFWDir", "LaunchEmb"}
			for _, field := range pathFields {
				if value, exists := moduleConfig[field]; exists {
					if strValue, ok := value.(string); ok && strValue != "" {
						//Check if the path is relative (doesn't start with module name)
						if !filepath.IsAbs(strValue) && !strings.HasPrefix(strValue, moduleDir+"/") {
							//Convert relative path to absolute path
							moduleConfig[field] = filepath.ToSlash(filepath.Join(moduleDir, strValue))
						}
					}
				}
			}

			//Re-encode the modified config
			modifiedJSON, err := json.Marshal(moduleConfig)
			if err != nil {
				g.RaiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			jsonModuleConfig = string(modifiedJSON)
		}

		//Try to decode it to a module Info
		err = g.Option.ModuleRegisterParser(jsonModuleConfig)
		if err != nil {
			g.RaiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		return otto.Value{}
	})

	//Package Executation. Only usable when called to a given script File.
	if scriptFile != "" && scriptScope != "" {
		//Package request --> Install linux package if not exists
		vm.Set("requirepkg", func(call otto.FunctionCall) otto.Value {
			g.RaiseError(errors.New("requirepkg has been deprecated in agi v3.0"))
			return otto.FalseValue()
		})

		//Exec required pkg with permission control
		vm.Set("execpkg", func(call otto.FunctionCall) otto.Value {
			g.RaiseError(errors.New("execpkg has been deprecated in agi v3.0"))
			return otto.FalseValue()
		})

		//Include another js in runtime
		vm.Set("includes", func(call otto.FunctionCall) otto.Value {
			//Check if the pkg is already registered
			scriptName, err := call.Argument(0).ToString()
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}

			//Check if it is calling itself
			if filepath.Base(scriptFile) == filepath.Base(scriptName) {
				g.RaiseError(errors.New("*AGI* Self calling is not allowed"))
				return otto.FalseValue()
			}

			//Check if the script file exists
			targetScriptPath := filepath.ToSlash(filepath.Join(filepath.Dir(scriptFile), scriptName))
			if !utils.FileExists(targetScriptPath) {
				g.RaiseError(errors.New("*AGI* Target path not exists!"))
				return otto.FalseValue()
			}

			//Run the script
			scriptContent, _ := os.ReadFile(targetScriptPath)
			_, err = vm.Run(string(scriptContent))
			if err != nil {
				//Script execution failed
				logger.PrintAndLog("Agi", fmt.Sprint("Script Execution Failed: ", err.Error()), nil)
				g.RaiseError(err)
				return otto.FalseValue()
			}

			return otto.TrueValue()
		})

	}

	//Delay, sleep given ms
	vm.Set("delay", func(call otto.FunctionCall) otto.Value {
		delayTime, err := call.Argument(0).ToInteger()
		if err != nil {
			g.RaiseError(err)
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

	return execID
}
