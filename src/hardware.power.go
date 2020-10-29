package main

import (
	"net/http"
	"log"

	"os/exec"
	"runtime"
)

func HardwarePowerInit(){
	if (*allow_hardware_management){
		//Only register these paths when hardware management is enabled
		http.HandleFunc("/system/power/shutdown", hardware_power_poweroff)
		http.HandleFunc("/system/power/restart", hardware_power_restart)
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

func hardware_power_poweroff(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("401 Unauthorized"))
		return
	}

	if !userinfo.IsAdmin() {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	if !sudo_mode {
		sendErrorResponse(w, "Sudo mode required")
		return
	}

	if runtime.GOOS == "windows" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-s", "-t", "20")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}

	if runtime.GOOS == "linux" {
		//Only allow Linux to do power operation
		cmd := exec.Command("/sbin/shutdown")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}

	if runtime.GOOS == "darwin" {
		//Only allow Linux to do power operation
		cmd := exec.Command("sudo", "shutdown", "-h", "+1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}

	sendOK(w)
}

func hardware_power_restart(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("401 Unauthorized"))
		return
	}

	if !userinfo.IsAdmin() {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	if !sudo_mode {
		sendErrorResponse(w, "Sudo mode required")
		return
	}

	if runtime.GOOS == "windows" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-r", "-t", "20")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}

	if runtime.GOOS == "linux" {
		//Only allow Linux to do power operation
		cmd := exec.Command("systemctl", "reboot")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}

	if runtime.GOOS == "darwin" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-r", "+1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(out))
			sendErrorResponse(w, string(out))
		}
		log.Println(string(out))
	}
	sendOK(w)
}
