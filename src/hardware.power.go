package main

import (
	"net/http"

	"os/exec"
	"runtime"

	"imuslab.com/arozos/mod/utils"
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
		utils.SendJSONResponse(w, "true")
	} else {
		utils.SendJSONResponse(w, "false")
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
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	if !sudo_mode {
		utils.SendErrorResponse(w, "Sudo mode required")
		return
	}

	//Double check password for this user
	password, err := utils.PostPara(r, "password")
	if err != nil {
		utils.SendErrorResponse(w, "Password Incorrect")
		return
	}

	passwordCorrect, rejectionReason := authAgent.ValidateUsernameAndPasswordWithReason(userinfo.Username, password)
	if !passwordCorrect {
		utils.SendErrorResponse(w, rejectionReason)
		return
	}

	if runtime.GOOS == "windows" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-s", "-t", "20")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}

	if runtime.GOOS == "linux" {
		//Only allow Linux to do power operation
		cmd := exec.Command("/sbin/shutdown")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}

	if runtime.GOOS == "darwin" {
		//Only allow Linux to do power operation
		cmd := exec.Command("sudo", "shutdown", "-h", "+1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}

	utils.SendOK(w)
}

func hardware_power_restart(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("401 Unauthorized"))
		return
	}

	if !userinfo.IsAdmin() {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	if !sudo_mode {
		utils.SendErrorResponse(w, "Sudo mode required")
		return
	}

	//Double check password for this user
	password, err := utils.PostPara(r, "password")
	if err != nil {
		utils.SendErrorResponse(w, "Password Incorrect")
		return
	}

	passwordCorrect, rejectionReason := authAgent.ValidateUsernameAndPasswordWithReason(userinfo.Username, password)
	if !passwordCorrect {
		utils.SendErrorResponse(w, rejectionReason)
		return
	}

	if runtime.GOOS == "windows" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-r", "-t", "20")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}

	if runtime.GOOS == "linux" {
		//Only allow Linux to do power operation
		cmd := exec.Command("systemctl", "reboot")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}

	if runtime.GOOS == "darwin" {
		//Only allow Linux to do power operation
		cmd := exec.Command("shutdown", "-r", "+1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			systemWideLogger.PrintAndLog("Power", string(out), err)
			utils.SendErrorResponse(w, string(out))
		}
		systemWideLogger.PrintAndLog("Power", string(out), nil)
	}
	utils.SendOK(w)
}
