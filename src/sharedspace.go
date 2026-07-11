package main

/*
	SharedSpace - Collaboration backbone endpoints
	author: tobychui / AI assisted

	HTTP + WebSocket wiring for mod/sharedspace, the ArozOS collaboration
	backbone: multi-user spaces holding chat texts, images, files and
	revision-synced collaborative documents, with open / public / private
	access control, optional persistence and a realtime channel per space.
	MeetRoom runs its meeting signaling over the same channels.

	User endpoints (login required; the space ACL is the authorization
	layer - see mod/sharedspace/access.go):

	  POST /system/sharedspace/create        name=&access=&persistent=
	  POST /system/sharedspace/delete        spaceid=            (manage)
	  GET  /system/sharedspace/info?spaceid=
	  GET  /system/sharedspace/list                              (joined)
	  GET  /system/sharedspace/listpublic
	  POST /system/sharedspace/join          spaceid=
	  POST /system/sharedspace/leave         spaceid=
	  POST /system/sharedspace/members/add   spaceid=&username=&role=
	  POST /system/sharedspace/members/remove spaceid=&username=
	  POST /system/sharedspace/members/role  spaceid=&username=&role=
	  POST /system/sharedspace/access        spaceid=&access=
	  POST /system/sharedspace/meta          spaceid=&key=&value=
	  GET  /system/sharedspace/items?spaceid=
	  POST /system/sharedspace/addtext       spaceid=&text=
	  POST /system/sharedspace/upload        multipart (spaceid, file)
	  GET  /system/sharedspace/download?spaceid=&itemid=[&inline=1]
	  POST /system/sharedspace/removeitem    spaceid=&itemid=
	  POST /system/sharedspace/doc/create    spaceid=&name=
	  GET  /system/sharedspace/doc/list?spaceid=
	  GET  /system/sharedspace/doc/get?spaceid=&docid=
	  POST /system/sharedspace/doc/update    spaceid=&docid=&baserev=&content=
	  POST /system/sharedspace/doc/delete    spaceid=&docid=
	  GET  /system/sharedspace/ws?spaceid=   WebSocket upgrade

	Admin endpoints (System Settings > Shared Spaces):

	  GET  /system/sharedspace/admin/list
	  POST /system/sharedspace/admin/delete     spaceid=
	  GET  /system/sharedspace/admin/config
	  POST /system/sharedspace/admin/setconfig  maxupload=&maxitems=&allowpersistent=&retentiondays=

	WebSocket protocol (JSON frames over /system/sharedspace/ws):
	  client -> server: {"type":"signal","to":subid,"data":{...}}  ephemeral relay (WebRTC etc.)
	                    {"type":"broadcast","data":{...}}          ephemeral fan-out to peers
	                    {"type":"chat","text":"..."}               persisted text item
	                    {"type":"doc-update","docid":"..","baserev":n,"content":".."}
	                    {"type":"ping"}                            app-level heartbeat
	  server -> client: {"type":"welcome","subid":n,"username":u,"space":{...},"peers":[...]}
	                    {"type":"peer-join","peer":{...}} / {"type":"peer-leave","subid":n,"username":u}
	                    {"type":"signal","from":n,"data":{...}}
	                    {"type":"broadcast","from":n,"username":u,"data":{...}}
	                    {"type":"item","item":{...}} / {"type":"item-removed","itemid":i}
	                    {"type":"doc","docid":d,"revision":r,"by":u,"patch":{pos,del,ins}}
	                    {"type":"doc-created","doc":{...}} / {"type":"doc-deleted","docid":d}
	                    {"type":"doc-conflict","docid":d,"revision":r}   sender only
	                    {"type":"member","action":a,"username":u,"role":r}
	                    {"type":"error","error":"..."}                   sender only
	                    {"type":"pong"}, {"type":"space-closed"}

	Ephemeral frames (signal / broadcast) fan out through the space channel
	and are never persisted; chat and documents write through the space so
	AGI scripts and, on meeting spaces, MeetRoom clients see them too. A
	client that receives a doc revision gap re-fetches with doc/get - the
	server content is always authoritative. Document saves should be
	debounced client-side (~500ms); every accepted revision is one database
	write.
*/

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/sharedspace"
	"imuslab.com/arozos/mod/utils"
)

