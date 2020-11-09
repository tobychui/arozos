package agi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"

	"github.com/robertkrimen/otto"
	user "imuslab.com/aroz_online/mod/user"
)

//Define path translation function
func virtualPathToRealPath(path string, u *user.User) (string, error) {
	return u.VirtualPathToRealPath(path)
}

func realpathToVirtualpath(path string, u *user.User) (string, error) {
	return u.RealPathToVirtualPath(path)
}

//Inject user based functions into the virtual machine
func (g *Gateway) injectUserFunctions(vm *otto.Otto, w http.ResponseWriter, r *http.Request, u *user.User) {
	username := u.Username
	vm.Set("USERNAME", username)
	vm.Set("USERICON", u.GetUserIcon())
	vm.Set("USERQUOTA_TOTAL", u.StorageQuota.TotalStorageQuota)
	vm.Set("USERQUOTA_USED", u.StorageQuota.UsedStorageQuota)
	//File system and path related
	vm.Set("decodeVirtualPath", func(call otto.FunctionCall) otto.Value {
		path, _ := call.Argument(0).ToString()
		realpath, err := virtualPathToRealPath(path, u)
		if err != nil {
			reply, _ := vm.ToValue(false)
			return reply
		} else {
			reply, _ := vm.ToValue(realpath)
			return reply
		}
	})

	vm.Set("decodeAbsoluteVirtualPath", func(call otto.FunctionCall) otto.Value {
		path, _ := call.Argument(0).ToString()
		realpath, err := virtualPathToRealPath(path, u)
		if err != nil {
			reply, _ := vm.ToValue(false)
			return reply
		} else {
			//Convert the real path to absolute path
			abspath, err := filepath.Abs(realpath)
			if err != nil {
				reply, _ := vm.ToValue(false)
				return reply
			}
			reply, _ := vm.ToValue(abspath)
			return reply
		}
	})

	vm.Set("encodeRealPath", func(call otto.FunctionCall) otto.Value {
		path, _ := call.Argument(0).ToString()
		realpath, err := realpathToVirtualpath(path, u)
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
				g.raiseError(errors.New("username is undefined"))
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
			g.raiseError(errors.New("Permission Denied: userExists require admin permission"))
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
				g.raiseError(errors.New("username is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			password, err := call.Argument(1).ToString()
			if err != nil || password == "undefined" {
				g.raiseError(errors.New("password is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			defaultGroup, err := call.Argument(2).ToString()
			if err != nil || defaultGroup == "undefined" {
				g.raiseError(errors.New("defaultGroup is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if username already used
			userExists := u.Parent().GetAuthAgent().UserExists(username)
			if userExists {
				g.raiseError(errors.New("Username already exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if the given permission group exists
			groupExists := u.Parent().GetPermissionHandler().GroupExists(defaultGroup)
			if !groupExists {
				g.raiseError(errors.New(defaultGroup + " user-group not exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Create the user
			err = u.Parent().GetAuthAgent().CreateUserAccount(username, password, []string{defaultGroup})

			if err != nil {
				g.raiseError(errors.New("User creation failed: " + err.Error()))
				reply, _ := vm.ToValue(false)
				return reply
			}

			return otto.TrueValue()
		} else {
			g.raiseError(errors.New("Permission Denied: createUser require admin permission"))
			return otto.FalseValue()
		}

	})

	vm.Set("editUser", func(call otto.FunctionCall) otto.Value {
		if u.IsAdmin() {

		} else {
			g.raiseError(errors.New("Permission Denied: editUser require admin permission"))
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
				g.raiseError(errors.New("username is undefined"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//Check if the user exists
			userExists := u.Parent().GetAuthAgent().UserExists(username)
			if !userExists {
				g.raiseError(errors.New(username + " not exists"))
				reply, _ := vm.ToValue(false)
				return reply
			}

			//User exists. Remove it from the system
			err = u.Parent().GetAuthAgent().UnregisterUser(username)
			if err != nil {
				g.raiseError(errors.New("User removal failed: " + err.Error()))
				reply, _ := vm.ToValue(false)
				return reply
			}

			return otto.TrueValue()
		} else {
			g.raiseError(errors.New("Permission Denied: removeUser require admin permission"))
			return otto.FalseValue()
		}
		return otto.FalseValue()
	})

	vm.Set("getUserInfoByName", func(call otto.FunctionCall) otto.Value {
		//libname, err := call.Argument(0).ToString()
		if u.IsAdmin() {

		} else {

			g.raiseError(errors.New("Permission Denied: getUserInfoByName require admin permission"))
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Allow real time library includsion into the virtual machine
	vm.Set("requirelib", func(call otto.FunctionCall) otto.Value {
		libname, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			reply, _ := vm.ToValue(nil)
			return reply
		}

		//Check if the library name exists. If yes, run the initiation script on the vm
		if entryPoint, ok := g.LoadedAGILibrary[libname]; ok {
			entryPoint(vm, w, r, u)
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
