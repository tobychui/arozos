package main

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"os/exec"
	"encoding/csv"

	"github.com/robertkrimen/otto"
)

/*
	System AJGI Handler

	AJGI = ArOZ JavaScript Gateway Interface

	This script load plugins written in Javascript and run them in VM inside golang
	DO NOT CONFUSE PLUGIN WITH SUBSERVICE :))
*/

type agiLibInterface func(*otto.Otto, string) //Define the lib loader interface for AGI Libraries
type agiPkgInterface struct{
	InitRoot string					//The initialization of the root for the module that request this package
}
var (
	systemOnlyTable = []string{"auth", "permission"}
	ajgiUsableLibs  = map[string]agiLibInterface{}
	ajgiUsablePkgs = map[string][]agiPkgInterface{}
)

func system_ajgi_init() {
	//Load the scripts located in plugin folder
	http.HandleFunc("/system/ajgi/interface", system_ajgi_interface)

	//Handle startup registration of ajgi modules
	startupScripts, _ := filepath.Glob("./web/*/init.agi")
	for _, script := range startupScripts {
		scriptContentByte, _ := ioutil.ReadFile(script)
		scriptContent := string(scriptContentByte)
		log.Println("Gatewat script loaded (" + script + ")")
		//Create a new vm for this request
		vm := otto.New()

		//Only allow non user based operations
		system_ajgi_injectArOZLibs(vm, script)

		_, err := vm.Run(scriptContent)
		if err != nil {
			log.Println("Failed to execute init script from module: " + script)
			panic(err)
		}

	}

	//Load all the other libs entry points into the memoary
	ajgi_imageLib_init()
	ajgi_fileLib_init();
}

func system_ajgi_registerLib(libname string, entryPoint agiLibInterface) error {
	_, ok := ajgiUsableLibs[libname]
	if ok {
		//This lib already registered. Return error
		return errors.New("This library name already registered")
	} else {
		ajgiUsableLibs[libname] = entryPoint
	}
	return nil
}

//Inject user based functions into the virtual machine
func system_ajgi_injectUserFunctions(vm *otto.Otto, username string) {
	vm.Set("USERNAME", username)

	//File system and path related
	vm.Set("decodeVirtualPath", func(call otto.FunctionCall) otto.Value {
		path, _ := call.Argument(0).ToString()
		realpath, err := virtualPathToRealPath(path, username)
		if err != nil {
			reply, _ := vm.ToValue(false)
			return reply
		} else {
			reply, _ := vm.ToValue(realpath)
			return reply
		}
	})

	vm.Set("encodeRealPath", func(call otto.FunctionCall) otto.Value {
		path, _ := call.Argument(0).ToString()
		realpath, err := realpathToVirtualpath(path, username)
		if err != nil {
			reply, _ := vm.ToValue(false)
			return reply
		} else {
			reply, _ := vm.ToValue(realpath)
			return reply
		}
	})

	//Permission related
	vm.Set("getUserPermissionGroup", func(call otto.FunctionCall) otto.Value {
		groupname, err := system_permission_getUserGroups(username)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		reply, _ := vm.ToValue(groupname)
		return reply
	})

	vm.Set("userIsAdmin", func(call otto.FunctionCall) otto.Value {
		userGroup := system_permission_getUserPermissionGroup(username)
		if userGroup == "administrator" {
			reply, _ := vm.ToValue(true)
			return reply
		}
		reply, _ := vm.ToValue(false)
		return reply
	})

	//Allow real time library includsion into the virtual machine
	vm.Set("requirelib", func(call otto.FunctionCall) otto.Value {
		libname, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(nil)
			return reply
		}

		//Check if the library name exists. If yes, run the initiation script on the vm
		if entryPoint, ok := ajgiUsableLibs[libname]; ok {
			entryPoint(vm, username)
			reply, _ := vm.ToValue(true)
			return reply
		} else {
			//Lib not exists
			log.Println("Lib not found: " + libname)
			reply, _ := vm.ToValue(false)
			return reply
		}

	})

}

