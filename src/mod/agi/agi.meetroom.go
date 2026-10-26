package agi

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/meetroom"
)

/*
	AGI MeetRoom Library

	Exposes the MeetRoom video conferencing room manager to AGI scripts so
	scripts can create meeting rooms, inspect and end rooms they host, and
	export the attendance log. Loaded with requirelib("meetroom") and gated
	by the caller's access permission to the MeetRoom module, mirroring the
	/system/meetroom/* HTTP endpoints.

	Every room owns a shared space (see agi.sharedspace.go): the space ID
	returned by createRoom / getRoomSpace is where the meeting's chat and
	shared files live, so scripts can read the conversation and post texts,
	images and files into a live meeting through the sharedspace library.
*/

// meetRoomModuleName is the module permission gate shared with the
// /system/meetroom/* HTTP endpoints (see prouter setup in src/meetroom.go).
const meetRoomModuleName = "MeetRoom"

func (g *Gateway) MeetRoomLibRegister() {
	err := g.RegisterLib("meetroom", g.injectMeetRoomFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

// agiDescribeRoom renders the room fields shared with AGI scripts.
// includeSpace controls whether the room's shared space ID is revealed;
// the space ID is a capability, so it is only shared with the host or a
// caller who passed the room password check.
func agiDescribeRoom(room *meetroom.Room, includeSpace bool) map[string]interface{} {
	desc := map[string]interface{}{
		"roomid":       room.ID,
		"displayid":    meetroom.FormatRoomID(room.ID),
		"title":        room.Title,
		"host":         room.Host,
		"protected":    room.HasPassword(),
		"participants": room.ParticipantCount(),
		"createdat":    room.CreatedAt.Unix(),
	}
	if includeSpace {
		desc["spaceid"] = room.SpaceID
	}
	return desc
}

// agiAttendanceList renders a room's attendance log for AGI scripts.
func agiAttendanceList(records []meetroom.AttendanceRecord) []map[string]interface{} {
	list := make([]map[string]interface{}, 0, len(records))
	for _, record := range records {
		entry := map[string]interface{}{
			"username": record.Username,
			"joinedat": record.JoinedAt.Unix(),
			"present":  record.Present(),
			"leftat":   int64(0),
		}
		if !record.Present() {
			entry["leftat"] = record.LeftAt.Unix()
		}
		list = append(list, entry)
	}
	return list
}

func (g *Gateway) injectMeetRoomFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	manager := g.Option.MeetRoomManager
	if manager == nil || u == nil {
		return
	}

	//The caller needs the same module permission the HTTP endpoints require
	if !u.GetModuleAccessPermission(meetRoomModuleName) {
		return
	}

	//jsonReply marshals v and hands it to the VM as a JSON string; the JS
	//wrapper below parses it back into an object.
	jsonReply := func(v interface{}) otto.Value {
		js, err := json.Marshal(v)
		if err != nil {
			return otto.NullValue()
		}
		val, _ := vm.ToValue(string(js))
		return val
	}

	//optionalString reads an argument that may be omitted in the script.
	optionalString := func(call otto.FunctionCall, idx int) string {
		arg := call.Argument(idx)
		if !arg.IsDefined() {
			return ""
		}
		s, _ := arg.ToString()
		return s
	}

	//Create a meeting room hosted by the calling user
	vm.Set("_meetroom_createRoom", func(call otto.FunctionCall) otto.Value {
		title := optionalString(call, 0)
		password := optionalString(call, 1)
		room := manager.CreateRoom(u.Username, title, password)
		return jsonReply(agiDescribeRoom(room, true))
	})

	//Public probe: does the room exist and is it protected
	vm.Set("_meetroom_getRoomInfo", func(call otto.FunctionCall) otto.Value {
		roomID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}
		room, ok := manager.GetRoom(meetroom.NormalizeRoomID(roomID))
		if !ok {
			return jsonReply(map[string]interface{}{"exists": false})
		}
		desc := agiDescribeRoom(room, room.Host == u.Username)
		desc["exists"] = true
		return jsonReply(desc)
	})

	//Reveal the room's shared space ID to callers who pass the password
	//check (the same gate the join endpoint applies)
	vm.Set("_meetroom_getRoomSpace", func(call otto.FunctionCall) otto.Value {
		roomID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}
		password := optionalString(call, 1)
		room, err := manager.ValidateJoin(meetroom.NormalizeRoomID(roomID), password)
		if err != nil {
			return otto.NullValue()
		}
		if room.SpaceID == "" {
			return otto.NullValue()
		}
		val, _ := vm.ToValue(room.SpaceID)
		return val
	})

	//List the live rooms hosted by the calling user
	vm.Set("_meetroom_listMyRooms", func(call otto.FunctionCall) otto.Value {
		hosted := manager.ListRoomsByHost(u.Username)
		list := make([]map[string]interface{}, 0, len(hosted))
		for _, room := range hosted {
			list = append(list, agiDescribeRoom(room, true))
		}
		return jsonReply(list)
	})

	//End a meeting for everyone; host only
	vm.Set("_meetroom_endRoom", func(call otto.FunctionCall) otto.Value {
		roomID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		room, ok := manager.GetRoom(meetroom.NormalizeRoomID(roomID))
		if !ok || room.Host != u.Username {
			return otto.FalseValue()
		}
		room.Broadcast([]byte(`{"type":"room-closed"}`), -1)
		manager.CloseRoom(room.ID)
		return otto.TrueValue()
	})

	//Export the attendance log; host or a connected participant only
	vm.Set("_meetroom_getAttendance", func(call otto.FunctionCall) otto.Value {
		roomID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.NullValue()
		}
		room, ok := manager.GetRoom(meetroom.NormalizeRoomID(roomID))
		if !ok {
			return otto.NullValue()
		}
		if room.Host != u.Username && !room.HasParticipantUsername(u.Username) {
			return otto.NullValue()
		}
		return jsonReply(agiAttendanceList(room.Attendance()))
	})

	//Wrap the native functions into a meetroom class
	vm.Run(`
		var meetroom = {};
		meetroom.createRoom = function(title, password){ return JSON.parse(_meetroom_createRoom(title, password)); };
		meetroom.getRoomInfo = function(roomid){ var r = _meetroom_getRoomInfo(roomid); return r === null ? null : JSON.parse(r); };
		meetroom.getRoomSpace = _meetroom_getRoomSpace;
		meetroom.listMyRooms = function(){ return JSON.parse(_meetroom_listMyRooms()); };
		meetroom.endRoom = _meetroom_endRoom;
		meetroom.getAttendance = function(roomid){ var r = _meetroom_getAttendance(roomid); return r === null ? null : JSON.parse(r); };
	`)
}
