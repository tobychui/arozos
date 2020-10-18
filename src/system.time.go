package main

import (
	//"log"

	"encoding/json"
	"io/ioutil"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

/*
	System Time & Date Services

	This module handle updates and setup of the current system time and date
	(Add more helpful comments here)

	TODO: timezone problems.
*/

//returnFormat shoulbn't be exported
type returnFormat struct {
	Time     string `json:"time"`
	Timezone string `json:"timezone"`
}

//WindowsTimeZoneStruct shouldn't be exported.
type WindowsTimeZoneStruct struct {
	SupplementalData struct {
		Version struct {
			Number string `json:"_number"`
		} `json:"version"`
		WindowsZones struct {
			MapTimezones struct {
				MapZone []struct {
					Other     string `json:"_other"`
					Territory string `json:"_territory"`
					Type      string `json:"_type"`
				} `json:"mapZone"`
				OtherVersion string `json:"_otherVersion"`
				TypeVersion  string `json:"_typeVersion"`
			} `json:"mapTimezones"`
		} `json:"windowsZones"`
	} `json:"supplementalData"`
}

func system_time_init() {
	registerSetting(settingModule{
		Name:         "System Time",
		Desc:         "Current Time in the System Host",
		IconPath:     "SystemAO/disk/smart/img/small_3icon.png",
		Group:        "Time",
		StartDir:     "SystemAO/time/currenttime.html",
		RequireAdmin: true,
	})
	http.HandleFunc("/SystemAO/time/getTime", showTime)

}
func showTime(w http.ResponseWriter, r *http.Request) {
	if system_auth_chkauth(w, r) == false {
		redirectToLoginPage(w, r)
		return
	}

	now := time.Now() // current local time
	Timezone := ""

	if runtime.GOOS == "linux" {
		cmd := exec.Command("timedatectl", "show", "-p", "Timezone")
		out, _ := cmd.CombinedOutput()
		outString := string(out)
		outString = strings.SplitN(outString, "=", 2)[1]
		Timezone = outString
	} else if runtime.GOOS == "windows" {
		cmd := exec.Command("tzutil", "/g")
		out, _ := cmd.CombinedOutput()
		outString := string(out)
		Timezone = ConvertWinTZtoLinuxTZ(outString)
	} else if runtime.GOOS == "darwin" {
		//no support, just ease my debugging
		Timezone = "America/Los_Angeles"

	}

	returnStruct := returnFormat{
		Time:     now.Format(time.RFC3339),
		Timezone: Timezone,
	}
	returnString, _ := json.Marshal(returnStruct)
	sendJSONResponse(w, string(returnString))

}

func ConvertWinTZtoLinuxTZ(WinTZ string) string {
	file, _ := ioutil.ReadFile("./system/time/wintz.json")
	WinTZLinuxTz := WindowsTimeZoneStruct{}
	json.Unmarshal([]byte(file), &WinTZLinuxTz)
	for _, data := range WinTZLinuxTz.SupplementalData.WindowsZones.MapTimezones.MapZone {
		if data.Other == WinTZ {
			LinuxTZ := strings.SplitN(data.Type, " ", 2)[0]
			return LinuxTZ
		}
	}
	return ""
}
