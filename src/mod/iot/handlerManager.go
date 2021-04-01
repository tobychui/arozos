package iot

import (
	"encoding/json"
	"log"
	"net/http"
)

/*
	IoT Handler Manager
	Author: tobychui

	This manager mange all the existsing / registered ioT Manager.
	This allow a much more abstract usage in the main code

*/

type Manager struct {
	RegisteredHandler []ProtocolHandler
	cachedDeviceList  []*Device
}

func NewIoTManager() *Manager {
	return &Manager{
		RegisteredHandler: []ProtocolHandler{},
	}
}

//Register the handler as one of the IoT Protocol Handler.
func (m *Manager) RegisterHandler(h ProtocolHandler) error {
	//Try to start the handler
	err := h.Start()
	if err != nil {
		//Handler startup failed
		log.Println("*IoT* Protocol Handler Startup Failed: ", err.Error())
		return err
	}

	//Add it to the handlers
	m.RegisteredHandler = append(m.RegisteredHandler, h)
	return nil
}

//Handle listing of all avaible scanner and its stats
func (m *Manager) HandleScannerList(w http.ResponseWriter, r *http.Request) {
	stats := []Stats{}
	for _, scanner := range m.RegisteredHandler {
		thisScannerStat := scanner.Stats()
		stats = append(stats, thisScannerStat)
	}

	js, _ := json.Marshal(stats)
	sendJSONResponse(w, string(js))
}

//Get the device object by id
func (m *Manager) GetDeviceByID(devid string) *Device {
	for _, dev := range m.cachedDeviceList {
		if dev.DeviceUUID == devid {
			return dev
		}
	}
	return nil
}

//Handle listing of all avaible scanner and its stats
func (m *Manager) HandleIconLoad(w http.ResponseWriter, r *http.Request) {
	devid, err := mv(r, "devid", false)
	if err != nil {
		sendErrorResponse(w, "Invalid device id")
		return
	}

	//Get device icon from handler
	targetDevice := m.GetDeviceByID(devid)
	iconName := targetDevice.Handler.Icon(targetDevice)

	iconFilePath := "./web/SystemAO/iot/hub/img/devices/" + iconName + ".png"
	if fileExists(iconFilePath) {
		http.ServeFile(w, r, iconFilePath)
	} else {
		http.ServeFile(w, r, "./web/SystemAO/iot/hub/img/devices/unknown.png")
	}
}

//Handle listing of all avaible scanner and its stats
func (m *Manager) HandleExecute(w http.ResponseWriter, r *http.Request) {
	devid, err := mv(r, "devid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid device id")
		return
	}

	eptname, err := mv(r, "eptname", true)
	if err != nil {
		sendErrorResponse(w, "Invalid endpoint name")
		return
	}

	payload, _ := mv(r, "payload", true)

	//Get device by device id
	dev := m.GetDeviceByID(devid)
	if dev == nil {
		sendErrorResponse(w, "Given device id not found")
		return
	}

	//Get its endpoint
	var targetEndpoint Endpoint
	for _, ept := range dev.ControlEndpoints {
		if ept.Name == eptname {
			//This is the endpoint we are looking for
			targetEndpoint = *ept
			break
		}
	}

	//log.Println(dev.IPAddr, targetEndpoint, payload)

	//Send request to the target IoT device
	result, err := dev.Handler.Execute(dev, &targetEndpoint, payload)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(result)
	sendJSONResponse(w, string(js))
}

//Get status of the given device ID
func (m *Manager) HandleGetDeviceStatus(w http.ResponseWriter, r *http.Request) {
	devid, err := mv(r, "devid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid device id")
		return
	}

	//Search for that device ID
	for _, dev := range m.cachedDeviceList {
		if dev.DeviceUUID == devid {
			//Found. Get it status and return
			status, err := dev.Handler.Status(dev)
			if err != nil {
				sendErrorResponse(w, err.Error())
				return
			}

			//Return the status
			js, _ := json.Marshal(status)
			sendJSONResponse(w, string(js))
			return
		}
	}

	//Not found
	sendErrorResponse(w, "Given device ID does not match any scanned devices")
}

//Handle IoT Scanning Request
func (m *Manager) HandleScanning(w http.ResponseWriter, r *http.Request) {
	//Scan the devices
	scannedDevices := m.scanDevices()

	js, _ := json.Marshal(scannedDevices)
	sendJSONResponse(w, string(js))
}

//Handle IoT Listing Request
func (m *Manager) HandleListing(w http.ResponseWriter, r *http.Request) {
	if m.cachedDeviceList == nil {
		m.scanDevices()
	}

	js, _ := json.Marshal(m.cachedDeviceList)
	sendJSONResponse(w, string(js))
}

func (m *Manager) scanDevices() []*Device {
	scannedDevices := []*Device{}
	for _, ph := range m.RegisteredHandler {
		//Scan devices using this handler
		thisProtcolDeviceList, err := ph.Scan()
		if err != nil {
			continue
		}

		//Append it to list
		for _, dev := range thisProtcolDeviceList {
			scannedDevices = append(scannedDevices, dev)
		}
	}

	//Cache the scan record
	m.cachedDeviceList = scannedDevices

	return scannedDevices
}