const (
	ssMaxChatLength  = 4000             // runes per chat message over the ws
	ssMaxSocketFrame = 512 << 10        // 512KB per ws frame (doc contents included)
	ssPingInterval   = 20 * time.Second // server keepalive ping cadence
	ssReadTimeout    = 60 * time.Second // drop a subscriber whose socket goes silent this long
	ssWriteTimeout   = 10 * time.Second // per-frame write deadline
	ssSweepInterval  = 1 * time.Hour    // retention sweep cadence

	//Admin configuration keys, stored in the sharedspace table next to the
	//space records (see mod/sharedspace/persistence.go for the layout)
	ssDBTable             = "sharedspace"
	ssConfMaxUpload       = "conf/maxupload"
	ssConfMaxItems        = "conf/maxitems"
	ssConfAllowPersistent = "conf/allowpersistent"
	ssConfRetentionDays   = "conf/retentiondays"
)

var (
	sharedSpaceManager *sharedspace.Manager
	ssUpgrader         = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}
)

/* ================= Configuration helpers ================= */

// ssConfInt64 reads an integer admin setting, falling back when unset or
// out of range.
func ssConfInt64(key string, fallback int64) int64 {
	if sysdb == nil || !sysdb.KeyExists(ssDBTable, key) {
		return fallback
	}
	value := int64(0)
	sysdb.Read(ssDBTable, key, &value)
	if value <= 0 {
		return fallback
	}
	return value
}

// ssConfBool reads a boolean admin setting, falling back when unset.
func ssConfBool(key string, fallback bool) bool {
	if sysdb == nil || !sysdb.KeyExists(ssDBTable, key) {
		return fallback
	}
	value := fallback
	sysdb.Read(ssDBTable, key, &value)
	return value
}

/* ================= Descriptors ================= */

// ssDescribeSpace renders the space fields shared with clients. When a
// username is given the caller's own role is included.
func ssDescribeSpace(space *sharedspace.Space, username string) map[string]interface{} {
	desc := map[string]interface{}{
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
	if username != "" {
		role, isMember := space.Role(username)
		desc["myrole"] = role
		desc["ismember"] = isMember
	}
	return desc
}

// ssDescribeItem renders a space item for clients.
func ssDescribeItem(item *sharedspace.Item) map[string]interface{} {
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

// ssDescribeDoc renders a document snapshot for clients. includeContent
// controls whether the body travels with it.
func ssDescribeDoc(doc *sharedspace.DocSnapshot, includeContent bool) map[string]interface{} {
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

/* ================= Request helpers ================= */

// ssRequestParam reads a request parameter from POST form or query string
// depending on the endpoint's method convention.
func ssRequestParam(r *http.Request, post bool, key string) (string, error) {
	if post {
		return utils.PostPara(r, key)
	}
	return utils.GetPara(r, key)
}

// ssResolveSpaceRequest authenticates the caller and resolves the spaceid
// parameter to a live space the caller may read. On failure the error
// response is already written and ok is false.
func ssResolveSpaceRequest(w http.ResponseWriter, r *http.Request, post bool) (username string, space *sharedspace.Space, ok bool) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "Not logged in")
		return "", nil, false
	}
	spaceID, err := ssRequestParam(r, post, "spaceid")
	if err != nil {
		utils.SendErrorResponse(w, "Missing space ID")
		return "", nil, false
	}
	space, exists := sharedSpaceManager.GetSpace(spaceID)
	if !exists || !space.CanRead(userinfo.Username) {
		//Private spaces are indistinguishable from missing ones to outsiders
		utils.SendErrorResponse(w, "Space not found")
		return "", nil, false
	}
	return userinfo.Username, space, true
}

// ssCloseSpace announces the shutdown to live subscribers and deletes the
// space (used by the user delete endpoint and the admin surface).
func ssCloseSpace(spaceID string) {
	space, ok := sharedSpaceManager.GetSpace(spaceID)
	if !ok {
		return
	}
	space.Channel().Broadcast([]byte(`{"type":"space-closed"}`), -1)
	sharedSpaceManager.DeleteSpace(spaceID)
}