//Inject aroz online custom functions into the virtual machine
func system_ajgi_injectArOZLibs(vm *otto.Otto, scriptFile string) {
	//Define VM global variables
	vm.Set("BUILD_VERSION", build_version)
	vm.Set("INTERNVAL_VERSION", internal_version)
	vm.Set("LOADED_MODULES", loadedModule)
	vm.Set("LOADED_STORAGES", storages)
	vm.Set("HTTP_RESP", "")
	vm.Set("HTTP_HEADER", "text/plain")

	//Response related
	vm.Set("sendResp", func(call otto.FunctionCall) otto.Value {
		argString, _ := call.Argument(0).ToString()
		vm.Set("HTTP_RESP", argString)
		return otto.Value{}
	})

	vm.Set("sendJSONResp", func(call otto.FunctionCall) otto.Value {
		argString, _ := call.Argument(0).ToString()
		vm.Set("HTTP_HEADER", "application/json")
		vm.Set("HTTP_RESP", argString)
		return otto.Value{}
	})

	//Database related
	//newDBTableIfNotExists(tableName)
	vm.Set("newDBTableIfNotExists", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Create the table with given tableName
		if system_agji_filterDBTableAccessRequest(tableName) {
			system_db_newTable(sysdb, tableName)
			//Return true
			reply, _ := vm.ToValue(true)
			return reply
		}

		reply, _ := vm.ToValue(false)
		return reply
	})

	//dropDBTable(tablename)
	vm.Set("dropDBTable", func(call otto.FunctionCall) otto.Value {
		tableName, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Create the table with given tableName
		if system_agji_filterDBTableAccessRequest(tableName) {
			system_db_dropTable(sysdb, tableName)
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
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}

		//Check if the tablename is reserved
		if system_agji_filterDBTableAccessRequest(tableName) {
			keyString, err := call.Argument(1).ToString()
			if err != nil {
				system_ajgi_raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			valueString, err := call.Argument(2).ToString()
			if err != nil {
				system_ajgi_raiseError(err)
				reply, _ := vm.ToValue(false)
				return reply
			}
			system_db_write(sysdb, tableName, keyString, valueString)
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
		if system_agji_filterDBTableAccessRequest(tableName) {
			system_db_read(sysdb, tableName, keyString, &returnValue)
			r, _ := vm.ToValue(returnValue)
			reply = r
		}
		return reply
	})

	//listDBTable(tablename) => Return key values array
	vm.Set("listDBTable", func(call otto.FunctionCall) otto.Value {
		tableName, _ := call.Argument(0).ToString()
		returnValue := map[string]string{}
		reply, _ := vm.ToValue(nil)
		if system_agji_filterDBTableAccessRequest(tableName) {
			entries := system_db_listTable(sysdb, tableName)
			for _, keypairs := range entries{
				//Decode the string 
				result := ""
				json.Unmarshal(keypairs[1], &result);
				returnValue[string(keypairs[0])] = result
			}
			r, err := vm.ToValue(returnValue)
			if err != nil{
				return otto.NullValue()
			}
			return r
		}
		return reply
	})

	//deleteDBItem(tablename, key) => Return true if success, false if failed
	vm.Set("deleteDBItem", func(call otto.FunctionCall) otto.Value {
		tableName, _ := call.Argument(0).ToString()
		keyString, _ := call.Argument(1).ToString()
		if system_agji_filterDBTableAccessRequest(tableName){
			err := system_db_delete(sysdb, tableName, keyString)
			if err != nil{
				return otto.FalseValue()
			}
		}else{
			//Permission denied
			return otto.FalseValue()
		}
		
		return otto.TrueValue()
	})


	//Module registry
	vm.Set("registerModule", func(call otto.FunctionCall) otto.Value {
		jsonModuleConfig, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		//Try to decode it to a module Info
		var thisModuleInfo moduleInfo
		err = json.Unmarshal([]byte(jsonModuleConfig), &thisModuleInfo)
		registerModule(thisModuleInfo)
		if err != nil {
			system_ajgi_raiseError(err)
			reply, _ := vm.ToValue(false)
			return reply
		}
		return otto.Value{}
	})

	//Package request --> Install linux package if not exists
	vm.Set("requirepkg", func(call otto.FunctionCall) otto.Value {
		packageName, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			return  otto.FalseValue();
		}
		requireComply, err := call.Argument(1).ToBoolean()
		if err != nil {
			system_ajgi_raiseError(err)
			return  otto.FalseValue();
		}

		scriptRoot := system_ajgi_getScriptRoot(scriptFile);

		//Check if this module already get registered. 
		alreadyRegistered := false;
		for _, pkgRequest := range ajgiUsablePkgs[strings.ToLower(packageName)]{
			if (pkgRequest.InitRoot == scriptRoot){
				alreadyRegistered = true
				break;
			}
		}

		if (!alreadyRegistered){
			//Register this packge to this script and allow the module to call this package
			ajgiUsablePkgs[strings.ToLower(packageName)] = append(ajgiUsablePkgs[strings.ToLower(packageName)], agiPkgInterface{
				InitRoot: scriptRoot,
			})
		}

		//Try to install the package via apt
		err = module_package_installIfNotExists(packageName, requireComply)
		if err != nil {
			system_ajgi_raiseError(err)
			return  otto.FalseValue();
		}

		return otto.TrueValue()
	})

	//Exec required pkg with permission control
	vm.Set("execpkg", func(call otto.FunctionCall) otto.Value {
		//Check if the pkg is already registered
		scriptRoot := system_ajgi_getScriptRoot(scriptFile);
		packageName, err := call.Argument(0).ToString()
		if err != nil {
			system_ajgi_raiseError(err)
			return otto.FalseValue();
		}

		if val, ok := ajgiUsablePkgs[packageName]; ok {
			//Package already registered by at least one module. Check if this script root registered
			thisModuleRegistered := false
			for _, registeredPkgInterface := range val{
				if (registeredPkgInterface.InitRoot == scriptRoot){
					//This package registered this command. Allow access
					thisModuleRegistered = true
				}
			}

			if (!thisModuleRegistered){
				system_ajgi_raiseError(errors.New("Package request not registered: " + packageName))
				return  otto.FalseValue();
			}

		}else{
			system_ajgi_raiseError(errors.New("Package request not registered: " + packageName))
			return  otto.FalseValue();
		}

		//Ok. Allow paramter to be loaded
		execParamters, _ := call.Argument(1).ToString()

		// Split input paramters into []string
		r := csv.NewReader(strings.NewReader(execParamters))
		r.Comma = ' ' // space
		fields, err := r.Read()
		if err != nil {
			system_ajgi_raiseError(err)
			return  otto.FalseValue();
		}

		//Run os.Exec on the given commands
		cmd := exec.Command(packageName, fields...)
		out, err := cmd.CombinedOutput()
		if err != nil{
			log.Println(string(out));
			system_ajgi_raiseError(err)
			return  otto.FalseValue();
		}


		reply, _ := vm.ToValue(string(out))
		return reply
	})
}

