package main

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	info "imuslab.com/arozos/mod/info/hardwareinfo"
	"imuslab.com/arozos/mod/info/logviewer"
	usage "imuslab.com/arozos/mod/info/usageinfo"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/updates"
	"imuslab.com/arozos/mod/utils"
)

// InitShowSysInformation xxx
func SystemInfoInit() {
	systemWideLogger.PrintAndLog("System", "Operation System: "+runtime.GOOS, nil)
	systemWideLogger.PrintAndLog("System", "System Architecture: "+runtime.GOARCH, nil)

	//Updates 5 Dec 2020, Added permission router
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Anyone logged in can load router
	authRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Create Info Server Object
	var infoServer *info.Server = nil

	//Overview of account and system information
	registerSetting(settingModule{
		Name:     "Overview",
		Desc:     "Overview for user information",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Info",
		StartDir: "SystemAO/info/overview.html",
	})

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
	authRouter.HandleFunc("/system/info/getRuntimeInfo", InfoHandleGetRuntimeInfo)

	//ArOZ Info do not need permission router
	http.HandleFunc("/system/info/getArOZInfo", infoServer.GetArOZInfo)

	go func() {
		if updates.CheckLauncherPortResponsive() {
			//Launcher port is responsive. Assume launcher exists
			registerSetting(settingModule{
				Name:         "Updates",
				Desc:         "Perform ArozOS Updates",
				IconPath:     "SystemAO/updates/img/update.png",
				Group:        "Info",
				StartDir:     "SystemAO/updates/index.html",
				RequireAdmin: true,
			})

			//Register Update Functions
			adminRouter.HandleFunc("/system/update/download", updates.HandleUpdateDownloadRequest)
			adminRouter.HandleFunc("/system/update/checksize", updates.HandleUpdateCheckSize)
			adminRouter.HandleFunc("/system/update/checkpending", updates.HandlePendingCheck)
			adminRouter.HandleFunc("/system/update/platform", updates.HandleGetUpdatePlatformInfo)

			//Special function for handling launcher restart, must be in this scope
			adminRouter.HandleFunc("/system/update/restart", func(w http.ResponseWriter, r *http.Request) {
				launcherVersion, err := updates.GetLauncherVersion()
				if err != nil {
					utils.SendErrorResponse(w, err.Error())
					return
				}
				execute, _ := utils.PostPara(r, "exec")
				if execute == "true" && r.Method == http.MethodPost {
					//Do the update
					systemWideLogger.PrintAndLog("System", "REQUESTING LAUNCHER FOR UPDATE RESTART", nil)
					executeShutdownSequence()
					utils.SendOK(w)
				} else if execute == "true" {
					//Prevent redirection attack
					w.WriteHeader(http.StatusMethodNotAllowed)
					w.Write([]byte("405 - Method Not Allowed"))
				} else {
					//Return the launcher message
					utils.SendTextResponse(w, string(launcherVersion))
				}

			})
		}
	}()

	//Log Viewer, so developers can debug inside arozos
	logViewer := logviewer.NewLogViewer(&logviewer.ViewerOption{
		RootFolder: "system/logs/",
		Extension:  ".log",
	})

	adminRouter.HandleFunc("/system/log/list", logViewer.HandleListLog)
	adminRouter.HandleFunc("/system/log/read", logViewer.HandleReadLog)

	registerSetting(settingModule{
		Name:         "System Log",
		Desc:         "View ArozOS System Log",
		IconPath:     "SystemAO/updates/img/update.png",
		Group:        "Advance",
		StartDir:     "SystemAO/advance/logview.html",
		RequireAdmin: true,
	})

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
	utils.SendJSONResponse(w, string(js))
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
	utils.SendJSONResponse(w, string(js))
}
