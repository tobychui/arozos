package main

import (
	"log"
	"net/http"

	"os/exec"
	"runtime"
)

func HardwarePowerInit() {
	if *allow_hardware_management {
		//Only register these paths when hardware management is enabled
		http.HandleFunc("/system/power/shutdown", hardware_power_poweroff)
		http.HandleFunc("/system/power/restart", hardware_power_restart)

		//Register a power handler in system setting menu
		registerSetting(settingModule{
			Name:         "Power",
			Desc:         "Set the power state of the host device",
			IconPath:     "SystemAO/boot/img/boot.png",
			Group:        "Info",
			StartDir:     "SystemAO/boot/poweroff.html",
			RequireAdmin: true,
		})
	}

	http.HandleFunc("/system/power/accessCheck", hardware_power_checkIfHardware)
}

func hardware_power_checkIfHardware(w http.ResponseWriter, r *http.Request) {
	if *allow_hardware_management {
		sendJSONResponse(w, "true")
	} else {
		sendJSONResponse(w, "false")
	}
}

func hardware_power_poweroff(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
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

	//Double check password for this user
	password, err := mv(r, "password", true)
	if err != nil {
		sendErrorResponse(w, "Password Incorrect")
		return
	}

	passwordCorrect := authAgent.ValidateUsernameAndPassword(userinfo.Username, password)
	if !passwordCorrect {
		sendErrorResponse(w, "Password Incorrect")
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
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
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

	//Double check password for this user
	password, err := mv(r, "password", true)
	if err != nil {
		sendErrorResponse(w, "Password Incorrect")
		return
	}

	passwordCorrect := authAgent.ValidateUsernameAndPassword(userinfo.Username, password)
	if !passwordCorrect {
		sendErrorResponse(w, "Password Incorrect")
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
