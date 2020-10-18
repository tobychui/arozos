package main

import (
	"encoding/binary"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
)

type ipRange struct {
	start   uint
	end     uint
	country string
}

type ipReturnData struct {
	IP      string
	Country string
	Status  string
}

func network_ipToCountry_service_init() {
	log.Println("Starting ip2country service")

	http.HandleFunc("/SystemAO/network/getIPLocation", network_ipToCountry_getCurrentIPLocation)
	//http.HandleFunc("/SystemAO/network/getPing", network_info_getPing)
	/*
		//Register as a system setting
		registerSetting(settingModule{
			Name:     "Network Info",
			Desc:     "System Information",
			IconPath: "SystemAO/network/img/ethernet.png",
			Group:    "Network",
			StartDir: "SystemAO/network/hardware.html",
		})
	*/
}

func network_ipToCountry_getCurrentIPLocation(w http.ResponseWriter, r *http.Request) {
	/*
		if system_auth_chkauth(w, r) == false {
			sendErrorResponse(w, "User not logged in")
			return
		}
	*/

	//Do not try to access IP information if under disable_ip_resolve_services mode
	if *disable_ip_resolve_services {
		data := ipReturnData{
			IP:      "0.0.0.0",
			Country: "ZZ",
			Status:  "Resolve Service Disabled",
		}
		JSONText, _ := json.Marshal(data)
		sendJSONResponse(w, string(JSONText))
		return
	}

	UserIP, _, err := net.SplitHostPort(string(r.RemoteAddr))
	if err != nil {
		log.Println(err)
	}

	data := ipReturnData{}
	if strings.Contains(UserIP, ":") {
		data.IP = UserIP
		data.Country = "ZZ"
		data.Status = "IPv6 not supported in current release"

	} else {
		data.IP = UserIP
		data.Country = network_ipToCountry_GetCountry(UserIP)
		data.Status = "OK"

	}
	JSONText, _ := json.Marshal(data)
	sendJSONResponse(w, string(JSONText))
}

//GetCountry returns the country which ip blongs to
func network_ipToCountry_GetCountry(ip string) string {
	var arr []ipRange
	CSVFile := strings.Split(ip, ".")[0]
	lines, err := network_ipToCountry_ReadCsv("./system/ip2country/" + CSVFile + ".csv")
	if err != nil {
		panic(err)
	}

	// Loop through lines & turn into object
	for _, line := range lines {
		StartS := fmt.Sprintf("%s", line[0])
		Start, _ := network_ipToCountry_ipToInt(StartS)
		EndS := fmt.Sprintf("%s", line[1])
		End, _ := network_ipToCountry_ipToInt(EndS)

		data := ipRange{
			start:   Start,
			end:     End,
			country: line[2],
		}
		arr = append(arr, data)
	}
	ipNumb, err := network_ipToCountry_ipToInt(ip)
	if err != nil {
		return ""
	}

	index := network_ipToCountry_binarySearch(arr, ipNumb, 0, len(arr)-1)
	if index == -1 {
		return ""
	}

	return arr[index].country
}

func network_ipToCountry_binarySearch(arr []ipRange, hkey uint, low, high int) int {
	for low <= high {
		mid := low + (high-low)/2
		if hkey >= arr[mid].start && hkey <= arr[mid].end {
			return mid
		} else if hkey < arr[mid].start {
			high = mid - 1
		} else if hkey > arr[mid].end {
			low = mid + 1
		}
	}
	return -1
}

func network_ipToCountry_ipToInt(ips string) (uint, error) {
	ip := net.ParseIP(ips)
	if len(ip) == 16 {
		return uint(binary.BigEndian.Uint32(ip[12:16])), nil
	}
	return uint(binary.BigEndian.Uint32(ip)), nil
}

// ReadCsv accepts a file and returns its content as a multi-dimentional type
// with lines and each column. Only parses to string type.
func network_ipToCountry_ReadCsv(filename string) ([][]string, error) {

	// Open CSV file
	f, err := os.Open(filename)
	if err != nil {
		return [][]string{}, err
	}
	defer f.Close()

	// Read File into a Variable
	lines, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return [][]string{}, err
	}

	return lines, nil
}
