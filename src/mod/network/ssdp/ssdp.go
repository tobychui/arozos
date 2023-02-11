package ssdp

import (
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	ssdp "github.com/koron/go-ssdp"
	"github.com/valyala/fasttemplate"
)

type SSDPOption struct {
	URLBase   string
	Hostname  string
	Vendor    string
	VendorURL string
	ModelName string
	ModelDesc string
	Serial    string
	UUID      string
}

type SSDPHost struct {
	ADV              *ssdp.Advertiser
	advStarted       bool
	SSDPTemplateFile string
	Option           *SSDPOption
	quit             chan bool
}

func NewSSDPHost(outboundIP string, port int, templateFile string, option SSDPOption) (*SSDPHost, error) {
	if runtime.GOOS == "linux" {
		//In case there are more than 1 network interface connect to the same LAN, choose the first one by default
		interfaceName, err := getFirstNetworkInterfaceName()
		if err != nil {
			//Ignore the interface binding
			log.Println("[WARN] No connected network interface. Starting SSDP anyway.")
		} else {
			mainNIC, err := net.InterfaceByName(interfaceName)
			if err != nil {
				log.Println("[WARN] Unable to get interface by name: " + interfaceName + ". Starting SSDP on all IPv4 interfaces.")
			} else {
				ssdp.Interfaces = []net.Interface{*mainNIC}
			}

		}
	}

	ad, err := ssdp.Advertise(
		"upnp:rootdevice",   // send as "ST"
		"uuid:"+option.UUID, // send as "USN"
		"http://"+outboundIP+":"+strconv.Itoa(port)+"/ssdp.xml", // send as "LOCATION"
		"arozos/"+outboundIP, // send as "SERVER"
		30)                   // send as "maxAge" in "CACHE-CONTROL"
	if err != nil {
		return &SSDPHost{}, err
	}

	return &SSDPHost{
		ADV:              ad,
		advStarted:       false,
		SSDPTemplateFile: templateFile,
		Option:           &option,
	}, nil
}

func (a *SSDPHost) Start() {
	//Advertise ssdp
	http.HandleFunc("/ssdp.xml", a.handleSSDP)
	log.Println("Starting SSDP Discovery Service: " + a.Option.URLBase)
	var aliveTick <-chan time.Time
	aliveTick = time.Tick(time.Duration(5) * time.Second)

	quit := make(chan bool)
	a.quit = quit
	a.advStarted = true
	go func(ad *ssdp.Advertiser) {
		for {
			select {
			case <-aliveTick:
				if ad != nil {
					ad.Alive()
				}

			case <-quit:
				ad.Bye()
				ad.Close()
				break
			}
		}
	}(a.ADV)
}

func (a *SSDPHost) Close() {
	if a != nil {
		if a.advStarted {
			a.quit <- true
		}
	}

}

// Serve the xml file with the given properties
func (a *SSDPHost) handleSSDP(w http.ResponseWriter, r *http.Request) {
	//Load the ssdp xml from file
	template, err := os.ReadFile(a.SSDPTemplateFile)
	if err != nil {
		w.Write([]byte("SSDP.XML NOT FOUND"))
		return
	}

	t := fasttemplate.New(string(template), "{{", "}}")
	s := t.ExecuteString(map[string]interface{}{
		"urlbase":   a.Option.URLBase,
		"hostname":  a.Option.Hostname,
		"vendor":    a.Option.Vendor,
		"vendorurl": a.Option.VendorURL,
		"modeldesc": a.Option.ModelDesc,
		"modelname": a.Option.ModelName,
		"uuid":      a.Option.UUID,
		"serial":    a.Option.Serial,
	})

	w.Write([]byte(s))
}

// Helper functions
func getFirstNetworkInterfaceName() (string, error) {
	if runtime.GOOS == "linux" {
		if pkg_exists("ip") {
			//Use the fast method
			cmd := exec.Command("bash", "-c", `ip route | grep default | sed -e "s/^.*dev.//" -e "s/.proto.*//"`)
			out, _ := cmd.CombinedOutput()
			if strings.TrimSpace(string(out)) == "" {
				//No interface found.
				return "", errors.New("No interface found")
			} else {
				return strings.Split(strings.TrimSpace(string(out)), "\n")[0], nil
			}
		} else if pkg_exists("ifconfig") {
			//Guess it from ifconfig list
			cmd := exec.Command("bash", "-c", `ifconfig -a | sed -E 's/[[:space:]:].*//;/^$/d'`)
			out, _ := cmd.CombinedOutput()
			if strings.TrimSpace(string(out)) == "" {
				//No interface found.
				return "", errors.New("No interface found")
			} else {
				return strings.Split(strings.TrimSpace(string(out)), "\n")[0], nil
			}
		}
	}

	return "", errors.New("Not supported platform or missing package")
}

func pkg_exists(pkgname string) bool {
	cmd := exec.Command("which", pkgname)
	out, _ := cmd.CombinedOutput()

	if len(string(out)) > 1 {
		return true
	} else {
		return false
	}
}
