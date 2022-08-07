package hdsv2

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/iot"
	"imuslab.com/arozos/mod/network/mdns"
)

/*
	Home Dynamic 2 Controller

	This is a module that handles HDSv2 protocol devices scannings


*/

type Handler struct {
	scanner      *mdns.MDNSHost
	lastScanTime int64
}

//Create a new HDSv2 Protocol Handler
func NewProtocolHandler(scanner *mdns.MDNSHost) *Handler {
	//Create a new MDNS Host
	return &Handler{
		scanner,
		0,
	}
}

func (h *Handler) Start() error {
	log.Println("[IoT] Home Dynamic v2 Loaded")
	return nil
}

//Scan the devices within the LAN
func (h *Handler) Scan() ([]*iot.Device, error) {
	foundDevices := []*iot.Device{}
	hosts := h.scanner.Scan(3, "hds.arozos.com")
	for _, host := range hosts {
		//Decode the URL and escape characters
		decodedURL, err := url.QueryUnescape(host.HostName)
		if err != nil {
			decodedURL = host.HostName
		}

		//Filter out the unknown cost of "\ " in the name
		decodedURL = strings.ReplaceAll(decodedURL, "\\ ", " ")

		//Add device
		thisDevice := iot.Device{
			Name:         strings.Title(strings.ReplaceAll(decodedURL, ".local.", "")),
			Port:         host.Port,
			Model:        host.Model,
			Version:      host.BuildVersion + "-" + host.MinorVersion,
			Manufacturer: host.Vendor,
			DeviceUUID:   host.UUID,

			IPAddr:         host.IPv4[0].String(),
			RequireAuth:    false,
			RequireConnect: false,
			Status:         map[string]interface{}{},
			Handler:        h,
		}
		//Try to get the device status
		status, err := getStatusForDevice(&thisDevice)
		if err != nil {
			//This might be not a valid HDSv2 device. Skip this
			log.Println("*HDSv2* Get status failed for device: ", host.HostName, err.Error())
			continue
		}
		thisDevice.Status = status

		//Get the device content endpoints
		eps, err := getEndpoints(&thisDevice)
		if err != nil {
			//This might be not a valid HDSv2 device. Skip this
			log.Println("*HDSv2* Get endpoints failed for device: ", host.HostName, err.Error())
			continue
		}
		thisDevice.ControlEndpoints = eps

		//Push this host into found device list
		foundDevices = append(foundDevices, &thisDevice)
	}

	return foundDevices, nil
}

//Home Dynamic system's devices no need to established conenction before executing anything
func (h *Handler) Connect(device *iot.Device, authInfo *iot.AuthInfo) error {
	return nil
}

//Same rules also apply to disconnect
func (h *Handler) Disconnect(device *iot.Device) error {
	return nil
}

//Get the status of the device
func (h *Handler) Status(device *iot.Device) (map[string]interface{}, error) {
	return getStatusForDevice(device)
}

//Get the icon filename of the device
func (h *Handler) Icon(device *iot.Device) string {
	devModel := device.Model
	if devModel == "Switch" {
		return "switch"
	} else if devModel == "Test Unit" {
		return "test"
	} else if devModel == "Display" {
		return "display"
	} else {
		return "unknown"
	}
}

//Get the status of the device
func (h *Handler) Execute(device *iot.Device, endpoint *iot.Endpoint, payload interface{}) (interface{}, error) {
	var result interface{}

	targetURL := "http://" + device.IPAddr + ":" + strconv.Itoa(device.Port) + "/" + endpoint.RelPath

	//Check if there are payload for this request
	if payload == nil {
		//No payload. Just call it

	} else {
		//Payload exists. Append it to the end with value=?
		targetURL += "?value=" + url.QueryEscape(payload.(string))
	}

	result, err := tryGet(targetURL)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func (h *Handler) Stats() iot.Stats {
	return iot.Stats{
		Name:          "Home Dynamic v2",
		Desc:          "A basic IoT communication protocol for ESP8266 made by Makers",
		Version:       "2.0",
		ProtocolVer:   "2.0",
		Author:        "tobychui",
		AuthorWebsite: "http://arozos.com",
		AuthorEmail:   "hds@arozos.com",
		ReleaseDate:   1614524498,
	}
}

//Get endpoint of the given device object
func getEndpoints(device *iot.Device) ([]*iot.Endpoint, error) {
	//Parse the URL of the endpoint apis location (eps)
	requestURL := "http://" + device.IPAddr + ":" + strconv.Itoa(device.Port) + "/eps"
	resp, err := http.Get(requestURL)
	if err != nil {
		return nil, err
	}

	//Get the body content
	content, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	//Convert the results to Endpoints
	endpoints := []iot.Endpoint{}
	err = json.Unmarshal(content, &endpoints)
	if err != nil {
		return nil, err
	}

	//Convert the structure to array pointers
	results := []*iot.Endpoint{}
	for _, ep := range endpoints {
		thisEp := ep
		results = append(results, &thisEp)
	}

	return results, nil

}

//Get status given the device object.
func getStatusForDevice(device *iot.Device) (map[string]interface{}, error) {
	//Parse the URL for its status api endpoint
	requestURL := "http://" + device.IPAddr + ":" + strconv.Itoa(device.Port) + "/status"
	resp, err := http.Get(requestURL)
	if err != nil {
		return map[string]interface{}{}, err
	}

	//Get the body content
	content, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{}, err
	}

	//Check if the resp is json
	if !isJSON(strings.TrimSpace(string(content))) {
		return map[string]interface{}{}, errors.New("Invalid HDSv2 protocol")
	}

	//Ok. Parse it
	status := map[string]interface{}{}
	err = json.Unmarshal(content, &status)
	if err != nil {
		return map[string]interface{}{}, err
	}

	return status, nil

}
