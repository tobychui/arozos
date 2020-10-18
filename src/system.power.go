package main

import (
	"log"
	"net/http"
	"os/exec"
	"runtime"
)

/*
	Power Management Module

	This module will handle the power condition of the system, including poweroff and restart
*/

func system_power_init() {
	http.HandleFunc("/system/power/shutdown", system_power_poweroff)
	http.HandleFunc("/system/power/restart", system_power_restart)
}

func system_power_poweroff(w http.ResponseWriter, r *http.Request) {
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
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

func system_power_restart(w http.ResponseWriter, r *http.Request) {
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
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
