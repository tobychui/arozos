package hds

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func isJSON(s string) bool {
	var js map[string]interface{}
	return json.Unmarshal([]byte(s), &js) == nil
}

func tryGet(url string) (string, error) {
	client := http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != 200 {
		return "", errors.New("Server side return status code " + strconv.Itoa(resp.StatusCode))
	}

	content, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(content), nil
}

//Check if the given ip address is HDS device, return its UUID if true
func tryGetHDSUUID(ip string) (string, error) {
	uuid, err := tryGet("http://" + ip + "/uuid")
	if err != nil {
		return "", err
	}

	log.Println(ip, uuid)
	return uuid, nil
}

//Get the HDS device info, return Device Name, Class and error if any
func tryGetHDSInfo(ip string) (string, string, error) {
	infoStatus, err := tryGet("http://" + ip + "/info")
	if err != nil {
		return "", "", err
	}

	infodata := strings.Split(infoStatus, "_")
	if len(infodata) != 2 {
		return "", "", errors.New("Invalid HDS info string")
	}

	return infodata[0], infodata[1], nil
}

//Get the HDS device status. Only use this when you are sure the device is an HDS device
func getHDSStatus(ip string) (string, error) {
	status, err := tryGet("http://" + ip + "/status")
	if err != nil {
		return "", err
	}

	return status, nil
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, address := range addrs {
		// check the address type and if it is not a loopback the display it
		if ipnet, ok := address.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}
