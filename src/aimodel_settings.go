package main

import (
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	AI Model Settings Manager

	Registers the "AI Model" tab in System Settings > Developer Options and
	exposes the admin-only endpoints used to configure the OpenAI-compatible
	endpoint, the global API key, per-model pricing and to view / reset the
	aggregated token & cost metrics.

	The AGI "aimodel" library (mod/agi/agi.aimodel.go) consumes the same
	configuration and writes the usage metrics that this page displays.

	  GET  /system/aimodel/config         – masked connection config
	  POST /system/aimodel/config         – save connection config
	  GET  /system/aimodel/pricing        – per-model pricing map
	  POST /system/aimodel/pricing        – save per-model pricing map
	  GET  /system/aimodel/metrics        – aggregated usage metrics
	  POST /system/aimodel/metrics/reset  – reset usage metrics
	  POST /system/aimodel/test           – connectivity test (lists models)

	All endpoints require administrator privileges.
*/

func AIModelSettingInit() {
	//Register the settings tab in the "Advance" (Developer Options) group.
	registerSetting(settingModule{
		Name:         "AI Model",
		Desc:         "Configure an OpenAI-compatible endpoint, per-model pricing and view token usage",
		IconPath:     "SystemAO/advance/img/small_icon.png",
		Group:        "Advance",
		StartDir:     "SystemAO/advance/aimodel.html",
		RequireAdmin: true,
	})

	//Admin-only router. The AI configuration contains a sensitive API key, so
	//every endpoint here is restricted to administrators.
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/aimodel/config", AGIGateway.HandleAIModelConfig)
	adminRouter.HandleFunc("/system/aimodel/pricing", AGIGateway.HandleAIModelPricing)
	adminRouter.HandleFunc("/system/aimodel/metrics", AGIGateway.HandleAIModelMetrics)
	adminRouter.HandleFunc("/system/aimodel/metrics/reset", AGIGateway.HandleAIModelMetricsReset)
	adminRouter.HandleFunc("/system/aimodel/test", AGIGateway.HandleAIModelTest)
}
