package main

import (
	"encoding/json"
	"log"
	"net/http"
	"runtime"

	info "imuslab.com/arozos/mod/info/hardwareinfo"
	usage "imuslab.com/arozos/mod/info/usageinfo"
	prout "imuslab.com/arozos/mod/prouter"
)

//InitShowSysInformation xxx
func SystemInfoInit() {
	log.Println("Operation System: " + runtime.GOOS)
	log.Println("System Architecture: " + runtime.GOARCH)

	if *allow_hardware_management {
		//Updates 5 Dec 2020, Added permission router
		router := prout.NewModuleRouter(prout.RouterOption{
			AdminOnly:   false,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				sendErrorResponse(w, "Permission Denied")
			},
		})

		//Create Info Server Object
		infoServer := info.NewInfoServer(info.ArOZInfo{
			BuildVersion: build_version + "." + internal_version,
			DeviceVendor: deviceVendor,
			DeviceModel:  deviceModel,
			VendorIcon:   "../../" + iconVendor,
			SN:           deviceUUID,
			HostOS:       runtime.GOOS,
			CPUArch:      runtime.GOARCH,
			HostName:     *host_name,
		})

		router.HandleFunc("/system/info/getCPUinfo", info.GetCPUInfo)
		router.HandleFunc("/system/info/ifconfig", info.Ifconfig)
		router.HandleFunc("/system/info/getDriveStat", info.GetDriveStat)
		router.HandleFunc("/system/info/usbPorts", info.GetUSB)
		router.HandleFunc("/system/info/getRAMinfo", info.GetRamInfo)

		//ArOZ Info do not need permission router
		http.HandleFunc("/system/info/getArOZInfo", infoServer.GetArOZInfo)

		//Register as a system setting
		registerSetting(settingModule{
			Name:     "Host Info",
			Desc:     "System Information",
			IconPath: "SystemAO/info/img/small_icon.png",
			Group:    "Info",
			StartDir: "SystemAO/info/index.html",
		})

		/*
			CPU and RAM usage interface

		*/

		registerSetting(settingModule{
			Name:     "Performance",
			Desc:     "System CPU and RAM usage",
			IconPath: "SystemAO/info/img/small_icon.png",
			Group:    "Info",
			StartDir: "SystemAO/info/taskManagerFrame.html",
		})

		router.HandleFunc("/system/info/getUsageInfo", InfoHandleTaskInfo)

	}

}

func InfoHandleTaskInfo(w http.ResponseWriter, r *http.Request) {
	type UsageInfo struct {
		CPU      float64
		UsedRAM  string
		TotalRam string
		RamUsage float64
	}
	cpuUsage := usage.GetCPUUsage()
	usedRam, totalRam, usagePercentage := usage.GetRAMUsage()

	info := UsageInfo{
		cpuUsage,
		usedRam,
		totalRam,
		usagePercentage,
	}

	js, _ := json.Marshal(info)
	sendJSONResponse(w, string(js))
}
