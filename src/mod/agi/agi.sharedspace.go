package agi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/sharedspace"
)

/*
	AGI SharedSpace Library

	Exposes the shared collaboration space manager to AGI scripts. A shared
	space is an area where multiple different users can share texts, images
	and files together: the random space ID acts as the access capability,
	so any user whose script knows the ID can read and post items. Loaded
	with requirelib("sharedspace").

	MeetRoom binds one space to every meeting room (see agi.meetroom.go),
	so this library is also how scripts read a live meeting's chat and post
	messages / files into it.
*/

// agiOriginTag marks items posted through this library so consumers (e.g.
// the MeetRoom space item bridge) can tell them apart from their own posts.
const agiOriginTag = "agi"

func (g *Gateway) SharedSpaceLibRegister() {
	err := g.RegisterLib("sharedspace", g.injectSharedSpaceFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

// agiDescribeSpace renders the space fields shared with AGI scripts.
func agiDescribeSpace(space *sharedspace.Space) map[string]interface{} {
	return map[string]interface{}{
		"spaceid":   space.ID,
		"name":      space.Name,
		"owner":     space.Owner,
		"items":     space.ItemCount(),
		"createdat": space.CreatedAt.Unix(),
	}
}

// agiDescribeItem renders a space item for AGI scripts. Text content is
// included inline for text items; blobs report their display name and size.
func agiDescribeItem(item *sharedspace.Item) map[string]interface{} {
	return map[string]interface{}{
		"itemid":   item.ID,
		"type":     item.Type,
		"name":     item.Name,
		"text":     item.Text,
		"size":     item.Size,
		"uploader": item.Uploader,
		"origin":   item.Origin,
		"time":     item.CreatedAt.Unix(),
	}
}

func (g *Gateway) injectSharedSpaceFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh
	manager := g.Option.SharedSpaceManager
	if manager == nil || u == nil {
		return
	}

	jsonReply := func(v interface{}) otto.Value {
		js, err := json.Marshal(v)
		if err != nil {
			return otto.NullValue()
		}
		val, _ := vm.ToValue(string(js))
		return val
	}

	getSpace := func(call otto.FunctionCall) (*sharedspace.Space, bool) {
		spaceID, err := call.Argument(0).ToString()
		if err != nil {
			return nil, false
		}
		return manager.GetSpace(spaceID)
	}

	//Create a new shared space owned by the calling user
	vm.Set("_sharedspace_createSpace", func(call otto.FunctionCall) otto.Value {
		name := ""
		if call.Argument(0).IsDefined() {
			name, _ = call.Argument(0).ToString()
		}
		space := manager.CreateSpace(u.Username, name)
		return jsonReply(agiDescribeSpace(space))
	})

	//Delete a space; owner only
	vm.Set("_sharedspace_deleteSpace", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok || space.Owner != u.Username {
			return otto.FalseValue()
		}
		manager.DeleteSpace(space.ID)
		return otto.TrueValue()
	})

	//List the spaces owned by the calling user
	vm.Set("_sharedspace_listMySpaces", func(call otto.FunctionCall) otto.Value {
		owned := manager.ListSpacesByOwner(u.Username)
		list := make([]map[string]interface{}, 0, len(owned))
		for _, space := range owned {
			list = append(list, agiDescribeSpace(space))
		}
		return jsonReply(list)
	})

	//Describe a space by ID
	vm.Set("_sharedspace_getSpaceInfo", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return jsonReply(map[string]interface{}{"exists": false})
		}
		desc := agiDescribeSpace(space)
		desc["exists"] = true
		return jsonReply(desc)
	})

	//Post a text snippet into a space
	vm.Set("_sharedspace_addText", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		text, err := call.Argument(1).ToString()
		if err != nil {
			return otto.NullValue()
		}
		item, err := space.AddText(u.Username, text, agiOriginTag)
		if err != nil {
			return otto.NullValue()
		}
		val, _ := vm.ToValue(item.ID)
		return val
	})

	//Share a file from the calling user's storage into a space
	vm.Set("_sharedspace_addFile", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		vpath, err := call.Argument(1).ToString()
		if err != nil {
			return otto.NullValue()
		}
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)
		if !u.CanRead(vpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+vpath))
		}
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		src, err := fsh.FileSystemAbstraction.ReadStream(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		defer src.Close()

		name := filepath.Base(vpath)
		itemType := sharedspace.ItemTypeFile
		if sharedspace.IsImageName(name) {
			itemType = sharedspace.ItemTypeImage
		}
		item, err := space.SaveBlob(itemType, name, u.Username, agiOriginTag, src, g.Option.SharedSpaceManager.MaxUpload())
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		val, _ := vm.ToValue(item.ID)
		return val
	})

	//List the items in a space
	vm.Set("_sharedspace_listItems", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		items := space.Items()
		list := make([]map[string]interface{}, 0, len(items))
		for _, item := range items {
			list = append(list, agiDescribeItem(item))
		}
		return jsonReply(list)
	})

	//Read the content of a text item
	vm.Set("_sharedspace_getText", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		itemID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.NullValue()
		}
		item, ok := space.GetItem(itemID)
		if !ok || item.Type != sharedspace.ItemTypeText {
			return otto.NullValue()
		}
		val, _ := vm.ToValue(item.Text)
		return val
	})

	//Copy an image / file item into the calling user's storage
	vm.Set("_sharedspace_saveFileTo", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		itemID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		item, ok := space.GetItem(itemID)
		if !ok || item.DiskPath == "" {
			return otto.FalseValue()
		}
		destVpath, err := call.Argument(2).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		destVpath = static.RelativeVpathRewrite(scriptFsh, destVpath, vm, u)
		if !u.CanWrite(destVpath) {
			panic(vm.MakeCustomError("PermissionDenied", "Path access denied: "+destVpath))
		}
		fsh, rpath, err := static.VirtualPathToRealPath(destVpath, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		src, err := os.Open(item.DiskPath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		defer src.Close()
		err = fsh.FileSystemAbstraction.WriteStream(rpath, src, 0775)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Remove an item; item uploader or space owner only
	vm.Set("_sharedspace_removeItem", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		itemID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		if err := space.RemoveItem(itemID, u.Username); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Wrap the native functions into a sharedspace class
	vm.Run(`
		var sharedspace = {};
		sharedspace.createSpace = function(name){ return JSON.parse(_sharedspace_createSpace(name)); };
		sharedspace.deleteSpace = _sharedspace_deleteSpace;
		sharedspace.listMySpaces = function(){ return JSON.parse(_sharedspace_listMySpaces()); };
		sharedspace.getSpaceInfo = function(spaceid){ return JSON.parse(_sharedspace_getSpaceInfo(spaceid)); };
		sharedspace.addText = _sharedspace_addText;
		sharedspace.addFile = _sharedspace_addFile;
		sharedspace.listItems = function(spaceid){ var r = _sharedspace_listItems(spaceid); return r === null ? null : JSON.parse(r); };
		sharedspace.getText = _sharedspace_getText;
		sharedspace.saveFileTo = _sharedspace_saveFileTo;
		sharedspace.removeItem = _sharedspace_removeItem;
	`)
}
