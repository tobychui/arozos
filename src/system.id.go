package main

import (
	"net/http"
	"io/ioutil"
	"log"
	"strings"
	"github.com/satori/go.uuid"
	"encoding/json"
)

/*
	System Identification API

	This module handles cross cluster scanning, responses and more that related
	to functions that identifiy this as a ArOZ Online device
*/
func system_id_init(){
	//Initialize device UUID if not exists
	system_id_generateSystemUUID();

	//Register as a system setting
	registerSetting(settingModule{
		Name:     "ArOZ Online",
		Desc:     "System Information",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "About",
		StartDir: "SystemAO/info/about.html",
	})

	//Handle the about page 
	http.HandleFunc("/system/id/requestInfo", system_id_handleRequest);


	//Handle ArOZ Online Beta search methods
	if *enable_beta_scanning_support{
		http.HandleFunc("/AOB/hb.php", system_id_responseBetaScan);
		http.HandleFunc("/AOB/", func(w http.ResponseWriter, r *http.Request){
			http.Redirect(w,r,"../index.html",307)
		});
		http.HandleFunc("/AOB/SystemAOB/functions/info/version.inf", system_id_serveVersonNumber);
		http.HandleFunc("/AOB/SystemAOB/functions/system_statistic/getDriveStat.php", system_id_getDriveStates);	
	}
	
	//Handle ArOZ Online 1.0 scan methods
	//WIP
}

func system_id_generateSystemUUID(){
	if !fileExists("./system/dev.uuid"){
		//UUID not exist. Create one
		thisuuid := uuid.NewV4().String()
		if (*system_uuid != ""){
			//User has defined the uuid. Use user defined one instead.
			thisuuid = *system_uuid
		}
		err := ioutil.WriteFile("./system/dev.uuid", []byte(thisuuid), 0755)
		if (err != nil){
			log.Fatal(err)
		}
		deviceUUID = thisuuid
	}else{
		thisuuid, err := ioutil.ReadFile("./system/dev.uuid")
		if (err != nil){
			log.Fatal("Failed to read system uuid file (system/dev.uuid).")
		}
		deviceUUID = string(thisuuid)
	}
}

func system_id_getSystemUUID() string{
	fileUUID, err := ioutil.ReadFile("./system/dev.uuid")
	if (err != nil){
		log.Println("Unable to read system UUID from dev.uuid file")
		log.Fatal(err)
	}

	return string(fileUUID)
}

func system_id_handleRequest(w http.ResponseWriter, r *http.Request){
	//Check if user has logged in
	if system_auth_chkauth(w, r) == false {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Group everything required to show into one json string
	type returnStruct struct{
		SystemUUID string;
		IpAddress string;
		Vendor string;
		Build string;
		Version string;
		Model string;
		VendorIcon string;
	}

	thisDevIP := network_info_GetOutboundIP().String()

	jsonString, _ := json.Marshal(returnStruct{
		SystemUUID: system_id_getSystemUUID(),
		IpAddress: thisDevIP,
		Vendor: deviceVendor,
		Build: build_version,
		Version: internal_version,
		Model: deviceModel,
		VendorIcon: iconVendor,
	})

	sendJSONResponse(w, string(jsonString))
}

func system_id_responseBetaScan(w http.ResponseWriter, r *http.Request){
	//Handle beta scanning method
	uuid := system_id_getSystemUUID();
	IPAddress := r.Header.Get("X-Real-Ip")
    if IPAddress == "" {
        IPAddress = r.Header.Get("X-Forwarded-For")
    }
    if IPAddress == "" {
        IPAddress = r.RemoteAddr
    }
    IPAddress = IPAddress[:strings.LastIndex(IPAddress, ":")]
	resp := *host_name + ",Alive," + uuid + "," + IPAddress
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Request-Headers", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Write([]byte(resp))
}


func system_id_serveVersonNumber(w http.ResponseWriter, r *http.Request){
	if build_version == "development"{
		w.Write([]byte("AO-DEV_v" + internal_version))
	}else{
		w.Write([]byte("AO-REL_v" + internal_version))
	}
}

func system_id_getDriveStates(w http.ResponseWriter, r *http.Request){
	results := [][]string{}
	for _, store := range storages{
		results = append(results, []string{
				store.Uuid,
				store.Name,
				"-1B/-1B",
			})
	}

	jsonString, _ := json.Marshal(results)
	sendJSONResponse(w, string(jsonString))
}