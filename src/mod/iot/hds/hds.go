package hds

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/iot"
)

/*
	Home Dynamic System
	Author: tobychui

	This is a compaitbility module for those who are still using HDSv1 protocol
	If you are still using HDSv1, you should consider upgrading it to the latest
	version of HDS protocols.
*/

type Handler struct {
	lastScanTime int64
}

//Create a new HDS Protocol Handler
func NewProtocolHandler() *Handler {
	//Create a new MDNS Host
	return &Handler{}
}

//Start the HDSv1 scanner, which no startup process is required
func (h *Handler) Start() error {
	log.Println("*IoT* Home Dynamic System (Legacy) Loaded")
	return nil
}

//Scan all the HDS devices in LAN using the legacy ip scanner methods
func (h *Handler) Scan() ([]*iot.Device, error) {
	//Get the current local IP address
	ip := getLocalIP()
	if ip == "" {
		//Not connected to a network?
		return nil, errors.New("Unable to get ip address of host device")
	}

	//Only handle a small subset of ip ranges (Last 255 addfress)
	scanBase := ""
	valid := false
	if ip[:8] == "192.168." {
		tmp := strings.Split(ip, ".")
		tmp = tmp[:len(tmp)-1]
		scanBase = strings.Join(tmp, ".") + "." //Return 192.168.0.
		valid = true
	} else if ip[:4] == "172." {
		//Handle 172.16.x.x - 172.31.x.x
		tmp := strings.Split(ip, ".")
		val, err := strconv.Atoi(tmp[1])
		if err == nil {
			if val >= 16 && val <= 31 {
				//Private addr range
				valid = true
				scanBase = strings.Join(tmp, ".") + "." //Return 172.16.0.
			}
		}
	}

	//Check if the IP range is supported by HDS protocol
	if !valid {
		log.Println("*IoT* Home Dynamic Protocol requirement not satisfied. Skipping Scan")
		return nil, nil
	}

	results := []*iot.Device{}

	//Create a IP scanner
	var wg sync.WaitGroup
	for i := 1; i < 256; i++ {
		time.Sleep(300 * time.Microsecond)
		wg.Add(1)
		go func(wg *sync.WaitGroup) {
			defer wg.Done()
			targetIP := scanBase + strconv.Itoa(i)
			uuid, err := tryGetHDSUUID(targetIP)
			if err != nil {
				//Not an HDS device
				return
			}

			//This is an HDS device. Get its details
			devName, className, err := tryGetHDSInfo(targetIP)
			if err != nil {
				//Corrupted HDS device?
				return
			}

			//Get the device status
			deviceState := map[string]interface{}{}

			statusText, err := getHDSStatus(targetIP)
			if err != nil {
				//No status

			} else {
				deviceState["status"] = strings.TrimSpace(statusText)
			}

			//Create the hdsv1 endpoints (aka /on and /off)
			endpoints := []*iot.Endpoint{}
			endpoints = append(endpoints, &iot.Endpoint{
				RelPath: "on",
				Name:    "ON",
				Desc:    "Turn on the device",
				Type:    "none",
			})
			endpoints = append(endpoints, &iot.Endpoint{
				RelPath: "off",
				Name:    "OFF",
				Desc:    "Turn off the device",
				Type:    "none",
			})

			//Append the device to list
			results = append(results, &iot.Device{
				Name:         devName,
				Port:         80, //HDS device use port 80 by default
				Model:        className,
				Version:      "1.0",
				Manufacturer: "Generic",
				DeviceUUID:   uuid,

				IPAddr:           targetIP,
				RequireAuth:      false,
				RequireConnect:   false,
				Status:           deviceState,
				Handler:          h,
				ControlEndpoints: endpoints,
			})

			log.Println("*HDS* Found device ", devName, " at ", targetIP, " with UUID ", uuid)
		}(&wg)
	}

	wg.Wait()

	return results, nil
}

//Home Dynamic system's devices no need to established conenction before executing anything
func (h *Handler) Connect(device *iot.Device, authInfo *iot.AuthInfo) error {
	return nil
}

//Same rules also apply to disconnect
func (h *Handler) Disconnect(device *iot.Device) error {
	return nil
}

//Get the icon filename of the device, it is always switch for hdsv1
func (h *Handler) Icon(device *iot.Device) string {
	return "switch"
}

//Get the status of the device
func (h *Handler) Execute(device *iot.Device, endpoint *iot.Endpoint, payload interface{}) (interface{}, error) {
	//GET request the target device endpoint
	resp, err := tryGet("http://" + device.IPAddr + ":" + strconv.Itoa(device.Port) + "/" + endpoint.RelPath)
	if err != nil {
		return map[string]interface{}{}, err
	}

	return resp, nil
}

//Get the status of the device
func (h *Handler) Status(device *iot.Device) (map[string]interface{}, error) {
	resp, err := tryGet("http://" + device.IPAddr + "/status")
	if err != nil {
		return map[string]interface{}{}, err
	}

	//Convert the resp into map string itnerface
	result := map[string]interface{}{}
	result["status"] = resp

	return result, nil
}

//Return the specification of this protocol handler
func (h *Handler) Stats() iot.Stats {
	return iot.Stats{
		Name:          "Home Dynamic",
		Desc:          "A basic IoT communication protocol for ESP8266 for ArOZ Online Beta",
		Version:       "1.0",
		ProtocolVer:   "1.0",
		Author:        "tobychui",
		AuthorWebsite: "https://git.hkwtc.org/TC/HomeDynamic",
		AuthorEmail:   "",
		ReleaseDate:   1576094199,
	}
}
