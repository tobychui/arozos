package iot

import (
	"encoding/json"
	"net/http"
)

/*
	assits.go
	Author: tobychui

	This script handle assistant functions for iot devices.
	The function implement here should have no effect to the core operation of the iot hub nor the iot pipeline.
*/

//Handle the set and get nickname of a particular IoT device
func (m *Manager) HandleNickName(w http.ResponseWriter, r *http.Request) {
	opr, err := mv(r, "opr", true)
	if err != nil {
		sendErrorResponse(w, "Invalid operation mode")
		return
	}

	uuid, err := mv(r, "uuid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid uuid given")
		return
	}

	//Check if the device with the given uuid exists
	deviceExist := false
	for _, dev := range m.cachedDeviceList {
		if dev.DeviceUUID == uuid {
			//Device found. Create a new object and make the pointer point to it
			deviceExist = true
		}
	}

	//Reject operation if device not exists
	if deviceExist == false {
		sendErrorResponse(w, "Target device UUID not exists")
		return
	}

	//Process the required operation
	if opr == "get" {
		if m.db.KeyExists("iot", uuid) {
			deviceNickname := ""
			err := m.db.Read("iot", uuid, &deviceNickname)
			if err != nil {
				sendErrorResponse(w, "Unable to read nickname from database")
				return
			}
			js, _ := json.Marshal(deviceNickname)
			sendJSONResponse(w, string(js))
		} else {
			sendErrorResponse(w, "Nickname not exists")
		}
	} else if opr == "set" {
		//Get name from paramter
		name, err := mv(r, "name", true)
		if err != nil {
			sendErrorResponse(w, "No nickname was given to the device")
			return
		}

		//Set the name in database
		err = m.db.Write("iot", uuid, name)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		sendOK(w)
	} else {
		sendErrorResponse(w, "Unknown operation mode")
		return
	}
}