//Return the script root of the current executing script
func system_ajgi_getScriptRoot(scriptFile string) string{
	//Get the script root from the script path
	webRootAbs, _ := filepath.Abs("./web/")
	webRootAbs = filepath.ToSlash(filepath.Clean(webRootAbs) + "/")
	scriptFileAbs, _ := filepath.Abs(scriptFile);
	scriptFileAbs = filepath.ToSlash(filepath.Clean(scriptFileAbs))
	scriptRoot := strings.Replace(scriptFileAbs, webRootAbs, "",  1)
	scriptRoot = strings.Split(scriptRoot, "/")[0]
	return scriptRoot;
}

func system_ajgi_raiseError(err error) {
	log.Println("[Runtime Error (AGI Engine)] " + err.Error())

	//To be implemented
}

//Check if this table is restricted table. Return true if the access is valid
func system_agji_filterDBTableAccessRequest(tablename string) bool {
	if stringInSlice(tablename, systemOnlyTable) {
		return false
	}
	return true
}

func system_ajgi_interface(w http.ResponseWriter, r *http.Request) {
	//Check if user logged in, and get username
	username, err := system_auth_getUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get the script files for the plugin
	scriptFile, err := mv(r, "script", false)
	if err != nil {
		sendErrorResponse(w, "Invalid script path")
		return
	}
	scriptFile = system_fs_specialURIDecode(scriptFile)

	//Check if the script path exists
	if !fileExists("./web/" + scriptFile) {
		sendErrorResponse(w, "Script not found")
		return
	}

	//Get the content of the script
	scriptContentByte, _ := ioutil.ReadFile("./web/" + scriptFile)
	scriptContent := string(scriptContentByte)

	//Create a new vm for this request
	vm := otto.New()
	//Inject standard libs into the vm
	system_ajgi_injectArOZLibs(vm, "./web/" + scriptFile)
	system_ajgi_injectUserFunctions(vm, username)

	//Detect cotent type
	contentType := r.Header.Get("Content-type")
	if strings.Contains(contentType, "application/json") {
		//Shitty people who use Angular
		//This is fucking shit for those Agular developer
		//Fuckyou Angular!
		body, _ := ioutil.ReadAll(r.Body)
		vm.Set("POST_data", string(body))
	} else {
		r.ParseForm()
		//Insert all paramters into the vm
		for k, v := range r.PostForm {
			if len(v) == 1 {
				vm.Set(k, v[0])
			} else {
				vm.Set(k, v)
			}

		}
	}

	_, err = vm.Run(scriptContent)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get the return valu from the script
	value, err := vm.Get("HTTP_RESP")
	if err != nil {
		sendTextResponse(w, "")
		return
	}
	valueString, err := value.ToString()

	//Get respond header type from the vm
	header, _ := vm.Get("HTTP_HEADER")
	headerString, _ := header.ToString()
	if headerString != "" {
		w.Header().Set("Content-Type", headerString)
	}

	w.Write([]byte(valueString))
}
