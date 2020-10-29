package ssdp

import (
	"time"
	"strconv"
	"log"
	"net/http"
	"io/ioutil"

	"github.com/valyala/fasttemplate"
	ssdp "github.com/koron/go-ssdp"

)


type SSDPOption struct{
	URLBase string
	Hostname string
	Vendor string
	VendorURL string
	ModelName string
	ModelDesc string
	Serial string
	UUID string
}


type SSDPHost struct{
	ADV *ssdp.Advertiser
	advStarted bool
	SSDPTemplateFile string
	Option *SSDPOption
	quit chan bool
}


func NewSSDPHost(outboundIP string, port int, templateFile string , option SSDPOption) (*SSDPHost, error){
	ad, err := ssdp.Advertise(
		"upnp:rootdevice",                        // send as "ST"
		"uuid:" + option.UUID,              // send as "USN"
		"http://" + outboundIP + ":" + strconv.Itoa(port) + "/ssdp.xml", // send as "LOCATION"
		"ArOZ/aCloud/" + outboundIP,         // send as "SERVER"
		1800)                               // send as "maxAge" in "CACHE-CONTROL"
	if err != nil{
		return &SSDPHost{}, err
	}

	return &SSDPHost{
		ADV: ad,
		advStarted: false,
		SSDPTemplateFile: templateFile,
		Option: &option,
	}, nil
}

func (a *SSDPHost)Start(){
	//Advertise ssdp
	http.HandleFunc("/ssdp.xml", a.handleSSDP)
	log.Println("Starting SSDP Discovery Service: " + a.Option.URLBase)
	var aliveTick <-chan time.Time
	aliveTick = time.Tick(time.Duration(5) * time.Second)
	
	quit := make(chan bool)
	a.quit = quit
	a.advStarted = true
	go func(ad *ssdp.Advertiser){
		for {
			select {
			case <-aliveTick:
				ad.Alive()
			case <-quit:
				break
			}
		}
		ad.Bye()
		ad.Close()
	}(a.ADV)
}

func (a *SSDPHost)Close(){
	if a != nil{
		if a.advStarted{
			a.quit <- true
		}
	}
	
}

//Serve the xml file with the given properties
func  (a *SSDPHost)handleSSDP(w http.ResponseWriter, r *http.Request){
	//Load the ssdp xml from file
	template, err := ioutil.ReadFile(a.SSDPTemplateFile)
	if err != nil{
		w.Write([]byte("SSDP.XML NOT FOUND"))
		return
	}

	t := fasttemplate.New(string(template), "{{", "}}")
	s := t.ExecuteString(map[string]interface{}{
		"urlbase": a.Option.URLBase,
		"hostname": a.Option.Hostname ,
		"vendor": a.Option.Vendor ,
		"vendorurl": a.Option.VendorURL ,
		"modeldesc": a.Option.ModelDesc ,
		"modelname": a.Option.ModelName ,
		"uuid": a.Option.UUID ,
		"serial": a.Option.Serial,
	})

	w.Write([]byte(s))
}