// ssBroadcastSpaceEvent builds the event listener that fans space mutations
// out to the space's channel as protocol frames. Registered once per space
// under a fixed key, so repeated registration is idempotent.
func ssBroadcastSpaceEvent(space *sharedspace.Space) func(*sharedspace.SpaceEvent) {
	channel := space.Channel()
	return func(event *sharedspace.SpaceEvent) {
		var frame []byte
		switch event.Kind {
		case sharedspace.EventItemAdded:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type": "item",
				"item": ssDescribeItem(event.Item),
			})
		case sharedspace.EventItemRemoved:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type":   "item-removed",
				"itemid": event.Item.ID,
			})
		case sharedspace.EventDocCreated:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type": "doc-created",
				"doc":  ssDescribeDoc(event.Doc, false),
			})
		case sharedspace.EventDocUpdated:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type":     "doc",
				"docid":    event.Doc.ID,
				"revision": event.Doc.Revision,
				"by":       event.Doc.UpdatedBy,
				"patch": map[string]interface{}{
					"pos": event.Patch.Pos,
					"del": event.Patch.Del,
					"ins": event.Patch.Ins,
				},
			})
		case sharedspace.EventDocDeleted:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type":  "doc-deleted",
				"docid": event.Doc.ID,
			})
		case sharedspace.EventMemberChanged:
			frame = mrMarshalOrDrop(map[string]interface{}{
				"type":     "member",
				"action":   event.Action,
				"username": event.Member,
				"role":     event.Role,
			})
		}
		if frame != nil {
			channel.Broadcast(frame, -1)
		}
	}
}

