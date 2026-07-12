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
	space is an area where multiple different users can share texts, images,
	files and collaboratively edited documents together. Spaces carry an
	access mode - "open" (the random space ID acts as the capability),
	"public" (discoverable, self-join) or "private" (members only) - plus
	a member list with owner / admin / member roles, a metadata store and
	an optional persistent flag (survives restarts). Loaded with
	requirelib("sharedspace").

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
		"spaceid":    space.ID,
		"name":       space.Name,
		"owner":      space.Owner,
		"access":     space.AccessMode(),
		"persistent": space.Persistent,
		"items":      space.ItemCount(),
		"docs":       space.DocCount(),
		"members":    space.MemberCount(),
		"metadata":   space.Metadata(),
		"createdat":  space.CreatedAt.Unix(),
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

// agiDescribeDoc renders a document snapshot for AGI scripts.
func agiDescribeDoc(doc *sharedspace.DocSnapshot, includeContent bool) map[string]interface{} {
	desc := map[string]interface{}{
		"docid":     doc.ID,
		"name":      doc.Name,
		"creator":   doc.Creator,
		"revision":  doc.Revision,
		"createdat": doc.CreatedAt.Unix(),
		"updatedat": doc.UpdatedAt.Unix(),
		"updatedby": doc.UpdatedBy,
	}
	if includeContent {
		desc["content"] = doc.Content
	}
	return desc
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

	//getSpace resolves the first argument to a live space without any
	//access check (used where the called method enforces its own ACL).
	getSpace := func(call otto.FunctionCall) (*sharedspace.Space, bool) {
		spaceID, err := call.Argument(0).ToString()
		if err != nil {
			return nil, false
		}
		return manager.GetSpace(spaceID)
	}

	//getReadableSpace additionally requires read access for the calling
	//user - private spaces stay invisible to outsiders.
	getReadableSpace := func(call otto.FunctionCall) (*sharedspace.Space, bool) {
		space, ok := getSpace(call)
		if !ok || !space.CanRead(u.Username) {
			return nil, false
		}
		return space, true
	}

	//optionalString reads an argument that may be omitted in the script.
	optionalString := func(call otto.FunctionCall, idx int) string {
		arg := call.Argument(idx)
		if !arg.IsDefined() {
			return ""
		}
		s, _ := arg.ToString()
		if s == "undefined" || s == "null" {
			return ""
		}
		return s
	}

	//Create a new open, ephemeral space owned by the calling user
	vm.Set("_sharedspace_createSpace", func(call otto.FunctionCall) otto.Value {
		name := optionalString(call, 0)
		space := manager.CreateSpace(u.Username, name)
		return jsonReply(agiDescribeSpace(space))
	})

	//Create a space with options: {access, persistent, metadata}
	vm.Set("_sharedspace_createSpaceAdvanced", func(call otto.FunctionCall) otto.Value {
		name := optionalString(call, 0)
		optionsJSON := optionalString(call, 1)
		options := struct {
			Access     string            `json:"access"`
			Persistent bool              `json:"persistent"`
			Metadata   map[string]string `json:"metadata"`
		}{}
		if optionsJSON != "" {
			json.Unmarshal([]byte(optionsJSON), &options)
		}
		space, err := manager.CreateSpaceWithOptions(u.Username, name, sharedspace.SpaceOptions{
			Access:     options.Access,
			Persistent: options.Persistent,
			Metadata:   options.Metadata,
		})
		if err != nil {
			g.RaiseError(err)
			return otto.NullValue()
		}
		return jsonReply(agiDescribeSpace(space))
	})

	//Delete a space; owner or space admin only
	vm.Set("_sharedspace_deleteSpace", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok || !space.CanManage(u.Username) {
			return otto.FalseValue()
		}
		//Give live channel subscribers the shutdown notice first
		space.Channel().Broadcast([]byte(`{"type":"space-closed"}`), -1)
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

	//List the spaces the calling user has joined (owner, admin or member)
	vm.Set("_sharedspace_listJoinedSpaces", func(call otto.FunctionCall) otto.Value {
		joined := manager.ListSpacesByMember(u.Username)
		list := make([]map[string]interface{}, 0, len(joined))
		for _, space := range joined {
			list = append(list, agiDescribeSpace(space))
		}
		return jsonReply(list)
	})

	//List every public space (the discovery directory)
	vm.Set("_sharedspace_listPublicSpaces", func(call otto.FunctionCall) otto.Value {
		public := manager.ListPublicSpaces()
		list := make([]map[string]interface{}, 0, len(public))
		for _, space := range public {
			list = append(list, agiDescribeSpace(space))
		}
		return jsonReply(list)
	})

	//Describe a space by ID
	vm.Set("_sharedspace_getSpaceInfo", func(call otto.FunctionCall) otto.Value {
		space, ok := getReadableSpace(call)
		if !ok {
			return jsonReply(map[string]interface{}{"exists": false})
		}
		desc := agiDescribeSpace(space)
		desc["exists"] = true
		role, isMember := space.Role(u.Username)
		desc["myrole"] = role
		desc["ismember"] = isMember
		return jsonReply(desc)
	})

	//Self-join a public (or open) space
	vm.Set("_sharedspace_joinSpace", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		if err := space.JoinPublic(u.Username); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Leave a space
	vm.Set("_sharedspace_leaveSpace", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		if err := space.RemoveMember(u.Username, u.Username); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Change the access mode; space managers only
	vm.Set("_sharedspace_setAccess", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		access, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		if err := space.SetAccess(u.Username, access); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Set (or with an empty value delete) a metadata entry; managers only
	vm.Set("_sharedspace_setMeta", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		key, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		value := optionalString(call, 2)
		if err := space.SetMeta(u.Username, key, value); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Read the metadata of a space
	vm.Set("_sharedspace_getMeta", func(call otto.FunctionCall) otto.Value {
		space, ok := getReadableSpace(call)
		if !ok {
			return otto.NullValue()
		}
		return jsonReply(space.Metadata())
	})

	//Invite a user; managers only
	vm.Set("_sharedspace_addMember", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		target, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		role := optionalString(call, 2)
		if role == "" {
			role = sharedspace.RoleMember
		}
		if err := space.AddMember(u.Username, target, role); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Remove a member; managers (or the member themselves)
	vm.Set("_sharedspace_removeMember", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		target, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		if err := space.RemoveMember(u.Username, target); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//List the members of a space; members and managers only
	vm.Set("_sharedspace_listMembers", func(call otto.FunctionCall) otto.Value {
		space, ok := getReadableSpace(call)
		if !ok {
			return otto.NullValue()
		}
		if _, isMember := space.Role(u.Username); !isMember && !space.CanManage(u.Username) {
			return otto.NullValue()
		}
		return jsonReply(space.Members())
	})

	//Post a text snippet into a space
	vm.Set("_sharedspace_addText", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok || !space.CanPost(u.Username) {
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
		if !ok || !space.CanPost(u.Username) {
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
		space, ok := getReadableSpace(call)
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
		space, ok := getReadableSpace(call)
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
		space, ok := getReadableSpace(call)
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

	//Remove an item; item uploader, space admin or owner only
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

	//Create a collaborative document
	vm.Set("_sharedspace_createDoc", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		name := optionalString(call, 1)
		doc, err := space.CreateDoc(u.Username, name)
		if err != nil {
			return otto.NullValue()
		}
		return jsonReply(agiDescribeDoc(doc, true))
	})

	//List documents (without contents)
	vm.Set("_sharedspace_listDocs", func(call otto.FunctionCall) otto.Value {
		space, ok := getReadableSpace(call)
		if !ok {
			return otto.NullValue()
		}
		docs := space.ListDocs()
		list := make([]map[string]interface{}, 0, len(docs))
		for _, doc := range docs {
			list = append(list, agiDescribeDoc(doc, false))
		}
		return jsonReply(list)
	})

	//Fetch one document with content
	vm.Set("_sharedspace_getDoc", func(call otto.FunctionCall) otto.Value {
		space, ok := getReadableSpace(call)
		if !ok {
			return otto.NullValue()
		}
		docID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.NullValue()
		}
		doc, ok := space.GetDoc(docID)
		if !ok {
			return otto.NullValue()
		}
		return jsonReply(agiDescribeDoc(doc, true))
	})

	//Compare-and-swap document update
	vm.Set("_sharedspace_updateDoc", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.NullValue()
		}
		docID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.NullValue()
		}
		baseRev, err := call.Argument(2).ToInteger()
		if err != nil {
			return otto.NullValue()
		}
		content, _ := call.Argument(3).ToString()

		doc, err := space.UpdateDoc(u.Username, docID, baseRev, content)
		if err == sharedspace.ErrRevisionConflict {
			current, _ := space.GetDoc(docID)
			revision := int64(0)
			if current != nil {
				revision = current.Revision
			}
			return jsonReply(map[string]interface{}{
				"ok":       false,
				"conflict": true,
				"revision": revision,
			})
		}
		if err != nil {
			return otto.NullValue()
		}
		return jsonReply(map[string]interface{}{
			"ok":       true,
			"revision": doc.Revision,
		})
	})

	//Delete a document; creator or space managers
	vm.Set("_sharedspace_deleteDoc", func(call otto.FunctionCall) otto.Value {
		space, ok := getSpace(call)
		if !ok {
			return otto.FalseValue()
		}
		docID, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		if err := space.DeleteDoc(u.Username, docID); err != nil {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	//Wrap the native functions into a sharedspace class
	vm.Run(`
		var sharedspace = {};
		sharedspace.createSpace = function(name){ return JSON.parse(_sharedspace_createSpace(name)); };
		sharedspace.createSpaceAdvanced = function(name, options){ var r = _sharedspace_createSpaceAdvanced(name, options === undefined ? "" : JSON.stringify(options)); return r === null ? null : JSON.parse(r); };
		sharedspace.deleteSpace = _sharedspace_deleteSpace;
		sharedspace.listMySpaces = function(){ return JSON.parse(_sharedspace_listMySpaces()); };
		sharedspace.listJoinedSpaces = function(){ return JSON.parse(_sharedspace_listJoinedSpaces()); };
		sharedspace.listPublicSpaces = function(){ return JSON.parse(_sharedspace_listPublicSpaces()); };
		sharedspace.getSpaceInfo = function(spaceid){ return JSON.parse(_sharedspace_getSpaceInfo(spaceid)); };
		sharedspace.joinSpace = _sharedspace_joinSpace;
		sharedspace.leaveSpace = _sharedspace_leaveSpace;
		sharedspace.setAccess = _sharedspace_setAccess;
		sharedspace.setMeta = _sharedspace_setMeta;
		sharedspace.getMeta = function(spaceid){ var r = _sharedspace_getMeta(spaceid); return r === null ? null : JSON.parse(r); };
		sharedspace.addMember = _sharedspace_addMember;
		sharedspace.removeMember = _sharedspace_removeMember;
		sharedspace.listMembers = function(spaceid){ var r = _sharedspace_listMembers(spaceid); return r === null ? null : JSON.parse(r); };
		sharedspace.addText = _sharedspace_addText;
		sharedspace.addFile = _sharedspace_addFile;
		sharedspace.listItems = function(spaceid){ var r = _sharedspace_listItems(spaceid); return r === null ? null : JSON.parse(r); };
		sharedspace.getText = _sharedspace_getText;
		sharedspace.saveFileTo = _sharedspace_saveFileTo;
		sharedspace.removeItem = _sharedspace_removeItem;
		sharedspace.createDoc = function(spaceid, name){ var r = _sharedspace_createDoc(spaceid, name); return r === null ? null : JSON.parse(r); };
		sharedspace.listDocs = function(spaceid){ var r = _sharedspace_listDocs(spaceid); return r === null ? null : JSON.parse(r); };
		sharedspace.getDoc = function(spaceid, docid){ var r = _sharedspace_getDoc(spaceid, docid); return r === null ? null : JSON.parse(r); };
		sharedspace.updateDoc = function(spaceid, docid, baserev, content){ var r = _sharedspace_updateDoc(spaceid, docid, baserev, content); return r === null ? null : JSON.parse(r); };
		sharedspace.deleteDoc = _sharedspace_deleteDoc;
	`)
}
