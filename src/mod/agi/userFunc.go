package agi

import (
	"log"
	"net/http"
	"github.com/robertkrimen/otto"
	user "imuslab.com/aroz_online/mod/user"
)

//Define path translation function
func virtualPathToRealPath(path string, u *user.User)(string, error){
	return u.VirtualPathToRealPath(path)
}

func realpathToVirtualpath(path string, u *user.User)(string, error){
	return u.RealPathToVirtualPath(path)
}


//Inject user based functions into the virtual machine
func (g *Gateway)injectUserFunctions(vm *otto.Otto, w http.ResponseWriter, r *http.Request) {
	u, err := g.Option.UserHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		panic(err.Error())
	}
	username := u.Username;
	vm.Set("USERNAME", username)
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
		reply, _ := vm.ToValue(groupinfo)
		return reply
	})

	vm.Set("userIsAdmin", func(call otto.FunctionCall) otto.Value {
		reply, _ := vm.ToValue(u.IsAdmin())
		return reply
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
			entryPoint(vm, w, r)
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