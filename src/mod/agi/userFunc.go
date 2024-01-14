package agi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	user "imuslab.com/arozos/mod/user"
)

// Inject user based functions into the virtual machine
// Note that the fsh might be nil and scriptPath must be real path of script being executed
// **Use local file system check if fsh == nil**
func (g *Gateway) injectUserFunctions(vm *otto.Otto, fsh *filesystem.FileSystemHandler, scriptPath string, scriptScope string, u *user.User, w http.ResponseWriter, r *http.Request) {
	username := u.Username
	vm.Set("USERNAME", username)
	vm.Set("USERICON", u.GetUserIcon())
	vm.Set("USERQUOTA_TOTAL", u.StorageQuota.TotalStorageQuota)
	vm.Set("USERQUOTA_USED", u.StorageQuota.UsedStorageQuota)
	vm.Set("USER_VROOTS", u.GetAllAccessibleFileSystemHandler())
	vm.Set("USER_MODULES", u.GetUserAccessibleModules())

	//File system and path related
	vm.Set("decodeVirtualPath", func(call otto.FunctionCall) otto.Value {
		log.Println("Call to deprecated function decodeVirtualPath")
		return otto.FalseValue()
	})

	vm.Set("decodeAbsoluteVirtualPath", func(call otto.FunctionCall) otto.Value {
		log.Println("Call to deprecated function decodeAbsoluteVirtualPath")
		return otto.FalseValue()
	})

	vm.Set("encodeRealPath", func(call otto.FunctionCall) otto.Value {
		log.Println("Call to deprecated function encodeRealPath")
		return otto.FalseValue()
	})

	//Check if a given virtual path is readonly
	vm.Set("pathCanWrite", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		if u.CanWrite(vpath) {
			return otto.TrueValue()
		} else {
			return otto.FalseValue()
		}
	})

	//Permission related
	vm.Set("getUserPermissionGroup", func(call otto.FunctionCall) otto.Value {
		groupinfo := u.GetUserPermissionGroup()
		jsonString, _ := json.Marshal(groupinfo)
		reply, _ := vm.ToValue(string(jsonString))
		return reply
	})

	vm.Set("userIsAdmin", func(call otto.FunctionCall) otto.Value {
		reply, _ := vm.ToValue(u.IsAdmin())
		return reply
	})

	//User Account Related
	/*
		userExists(username);
	*/
	vm.Set("userExists", func(call otto.FunctionCall) otto.Value {
		if u.IsAdmin() {
			//Get username from function paramter
			username, err := call.Argument(0).ToString()
			if err != nil || username == "undefined" {
				g.RaiseError(errors.New("username is undefined"))
				reply, _ := vm.ToValue(nil)
				return reply
			}

			//Check if user exists
			userExists := u.Parent().GetAuthAgent().UserExists(username)
			if userExists {
				return otto.TrueValue()
			} else {
				return otto.FalseValue()
			}

		} else {
			g.RaiseError(errors.New("Permission Denied: userExists require admin permission"))
			return otto.FalseValue()
		}

	})

	/*
		createUser(username, password, defaultGroup);
	*/
	vm.Set("createUser", func(call otto.FunctionCall) otto.Value {
		if u.IsAdmin() {
			//Ok. Create user base on given information
			username, err := call.Argument(0).ToString()
			if err != nil || username == "undefined" {
				g.RaiseError(errors.New("username is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			password, err := call.Argument(1).ToString()
			if err != nil || password == "undefined" {
				g.RaiseError(errors.New("password is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			defaultGroup, err := call.Argument(2).ToString()
			if err != nil || defaultGroup == "undefined" {
				g.RaiseError(errors.New("defaultGroup is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if username already used
			userExists := u.Parent().GetAuthAgent().UserExists(username)
			if userExists {
				g.RaiseError(errors.New("Username already exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if the given permission group exists
			groupExists := u.Parent().GetPermissionHandler().GroupExists(defaultGroup)
			if !groupExists {
				g.RaiseError(errors.New(defaultGroup + " user-group not exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Create the user
			err = u.Parent().GetAuthAgent().CreateUserAccount(username, password, []string{defaultGroup})

			if err != nil {
				g.RaiseError(errors.New("User creation failed: " + err.Error()))
				reply, _ := vm.ToValue(false)
				return reply
			}

			return otto.TrueValue()
		} else {
			g.RaiseError(errors.New("Permission Denied: createUser require admin permission"))
			return otto.FalseValue()
		}

	})

	vm.Set("editUser", func(call otto.FunctionCall) otto.Value {
		if u.IsAdmin() {

		} else {
			g.RaiseError(errors.New("Permission Denied: editUser require admin permission"))
			return otto.FalseValue()
		}
		//libname, err := call.Argument(0).ToString()
		return otto.FalseValue()
	})

	/*
		removeUser(username)
	*/
	vm.Set("removeUser", func(call otto.FunctionCall) otto.Value {
		if u.IsAdmin() {
			//Get username from function paramters
			username, err := call.Argument(0).ToString()
			if err != nil || username == "undefined" {
				g.RaiseError(errors.New("username is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if the user exists
			userExists := u.Parent().GetAuthAgent().UserExists(username)
			if !userExists {
				g.RaiseError(errors.New(username + " not exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//User exists. Remove it from the system
			err = u.Parent().GetAuthAgent().UnregisterUser(username)
			if err != nil {
				g.RaiseError(errors.New("User removal failed: " + err.Error()))
				reply, _ := vm.ToValue(false)
				return reply
			}

			return otto.TrueValue()
		} else {
			g.RaiseError(errors.New("Permission Denied: removeUser require admin permission"))
			return otto.FalseValue()
		}
	})

	vm.Set("getUserInfoByName", func(call otto.FunctionCall) otto.Value {
		//libname, err := call.Argument(0).ToString()
		if u.IsAdmin() {

		} else {

			g.RaiseError(errors.New("Permission Denied: getUserInfoByName require admin permission"))
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Allow real time library includsion into the virtual machine
	vm.Set("requirelib", func(call otto.FunctionCall) otto.Value {
		libname, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			reply, _ := vm.ToValue(nil)
			return reply
		}

		//Handle special case on high level libraries
		if libname == "websocket" && w != nil && r != nil {
			g.injectWebSocketFunctions(vm, u, w, r)
			return otto.TrueValue()
		} else {
			//Check if the library name exists. If yes, run the initiation script on the vm
			if entryPoint, ok := g.LoadedAGILibrary[libname]; ok {
				entryPoint(&static.AgiLibInjectionPayload{
					VM:         vm,
					User:       u,
					ScriptFsh:  fsh,
					ScriptPath: scriptPath,
					Writer:     w,
					Request:    r,
				})
				return otto.TrueValue()
			} else {
				//Lib not exists
				log.Println("Lib not found: " + libname)
				return otto.FalseValue()
			}
		}
	})

	//Execd (Execute & detach) run another script and detach the execution
	vm.Set("execd", func(call otto.FunctionCall) otto.Value {
		//Check if the pkg is already registered
		scriptName, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Carry the payload to the forked process if there are any
		payload, _ := call.Argument(1).ToString()

		//Check if the script file exists
		targetScriptPath := arozfs.ToSlash(filepath.Join(filepath.Dir(scriptPath), scriptName))
		if fsh != nil {
			if !fsh.FileSystemAbstraction.FileExists(targetScriptPath) {
				g.RaiseError(errors.New("[AGI] Target path not exists!"))
				return otto.FalseValue()
			}
		} else {
			if !filesystem.FileExists(targetScriptPath) {
				g.RaiseError(errors.New("[AGI] Target path not exists!"))
				return otto.FalseValue()
			}
		}

		//Run the script
		scriptContent, _ := os.ReadFile(targetScriptPath)
		go func() {
			//Create a new VM to execute the script (also for isolation)
			vm := otto.New()
			//Inject standard libs into the vm
			g.injectStandardLibs(vm, scriptPath, scriptScope)
			g.injectUserFunctions(vm, fsh, scriptPath, scriptScope, u, w, r)

			vm.Set("PARENT_DETACHED", true)
			vm.Set("PARENT_PAYLOAD", payload)
			_, err = vm.Run(string(scriptContent))
			if err != nil {
				//Script execution failed
				log.Println("Script Execution Failed: ", err.Error())
				g.RaiseError(err)
			}
		}()

		return otto.TrueValue()
	})

}
