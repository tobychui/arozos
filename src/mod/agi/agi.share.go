package agi

import (
	"log"
	"time"

	"github.com/robertkrimen/otto"
	user "imuslab.com/arozos/mod/user"
)

func (g *Gateway) ShareLibRegister() {
	err := g.RegisterLib("share", g.injectShareFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectShareFunctions(vm *otto.Otto, u *user.User) {
	vm.Set("_share_file", func(call otto.FunctionCall) otto.Value {
		//Get the vpath of file to share
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			return otto.New().MakeCustomError("Unable to decode filepath", "No given filepath for sharing")
		}

		//Get the timeout from the 2nd parameter for how long this share will exists
		timeout, err := call.Argument(1).ToInteger()
		if err != nil {
			//Not defined -> Do not expire
			timeout = 0
		}

		//Resolve the file path
		rpath, err := u.VirtualPathToRealPath(vpath)
		if err != nil {
			return otto.New().MakeCustomError("Path resolve failed", "Unable to resolve virtual path: "+err.Error())
		}

		//Check if file exists
		if !fileExists(rpath) {
			return otto.New().MakeCustomError("File not exists", "Share file vpath not exists")
		}

		//Create a share object for this request
		shareID, err := g.Option.ShareManager.CreateNewShare(u, vpath)
		if err != nil {
			log.Println("[AGI] Create Share Failed: " + err.Error())
			return otto.New().MakeCustomError("Share failed", err.Error())
		}

		if timeout > 0 {
			go func(timeout int) {
				time.Sleep(time.Duration(timeout) * time.Second)
				g.Option.ShareManager.RemoveShareByUUID(shareID.UUID)
				log.Println("[AGI] Share auto-removed: " + shareID.UUID)
			}(int(timeout))
		}

		r, _ := otto.ToValue(shareID.UUID)
		return r
	})

	vm.Set("_share_removeShare", func(call otto.FunctionCall) otto.Value {
		shareUUID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.New().MakeCustomError("Failed to remove share", "No share UUID given")
		}
		err = g.Option.ShareManager.RemoveShareByUUID(shareUUID)
		if err != nil {
			log.Println("[AGI] Share remove failed: " + err.Error())
			return otto.New().MakeCustomError("Failed to remove share", err.Error())
		}

		return otto.TrueValue()
	})

	vm.Set("_share_getShareUUID", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			log.Println("[AGI] Failed to get share UUID: filepath not given")
			return otto.NullValue()
		}

		//Resolve the vpath to realpath
		rpath, err := u.VirtualPathToRealPath(vpath)
		if err != nil {
			log.Println("[AGI] Failed to get share UUID: Unabel to resovle")
			return otto.NullValue()
		}
		shareObject := g.Option.ShareManager.GetShareObjectFromRealPath(rpath)
		if shareObject == nil {
			log.Println("[AGI] Failed to get share UUID: File not shared")
			return otto.NullValue()
		}

		shareUUID := shareObject.UUID
		val, _ := otto.ToValue(shareUUID)
		return val
	})

	vm.Set("_share_checkShareExists", func(call otto.FunctionCall) otto.Value {
		shareUUID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.New().MakeCustomError("Failed to check share exists", "No share UUID given")
		}

		shareObject := g.Option.ShareManager.GetShareObjectFromUUID(shareUUID)
		r, _ := otto.ToValue(!(shareObject == nil))
		return r
	})

	vm.Set("_share_checkSharePermission", func(call otto.FunctionCall) otto.Value {
		shareUUID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.New().MakeCustomError("Failed to check share permission", "No share UUID given")
		}

		shareObject := g.Option.ShareManager.GetShareObjectFromUUID(shareUUID)
		if shareObject == nil {
			return otto.NullValue()
		}
		r, _ := otto.ToValue(shareObject.Permission)
		return r
	})

	vm.Set("_share_fileIsShared", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			return otto.New().MakeCustomError("Failed to check share exists", "No filepath given")
		}

		rpath, err := u.VirtualPathToRealPath(vpath)
		if err != nil {
			return otto.New().MakeCustomError("Filepath resolve failed", err.Error())
		}

		isShared := g.Option.ShareManager.FileIsShared(rpath)
		r, _ := otto.ToValue(isShared)
		return r
	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var share = {};
		share.shareFile = _share_file;
		share.removeShare = _share_removeShare;
		share.checkShareExists = _share_checkShareExists;
		share.fileIsShared = _share_fileIsShared;
		share.getFileShareUUID = _share_getShareUUID;
		share.checkSharePermission = _share_checkSharePermission;
	`)
}
