package main

import (
	"net/http"
	"log"
)

func hardware_power_init(){
	if (*allow_hardware_management){
		//Only register these paths when hardware management is enabled

	}

	http.HandleFunc("/system/power/accessCheck", hardware_power_checkIfHardware)
}

func hardware_power_checkIfHardware(w http.ResponseWriter, r *http.Request){
	if (*allow_hardware_management){
		sendJSONResponse(w, "true")
	}else{
		sendJSONResponse(w, "false")
	}
}

//Pass in shutdown={deviceuuid} to shutdown
func hardware_power_restart(w http.ResponseWriter, r *http.Request){
	_, err := authAgent.GetUserName(w,r);
	if (err != nil){
		sendErrorResponse(w, "User not logged in")
		return
	}
	isAdmin := system_permission_checkUserIsAdmin(w,r)
	if (!isAdmin){
		sendErrorResponse(w, "Permission denied")
		return
	}

	poweroff, _ := mv(r, "shutdown", true)
	if (poweroff == ""){
		//Do system restart
		log.Println("Restarting");
	}else if (poweroff == deviceUUID){
		//Do system shutdown
		log.Println("Shutting down");
	}
}