// SharedSpaceInit creates the system-wide shared collaboration space manager
// and wires up its HTTP / WebSocket endpoints and the admin surface.
// Must be initiated before MeetRoomInit and AGIInit (see startup.go).
func SharedSpaceInit() {
	sharedSpaceManager = sharedspace.NewManagerWithOptions(sharedspace.ManagerOptions{
		PersistentRoot:  filepath.Join("system", "sharedspace"),
		Database:        sysdb,
		MaxUpload:       ssConfInt64(ssConfMaxUpload, sharedspace.DefaultMaxUpload),
		DefaultMaxItems: int(ssConfInt64(ssConfMaxItems, sharedspace.DefaultMaxItems)),
	})
	sharedSpaceManager.SetAllowPersistent(ssConfBool(ssConfAllowPersistent, true))

	//Retention: periodically remove persistent spaces idle for longer than
	//the admin-configured retention window (0 disables the sweep)
	go func() {
		ticker := time.NewTicker(ssSweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			retentionDays := ssConfInt64(ssConfRetentionDays, 0)
			if retentionDays > 0 {
				sharedSpaceManager.SweepStaleSpaces(time.Duration(retentionDays) * 24 * time.Hour)
			}
		}
	}()

	//User endpoints: login-only universal router. Spaces carry their own
	//access control (open capability / public / private membership), which
	//is the authorization layer for everything below.
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	//Create a new space; the creator becomes the owner.
	router.HandleFunc("/system/sharedspace/create", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		name, _ := utils.PostPara(r, "name")
		access, _ := utils.PostPara(r, "access")
		persistent, _ := utils.PostPara(r, "persistent")

		space, err := sharedSpaceManager.CreateSpaceWithOptions(userinfo.Username, name, sharedspace.SpaceOptions{
			Access:     access,
			Persistent: persistent == "true",
		})
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(ssDescribeSpace(space, userinfo.Username))
		utils.SendJSONResponse(w, string(js))
	})

	//Delete a space; space managers only.
	router.HandleFunc("/system/sharedspace/delete", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		if !space.CanManage(username) {
			utils.SendErrorResponse(w, "Permission denied")
			return
		}
		ssCloseSpace(space.ID)
		utils.SendOK(w)
	})

	//Describe one space.
	router.HandleFunc("/system/sharedspace/info", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, false)
		if !ok {
			return
		}
		desc := ssDescribeSpace(space, username)
		//The member list is only revealed to members and managers
		if _, isMember := space.Role(username); isMember || space.CanManage(username) {
			desc["memberlist"] = space.Members()
		}
		js := mrMarshalOrDrop(desc)
		utils.SendJSONResponse(w, string(js))
	})

	//List the spaces the caller has joined (or owns).
	router.HandleFunc("/system/sharedspace/list", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		joined := sharedSpaceManager.ListSpacesByMember(userinfo.Username)
		list := make([]map[string]interface{}, 0, len(joined))
		for _, space := range joined {
			list = append(list, ssDescribeSpace(space, userinfo.Username))
		}
		js := mrMarshalOrDrop(list)
		utils.SendJSONResponse(w, string(js))
	})

	//List every public space (the discovery directory).
	router.HandleFunc("/system/sharedspace/listpublic", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		public := sharedSpaceManager.ListPublicSpaces()
		list := make([]map[string]interface{}, 0, len(public))
		for _, space := range public {
			list = append(list, ssDescribeSpace(space, userinfo.Username))
		}
		js := mrMarshalOrDrop(list)
		utils.SendJSONResponse(w, string(js))
	})

	//Self-join a public (or open) space.
	router.HandleFunc("/system/sharedspace/join", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		if err := space.JoinPublic(username); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Leave a space.
	router.HandleFunc("/system/sharedspace/leave", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		if err := space.RemoveMember(username, username); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Invite a user into the space; managers only.
	router.HandleFunc("/system/sharedspace/members/add", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		target, err := utils.PostPara(r, "username")
		if err != nil {
			utils.SendErrorResponse(w, "Missing username")
			return
		}
		role, _ := utils.PostPara(r, "role")
		if role == "" {
			role = sharedspace.RoleMember
		}
		//The invitee must be a real user on this host
		if _, err := userHandler.GetUserInfoFromUsername(target); err != nil {
			utils.SendErrorResponse(w, "User not found")
			return
		}
		if err := space.AddMember(username, target, role); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Remove a member; managers (or the member themselves) only.
	router.HandleFunc("/system/sharedspace/members/remove", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		target, err := utils.PostPara(r, "username")
		if err != nil {
			utils.SendErrorResponse(w, "Missing username")
			return
		}
		if err := space.RemoveMember(username, target); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Change a member's role; managers only.
	router.HandleFunc("/system/sharedspace/members/role", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		target, err := utils.PostPara(r, "username")
		if err != nil {
			utils.SendErrorResponse(w, "Missing username")
			return
		}
		role, err := utils.PostPara(r, "role")
		if err != nil {
			utils.SendErrorResponse(w, "Missing role")
			return
		}
		if err := space.SetMemberRole(username, target, role); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Change the access mode; managers only.
	router.HandleFunc("/system/sharedspace/access", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		access, err := utils.PostPara(r, "access")
		if err != nil {
			utils.SendErrorResponse(w, "Missing access mode")
			return
		}
		if err := space.SetAccess(username, access); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Set (or with an empty value delete) a metadata entry; managers only.
	router.HandleFunc("/system/sharedspace/meta", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		key, err := utils.PostPara(r, "key")
		if err != nil {
			utils.SendErrorResponse(w, "Missing key")
			return
		}
		value, _ := utils.PostPara(r, "value")
		if err := space.SetMeta(username, key, value); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//List the items in a space.
	router.HandleFunc("/system/sharedspace/items", func(w http.ResponseWriter, r *http.Request) {
		_, space, ok := ssResolveSpaceRequest(w, r, false)
		if !ok {
			return
		}
		items := space.Items()
		list := make([]map[string]interface{}, 0, len(items))
		for _, item := range items {
			list = append(list, ssDescribeItem(item))
		}
		js := mrMarshalOrDrop(list)
		utils.SendJSONResponse(w, string(js))
	})

	//Post a text snippet.
	router.HandleFunc("/system/sharedspace/addtext", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		text, err := utils.PostPara(r, "text")
		if err != nil {
			utils.SendErrorResponse(w, "Missing text")
			return
		}
		item, err := space.AddText(username, text, "http")
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{"itemid": item.ID})
		utils.SendJSONResponse(w, string(js))
	})

	//Upload a file / image into the space.
	router.HandleFunc("/system/sharedspace/upload", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			utils.SendErrorResponse(w, "Invalid upload")
			return
		}
		space, exists := sharedSpaceManager.GetSpace(r.FormValue("spaceid"))
		if !exists || !space.CanPost(userinfo.Username) {
			utils.SendErrorResponse(w, "Space not found")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			utils.SendErrorResponse(w, "Missing file")
			return
		}
		defer file.Close()

		itemType := sharedspace.ItemTypeFile
		if sharedspace.IsImageName(header.Filename) {
			itemType = sharedspace.ItemTypeImage
		}
		item, err := space.SaveBlob(itemType, header.Filename, userinfo.Username, "http", file, sharedSpaceManager.MaxUpload())
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{
			"itemid": item.ID,
			"name":   item.Name,
			"size":   item.Size,
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Download an item blob. inline=1 serves raster images for in-browser
	//display; everything else (notably SVG, which can carry scripts) keeps
	//the attachment disposition.
	router.HandleFunc("/system/sharedspace/download", func(w http.ResponseWriter, r *http.Request) {
		_, space, ok := ssResolveSpaceRequest(w, r, false)
		if !ok {
			return
		}
		itemID, err := utils.GetPara(r, "itemid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing item ID")
			return
		}
		item, exists := space.GetItem(itemID)
		if !exists || item.DiskPath == "" {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(item.DiskPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()

		//Serve with the original name; the ASCII fallback strips anything
		//that could break the header, the RFC 5987 form keeps unicode names.
		fallback := strings.Map(func(c rune) rune {
			if c < 32 || c == '"' || c == '\\' || c > 126 {
				return '_'
			}
			return c
		}, item.Name)
		disposition := "attachment"
		if r.URL.Query().Get("inline") == "1" && sharedspace.IsImageName(item.Name) {
			disposition = "inline"
		}
		w.Header().Set("Content-Disposition", disposition+"; filename=\""+fallback+"\"; filename*=UTF-8''"+url.PathEscape(item.Name))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if ctype := mime.TypeByExtension(strings.ToLower(filepathExt(item.Name))); ctype != "" {
			w.Header().Set("Content-Type", ctype)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		http.ServeContent(w, r, "", time.Now(), f)
	})

	//Remove an item; uploader, space managers or the system.
	router.HandleFunc("/system/sharedspace/removeitem", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		itemID, err := utils.PostPara(r, "itemid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing item ID")
			return
		}
		if err := space.RemoveItem(itemID, username); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//Create a collaborative document.
	router.HandleFunc("/system/sharedspace/doc/create", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		name, _ := utils.PostPara(r, "name")
		doc, err := space.CreateDoc(username, name)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(ssDescribeDoc(doc, true))
		utils.SendJSONResponse(w, string(js))
	})

	//List documents (without contents).
	router.HandleFunc("/system/sharedspace/doc/list", func(w http.ResponseWriter, r *http.Request) {
		_, space, ok := ssResolveSpaceRequest(w, r, false)
		if !ok {
			return
		}
		docs := space.ListDocs()
		list := make([]map[string]interface{}, 0, len(docs))
		for _, doc := range docs {
			list = append(list, ssDescribeDoc(doc, false))
		}
		js := mrMarshalOrDrop(list)
		utils.SendJSONResponse(w, string(js))
	})

	//Fetch one document with content (also the conflict recovery path).
	router.HandleFunc("/system/sharedspace/doc/get", func(w http.ResponseWriter, r *http.Request) {
		_, space, ok := ssResolveSpaceRequest(w, r, false)
		if !ok {
			return
		}
		docID, err := utils.GetPara(r, "docid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing document ID")
			return
		}
		doc, exists := space.GetDoc(docID)
		if !exists {
			utils.SendErrorResponse(w, "Document not found")
			return
		}
		js := mrMarshalOrDrop(ssDescribeDoc(doc, true))
		utils.SendJSONResponse(w, string(js))
	})

	//Compare-and-swap document update over HTTP.
	router.HandleFunc("/system/sharedspace/doc/update", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		docID, err := utils.PostPara(r, "docid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing document ID")
			return
		}
		baseRevStr, err := utils.PostPara(r, "baserev")
		if err != nil {
			utils.SendErrorResponse(w, "Missing base revision")
			return
		}
		baseRev, err := strconv.ParseInt(baseRevStr, 10, 64)
		if err != nil {
			utils.SendErrorResponse(w, "Invalid base revision")
			return
		}
		content, _ := utils.PostPara(r, "content")

		doc, err := space.UpdateDoc(username, docID, baseRev, content)
		if err == sharedspace.ErrRevisionConflict {
			//Report the current revision so the client can re-fetch + rebase
			current, _ := space.GetDoc(docID)
			revision := int64(0)
			if current != nil {
				revision = current.Revision
			}
			js := mrMarshalOrDrop(map[string]interface{}{
				"error":    "revision conflict",
				"revision": revision,
			})
			utils.SendJSONResponse(w, string(js))
			return
		}
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{
			"ok":       true,
			"revision": doc.Revision,
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Delete a document; creator or space managers.
	router.HandleFunc("/system/sharedspace/doc/delete", func(w http.ResponseWriter, r *http.Request) {
		username, space, ok := ssResolveSpaceRequest(w, r, true)
		if !ok {
			return
		}
		docID, err := utils.PostPara(r, "docid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing document ID")
			return
		}
		if err := space.DeleteDoc(username, docID); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	})

	//WebSocket: realtime bidirectional exchange on a space.
	router.HandleFunc("/system/sharedspace/ws", ssHandleWebSocket)

	//Admin surface: System Settings > Shared Spaces
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	//Enumerate every space with usage figures.
	adminRouter.HandleFunc("/system/sharedspace/admin/list", func(w http.ResponseWriter, r *http.Request) {
		all := sharedSpaceManager.ListSpaces()
		list := make([]map[string]interface{}, 0, len(all))
		for _, space := range all {
			desc := ssDescribeSpace(space, "")
			desc["subscribers"] = space.Channel().Count()
			desc["diskusage"] = sharedSpaceManager.SpaceDiskUsage(space.ID)
			list = append(list, desc)
		}
		js := mrMarshalOrDrop(list)
		utils.SendJSONResponse(w, string(js))
	})

	//Delete any space with system authority.
	adminRouter.HandleFunc("/system/sharedspace/admin/delete", func(w http.ResponseWriter, r *http.Request) {
		spaceID, err := utils.PostPara(r, "spaceid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing space ID")
			return
		}
		if _, exists := sharedSpaceManager.GetSpace(spaceID); !exists {
			utils.SendErrorResponse(w, "Space not found")
			return
		}
		ssCloseSpace(spaceID)
		utils.SendOK(w)
	})

	//Current admin configuration.
	adminRouter.HandleFunc("/system/sharedspace/admin/config", func(w http.ResponseWriter, r *http.Request) {
		js := mrMarshalOrDrop(map[string]interface{}{
			"maxupload":       sharedSpaceManager.MaxUpload(),
			"maxitems":        sharedSpaceManager.DefaultItemLimit(),
			"allowpersistent": sharedSpaceManager.PersistenceAvailable(),
			"retentiondays":   ssConfInt64(ssConfRetentionDays, 0),
			"spaces":          sharedSpaceManager.SpaceCount(),
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Update the admin configuration (persisted; applied live).
	adminRouter.HandleFunc("/system/sharedspace/admin/setconfig", func(w http.ResponseWriter, r *http.Request) {
		if maxUpload, err := utils.PostPara(r, "maxupload"); err == nil {
			if value, err := strconv.ParseInt(maxUpload, 10, 64); err == nil && value > 0 {
				sysdb.Write(ssDBTable, ssConfMaxUpload, value)
				sharedSpaceManager.SetMaxUpload(value)
			}
		}
		if maxItems, err := utils.PostPara(r, "maxitems"); err == nil {
			if value, err := strconv.Atoi(maxItems); err == nil && value > 0 {
				sysdb.Write(ssDBTable, ssConfMaxItems, int64(value))
				sharedSpaceManager.SetDefaultItemLimit(value)
			}
		}
		if allowPersistent, err := utils.PostPara(r, "allowpersistent"); err == nil {
			enabled := allowPersistent == "true"
			sysdb.Write(ssDBTable, ssConfAllowPersistent, enabled)
			sharedSpaceManager.SetAllowPersistent(enabled)
		}
		if retentionDays, err := utils.PostPara(r, "retentiondays"); err == nil {
			if value, err := strconv.ParseInt(retentionDays, 10, 64); err == nil && value >= 0 {
				sysdb.Write(ssDBTable, ssConfRetentionDays, value)
			}
		}
		utils.SendOK(w)
	})

	//Settings tile in System Settings
	registerSetting(settingModule{
		Name:         "Shared Spaces",
		Desc:         "Collaboration spaces: storage, limits and cleanup",
		IconPath:     "SystemAO/system_setting/img/module.svg",
		Group:        "Advance",
		StartDir:     "SystemAO/sharedspace/spaces.html",
		RequireAdmin: true,
	})
}

// ssHandleWebSocket upgrades the request and joins the caller to the
// space's realtime channel.
func ssHandleWebSocket(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		http.Error(w, "Not logged in", http.StatusUnauthorized)
		return
	}
	username := userinfo.Username
	space, exists := sharedSpaceManager.GetSpace(r.URL.Query().Get("spaceid"))
	if !exists || !space.CanRead(username) {
		http.Error(w, "Space not found", http.StatusForbidden)
		return
	}

	conn, err := ssUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(ssMaxSocketFrame)

	//Liveness: a client that goes silent (no frames and no pong replies)
	//past ssReadTimeout is dropped so it does not linger as a ghost.
	conn.SetReadDeadline(time.Now().Add(ssReadTimeout))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(ssReadTimeout))
		return nil
	})

	channel := space.Channel()
	sub, err := channel.Join(username)
	if err != nil {
		conn.Close()
		return
	}

	//Fan space mutations out to this channel as protocol frames. The fixed
	//key makes re-registration on every connection idempotent.
	space.SubscribeEvents("wstransport", ssBroadcastSpaceEvent(space))

	//Writer: drain the send buffer until it is closed, interleaving
	//keepalive pings, then hang up.
	go func() {
		pinger := time.NewTicker(ssPingInterval)
		defer pinger.Stop()
		defer conn.Close()
		for {
			select {
			case msg, ok := <-sub.Send:
				if !ok {
					return
				}
				conn.SetWriteDeadline(time.Now().Add(ssWriteTimeout))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-pinger.C:
				conn.SetWriteDeadline(time.Now().Add(ssWriteTimeout))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	//Welcome frame: own identity, space descriptor and current peers.
	peers := []map[string]interface{}{}
	for _, peer := range channel.Subscribers() {
		if peer.ID == sub.ID {
			continue
		}
		peers = append(peers, map[string]interface{}{"subid": peer.ID, "username": peer.Username})
	}
	channel.SendTo(sub.ID, mrMarshalOrDrop(map[string]interface{}{
		"type":     "welcome",
		"subid":    sub.ID,
		"username": username,
		"space":    ssDescribeSpace(space, username),
		"peers":    peers,
	}))

	//Announce the newcomer to everyone else.
	channel.Broadcast(mrMarshalOrDrop(map[string]interface{}{
		"type": "peer-join",
		"peer": map[string]interface{}{"subid": sub.ID, "username": username},
	}), sub.ID)

	defer func() {
		channel.Leave(sub.ID)
		channel.Broadcast(mrMarshalOrDrop(map[string]interface{}{
			"type":     "peer-leave",
			"subid":    sub.ID,
			"username": username,
		}), -1)
	}()

	sendError := func(message string) {
		channel.SendTo(sub.ID, mrMarshalOrDrop(map[string]interface{}{
			"type":  "error",
			"error": message,
		}))
	}

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(ssReadTimeout))
		var frame struct {
			Type    string          `json:"type"`
			To      int             `json:"to"`
			Data    json.RawMessage `json:"data"`
			Text    string          `json:"text"`
			DocID   string          `json:"docid"`
			BaseRev int64           `json:"baserev"`
			Content string          `json:"content"`
		}
		if json.Unmarshal(raw, &frame) != nil {
			continue
		}

		switch frame.Type {
		case "signal":
			//Ephemeral point-to-point relay (WebRTC SDP/ICE and friends)
			channel.SendTo(frame.To, mrMarshalOrDrop(map[string]interface{}{
				"type": "signal",
				"from": sub.ID,
				"data": frame.Data,
			}))
		case "broadcast":
			//Ephemeral application fan-out to every other subscriber
			channel.Broadcast(mrMarshalOrDrop(map[string]interface{}{
				"type":     "broadcast",
				"from":     sub.ID,
				"username": username,
				"data":     frame.Data,
			}), sub.ID)
		case "chat":
			text := frame.Text
			if strings.TrimSpace(text) == "" {
				continue
			}
			if runes := []rune(text); len(runes) > ssMaxChatLength {
				text = string(runes[:ssMaxChatLength])
			}
			//Persisted: delivery to every subscriber happens through the
			//item-added event fan-out (no double send)
			if _, err := space.AddText(username, text, "ws"); err != nil {
				sendError(err.Error())
			}
		case "doc-update":
			_, err := space.UpdateDoc(username, frame.DocID, frame.BaseRev, frame.Content)
			if err == sharedspace.ErrRevisionConflict {
				current, _ := space.GetDoc(frame.DocID)
				revision := int64(0)
				if current != nil {
					revision = current.Revision
				}
				channel.SendTo(sub.ID, mrMarshalOrDrop(map[string]interface{}{
					"type":     "doc-conflict",
					"docid":    frame.DocID,
					"revision": revision,
				}))
			} else if err != nil {
				sendError(err.Error())
			}
			//Success needs no direct reply: the doc-updated event fan-out
			//delivers the accepted patch (with the new revision) to
			//everyone, the sender included.
		case "ping":
			channel.SendTo(sub.ID, []byte(`{"type":"pong"}`))
		}
	}
}
