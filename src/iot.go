package main

import (
	"net/http"

	"imuslab.com/arozos/mod/iot"
	"imuslab.com/arozos/mod/iot/hds"
	"imuslab.com/arozos/mod/iot/hdsv2"
	"imuslab.com/arozos/mod/iot/sonoff_s2x"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
)

/*
	IoT Hub
	Author: tobychui

	This script handle the IoT service start up and mangement

	IoT Manager: Manage who can have access to certain IoT devices
	IoT Panel: The panel for controlling the devices
*/

var iotManager *iot.Manager

func IoTHubInit() {
	if *allow_iot && *allow_mdns && MDNS != nil {
		//Create a new ioT Manager
		iotManager = iot.NewIoTManager()

		//Register IoT Hub Module
		moduleHandler.RegisterModule(module.ModuleInfo{
			Name:        "IoT Hub",
			Group:       "Internet",
			IconPath:    "SystemAO/iot/hub/img/small_icon.png",
			Version:     "1.0",
			StartDir:    "SystemAO/iot/hub/index.html",
			SupportFW:   true,
			InitFWSize:  []int{465, 730},
			LaunchFWDir: "SystemAO/iot/hub/index.html",
			SupportEmb:  false,
		})

		//Register IoT Setting Interfaces
		registerSetting(settingModule{
			Name:     "IoT Hub",
			Desc:     "Manage IoT Devices Scanners",
			IconPath: "SystemAO/iot/img/small_icon.png",
			Group:    "Device",
			StartDir: "SystemAO/iot/info.html",
		})

		//Register IoT Devices Endpoints
		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "IoT Panel",
			AdminOnly:   false,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				sendErrorResponse(w, "Permission Denied")
			},
		})

		adminRouter := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			AdminOnly:   true,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				sendErrorResponse(w, "Permission Denied")
			},
		})

		//IoT Panel control APIs
		router.HandleFunc("/system/iot/scan", iotManager.HandleScanning)
		router.HandleFunc("/system/iot/list", iotManager.HandleListing)
		router.HandleFunc("/system/iot/status", iotManager.HandleGetDeviceStatus)
		router.HandleFunc("/system/iot/execute", iotManager.HandleExecute)
		router.HandleFunc("/system/iot/icon", iotManager.HandleIconLoad)

		//IoT Hub Info APIs
		adminRouter.HandleFunc("/system/iot/listScanner", iotManager.HandleScannerList)

		//Start of the IoT Management Handlers

		//Home Dynamic v1 (Legacy)
		hdsHandler := hds.NewProtocolHandler()
		iotManager.RegisterHandler(hdsHandler)

		//Home Dynamic v2
		hdsv2Handler := hdsv2.NewProtocolHandler(MDNS)
		iotManager.RegisterHandler(hdsv2Handler)

		//Tasmota Sonoff S2X
		tasmotaSonoffS2x := sonoff_s2x.NewProtocolHandler(MDNS)
		iotManager.RegisterHandler(tasmotaSonoffS2x)

		//Add more here if needed

		//Finally, inject the gateway into the AGI interface
		AGIGateway.Option.IotManager = iotManager
	}

}
