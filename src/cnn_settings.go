package main

import (
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	CNN Inference Settings Manager

	Registers the "CNN Inference" tab in System Settings > AI Integration and
	exposes the admin-only endpoints used to configure the external CXNNAIO
	vision-inference server (endpoint, token, request timeout) and to test
	connectivity against it.

	The AGI "cnn" library (mod/agi/agi.cnn.go) consumes the same configuration
	and is what AGI scripts actually call via requirelib("cnn"); the wire
	protocol itself lives in the standalone mod/aiservers/cnn client package.

	  GET  /system/cnn/config  – masked connection config
	  POST /system/cnn/config  – save connection config
	  POST /system/cnn/test    – connectivity test (health + model listing)

	All endpoints require administrator privileges.
*/

func CNNInferenceSettingInit() {
	//Register the settings tab in the "AI Integration" group.
	registerSetting(settingModule{
		Name:         "CNN Inference",
		Desc:         "Configure an external CXNNAIO vision-inference server for image/face recognition",
		IconPath:     "SystemAO/system_setting/img/cnn.svg",
		Group:        "AInteg",
		StartDir:     "SystemAO/advance/cnninference.html",
		RequireAdmin: true,
	})

	//Admin-only router. The connection config may contain a sensitive API
	//token, so every endpoint here is restricted to administrators.
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/cnn/config", AGIGateway.HandleCNNConfig)
	adminRouter.HandleFunc("/system/cnn/test", AGIGateway.HandleCNNTest)
}
