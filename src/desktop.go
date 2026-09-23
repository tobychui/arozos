package main

import (
	"net/http"
	"os"

	desktop "imuslab.com/arozos/mod/desktop/service"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	desktop.go

	Wires up the ArozOS web desktop. The handlers live in mod/desktop/service,
	backed by mod/desktop/{icons,layout,prefs,wallpaper}.
*/

// Desktop script initiation
func DesktopInit() {
	systemWideLogger.PrintAndLog("Desktop", "Starting Desktop Services", nil)

	desktopOptions := desktop.Options{
		Database:           sysdb,
		Users:              userHandler,
		Modules:            moduleHandler,
		ResolveVirtualPath: GetFSHandlerSubpathFromVpath,
		HostInfo: func() desktop.HostInfo {
			return desktop.HostInfo{
				Hostname:        *host_name,
				DeviceUUID:      deviceUUID,
				BuildVersion:    build_version,
				InternalVersion: internal_version,
				DeviceVendor:    deviceVendor,
				DeviceModel:     deviceModel,
			}
		},
	}
	if shareManager != nil {
		desktopOptions.Shares = shareManager
	}

	desktopService, err := desktop.New(desktopOptions)
	if err != nil {
		systemWideLogger.PrintAndLog("System", "Unable to start Desktop services. Please validation your installation.", err)
		os.Exit(1)
	}

	desktopService.RegisterRoutes(prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Desktop",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	}))

	//Register Desktop settings sub-items
	for _, setting := range []settingModule{
		{Name: "Wallpaper", Desc: "Desktop Wallpaper Settings", StartDir: "SystemAO/desktop/settings/wallpaper.html"},
		{Name: "Sounds", Desc: "System Sound Settings", StartDir: "SystemAO/desktop/settings/sounds.html"},
		{Name: "Theme", Desc: "System Theme Color", StartDir: "SystemAO/desktop/settings/theme.html"},
		{Name: "Mobile UX", Desc: "Mobile Desktop Shortcuts", StartDir: "SystemAO/desktop/settings/mobile_ux.html"},
	} {
		setting.IconPath = "SystemAO/desktop/img/personalization.png"
		setting.Group = "Desktop"
		registerSetting(setting)
	}

	//Register Desktop Module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Desktop",
		Desc:        "The Web Desktop experience for everyone",
		Group:       "Interface Module",
		IconPath:    "img/desktop/desktop.png",
		Version:     internal_version,
		StartDir:    "",
		SupportFW:   false,
		LaunchFWDir: "",
		SupportEmb:  false,
	})
}
