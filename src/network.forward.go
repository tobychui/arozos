package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	Network Forward Interface
	author: tobychui

	This is an interface for providing a web UI for port forwarding to this host
	on different ports. Useful if you need to forward alternative ports for your
	services.
*/

func portForwardInit() {

	//Create database table if not exists
	sysdb.NewTable("portforward")

	//Register modules
	if *allow_upnp {
		//Forward the previous registered paths
		entries, _ := sysdb.ListTable("portforward")
		for _, keypairs := range entries {
			portNumber, _ := strconv.Atoi(string(keypairs[0]))
			policyName := "Unknown Forward Rule"
			json.Unmarshal(keypairs[1], &policyName)

			//Forward the recorded port
			err := UPNP.ForwardPort(portNumber, policyName)
			if err != nil {
				systemWideLogger.PrintAndLog("UpnP", "Port Fordware Failed: "+err.Error()+". Skipping "+policyName, err)
			}

		}

		//Create a setting interface for port forward
		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			AdminOnly:   false,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				utils.SendErrorResponse(w, "Permission Denied")
			},
		})

		registerSetting(settingModule{
			Name:     "Port Forward",
			Desc:     "UPnP based port forwarding",
			IconPath: "SystemAO/network/img/portforward.png",
			Group:    "Network",
			StartDir: "SystemAO/network/portforward.html",
		})

		router.HandleFunc("/system/network/portforward", portforward_handleForward)
	}
}

func portforward_handleForward(w http.ResponseWriter, r *http.Request) {
	opr, _ := utils.PostPara(r, "opr")
	if opr == "" {
		if UPNP == nil {
			utils.SendErrorResponse(w, "UPNP is not enabled")
			return
		}
		//List the current forward port and names
		type register struct {
			Port     int
			Name     string
			ReadOnly bool
		}
		forwardPorts := []register{}
		for _, port := range UPNP.RequiredPorts {
			//Get the name of the policy
			name, ok := UPNP.PolicyNames.Load(port)
			if !ok {
				name = "Unknown Service"
			}

			readOnly := false
			if port == *listen_port {
				//This is the port where the webUI is hosted. No change allowed
				readOnly = true
			}
			thisPort := register{
				Port:     port,
				Name:     name.(string),
				ReadOnly: readOnly,
			}

			//systemWideLogger.PrintAndLog(thisPort,nil)

			forwardPorts = append(forwardPorts, thisPort)
		}

		//Send the result as json
		js, _ := json.Marshal(forwardPorts)
		utils.SendJSONResponse(w, string(js))
	} else if opr == "add" {
		port, err := utils.PostPara(r, "port")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid port number")
			return
		}

		//Convert port to int
		portNumberic, err := strconv.Atoi(port)
		if err != nil {
			utils.SendErrorResponse(w, "Invalid port number")
			return
		}

		//Get the policy name
		policyName, err := utils.PostPara(r, "name")
		if err != nil {
			policyName = "Unnamed Forward Policy"
		}

		//Write port forward rules to database
		sysdb.Write("portforward", strconv.Itoa(portNumberic), policyName)

		if UPNP != nil {
			//Forward the port
			err := UPNP.ForwardPort(portNumberic, policyName)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
			} else {
				utils.SendOK(w)
			}
		} else {
			utils.SendErrorResponse(w, "UPNP is not enabled")
			return
		}
	} else if opr == "remove" {
		port, err := utils.PostPara(r, "port")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid port number")
			return
		}

		//Convert port to int
		portNumberic, err := strconv.Atoi(port)
		if err != nil {
			utils.SendErrorResponse(w, "Invalid port number")
			return
		}

		//Remove it from db if exists
		if sysdb.KeyExists("portforward", strconv.Itoa(portNumberic)) {
			//Key exists. Remove it from db
			sysdb.Delete("portforward", strconv.Itoa(portNumberic))
		}

		if UPNP != nil {
			err := UPNP.ClosePort(portNumberic)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
			} else {
				utils.SendOK(w)
			}
		} else {
			utils.SendErrorResponse(w, "UPNP is not enabled")
			return
		}
	}
}
