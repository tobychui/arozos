package main

import (
	"encoding/json"
	"log"
	"net/http"
	"runtime"
	"time"

	info "imuslab.com/arozos/mod/info/hardwareinfo"
	usage "imuslab.com/arozos/mod/info/usageinfo"
	prout "imuslab.com/arozos/mod/prouter"
)

//InitShowSysInformation xxx
func SystemInfoInit() {
	log.Println("Operation System: " + runtime.GOOS)
	log.Println("System Architecture: " + runtime.GOARCH)

	//Updates 5 Dec 2020, Added permission router
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Create Info Server Object
	var infoServer *info.Server = nil

	if *allow_hardware_management {
		infoServer = info.NewInfoServer(info.ArOZInfo{
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

	} else {
		//Make a simpler page for the information of system for hardware management disabled nodes
		registerSetting(settingModule{
			Name:     "Overview",
			Desc:     "Overview for user information",
			IconPath: "SystemAO/info/img/small_icon.png",
			Group:    "Info",
			StartDir: "SystemAO/info/overview.html",
		})

		//Remve hardware information from the infoServer
		infoServer = info.NewInfoServer(info.ArOZInfo{
			BuildVersion: build_version + "." + internal_version,
			DeviceVendor: deviceVendor,
			DeviceModel:  deviceModel,
			VendorIcon:   "../../" + iconVendor,
			SN:           deviceUUID,
			HostOS:       "virtualized",
			CPUArch:      "generic",
			HostName:     *host_name,
		})
	}

	//Register endpoints that do not involve hardware management
	router.HandleFunc("/system/info/getRuntimeInfo", InfoHandleGetRuntimeInfo)

	//ArOZ Info do not need permission router
	http.HandleFunc("/system/info/getArOZInfo", infoServer.GetArOZInfo)

}

func InfoHandleGetRuntimeInfo(w http.ResponseWriter, r *http.Request) {
	type RuntimeInfo struct {
		StartupTime      int64
		ContinuesRuntime int64
	}

	runtimeInfo := RuntimeInfo{
		StartupTime:      startupTime,
		ContinuesRuntime: time.Now().Unix() - startupTime,
	}

	js, _ := json.Marshal(runtimeInfo)
	sendJSONResponse(w, string(js))
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
