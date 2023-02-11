package sonoff_s2x

import (
	"log"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/iot"
	"imuslab.com/arozos/mod/network/mdns"
)

/*
	Sonoff S2X Module

	This is a module that handles Sonoff Tasmota 6.4.1(sonoff)
	Core version: 2_4_2/2.2.1(cfd48f3)

	See https://github.com/arendst/Tasmota for source code

	mDNS must be set to enable in order to use this scanner
*/

type Handler struct {
	scanner      *mdns.MDNSHost
	lastScanTime int64
}

// Create a new Sonoff S2X Protocol Handler
func NewProtocolHandler(scanner *mdns.MDNSHost) *Handler {
	//Create a new MDNS Host
	return &Handler{
		scanner,
		0,
	}
}

func (h *Handler) Start() error {
	log.Println("[IoT] Sonoff Tasmoto S2X 6.4 scanner loaded")
	return nil
}

func (h *Handler) Scan() ([]*iot.Device, error) {
	results := []*iot.Device{}
	scannedDevices := h.scanner.Scan(30, "")
	for _, dev := range scannedDevices {
		if dev.Port == 80 {
			if len(dev.IPv4) == 0 {
				//This device has no return IP???
				continue
			}
			//This things has web UI. Check if it is sonoff by grabbing its index
			value, err := tryGet("http://" + dev.IPv4[0].String() + "/")
			if err != nil {
				//This things is not sonoff smart socket
				log.Println(dev.HostName + " is not sonoff")
				continue
			}

			//Check if the return value contains the keyword:
			if strings.Contains(value, "Sonoff-Tasmota") {
				//This is sonoff device!
				//Extract its MAC Address from Web UI
				info, err := tryGet("http://" + dev.IPv4[0].String() + "/in")
				if err != nil {
					//This things is not sonoff smart socket
					log.Println(dev.HostName + " failed to extract its MAC address from /in page")
					continue
				}

				//Try to seperate the MAC address out
				//I have no idea what I am doing here
				re := regexp.MustCompile("[[:alnum:]][[:alnum:]]:[[:alnum:]][[:alnum:]]:[[:alnum:]][[:alnum:]]:[[:alnum:]][[:alnum:]]:[[:alnum:]][[:alnum:]]:[[:alnum:]][[:alnum:]]")
				match := re.FindStringSubmatch(info)
				deviceMAC := ""
				if len(match) > 0 {
					deviceMAC = match[0]
				} else {
					//Can't find MAC address for no reason?
					continue
				}

				//Try to get the device status
				status, err := tryGet("http://" + dev.IPv4[0].String() + "/ay")
				if err != nil {
					continue
				}

				devStatus := map[string]interface{}{}
				if strings.Contains(status, "ON") {
					//It is on
					devStatus["Power"] = "ON"
				} else {
					//It is off
					devStatus["Power"] = "OFF"
				}

				toggleEndpoint := iot.Endpoint{
					RelPath: "ay?o=1",
					Name:    "Toggle Power",
					Desc:    "Toggle the power of the smart switch",
					Type:    "none",
				}

				results = append(results, &iot.Device{
					Name:         strings.Title(strings.ReplaceAll(dev.HostName, ".local.", "")),
					Port:         80,
					Model:        "Sonoff S2X Smart Switch",
					Version:      "",
					Manufacturer: "Sonoff",
					DeviceUUID:   deviceMAC,

					IPAddr:           dev.IPv4[0].String(),
					RequireAuth:      false,
					RequireConnect:   false,
					Status:           devStatus,
					ControlEndpoints: []*iot.Endpoint{&toggleEndpoint},
					Handler:          h,
				})
			} else {
				continue
			}
		}
	}
	return results, nil
}

func (h *Handler) Connect(device *iot.Device, authInfo *iot.AuthInfo) error {
	return nil
}

func (h *Handler) Disconnect(device *iot.Device) error {
	return nil
}

func (h *Handler) Status(device *iot.Device) (map[string]interface{}, error) {
	//Try to get the device status
	status, err := tryGet("http://" + device.IPAddr + "/ay")
	if err != nil {
		return map[string]interface{}{}, err
	}

	devStatus := map[string]interface{}{}
	if strings.Contains(status, "ON") {
		//It is on
		devStatus["Power"] = "ON"
	} else {
		//It is off
		devStatus["Power"] = "OFF"
	}
	return devStatus, nil
}

func (h *Handler) Icon(device *iot.Device) string {
	return "switch"
}

func (h *Handler) Execute(device *iot.Device, endpoint *iot.Endpoint, payload interface{}) (interface{}, error) {
	results, err := tryGet("http://" + device.IPAddr + "/" + endpoint.RelPath)
	if err != nil {
		return nil, err
	}

	results = strings.ReplaceAll(results, "{t}", "")
	return results, nil
}

func (h *Handler) Stats() iot.Stats {
	return iot.Stats{
		Name:          "Sonoff Tasmota",
		Desc:          "Tasmota firmware for Sonoff S2X devices",
		Version:       "1.0",
		ProtocolVer:   "1.0",
		Author:        "tobychui",
		AuthorWebsite: "http://imuslab.com",
		AuthorEmail:   "imuslab@gmail.com",
		ReleaseDate:   1616944405,
	}
}
