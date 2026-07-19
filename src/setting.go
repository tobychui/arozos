package main

import (
	"encoding/json"
	"net/http"

	module "imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/utils"
)

type settingModule struct {
	Name         string //Name of the setting module.
	Desc         string //Description of the setting module
	IconPath     string //Icon path for the setting module
	Group        string //Accept {}
	StartDir     string //Startup Directory / path
	RequireAdmin bool   //If the setting require admin access.
	//^ Enable this to hide this setting from non-admin users, but for API call, module has to handle admin check themselves.

}

type settingGroup struct {
	Name     string
	Group    string
	IconPath string
	Desc     string
}

var (
	settingModules []settingModule
)

func SystemSettingInit() {
	http.HandleFunc("/system/setting/list", system_setting_handleListing)

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "System Setting",
		Desc:        "Cutomize your systems to fit your needs",
		Group:       "System Settings",
		IconPath:    "SystemAO/system_setting/img/small_icon.png",
		Version:     "1.0",
		StartDir:    "SystemAO/system_setting/index.html",
		SupportFW:   true,
		InitFWSize:  []int{1200, 580},
		LaunchFWDir: "SystemAO/system_setting/index.html",
		SupportEmb:  false,
	})
}

// Setting group defination. Your setting module defination must match the group in-order to be shown
func system_setting_getSettingGroups() []settingGroup {
	groups := []settingGroup{
		{
			Name:     "Host Information",
			Group:    "Info",
			IconPath: "SystemAO/system_setting/img/server.svg",
			Desc:     "Config and info about the Server Host",
		},
		{
			Name:     "Devices & IoT",
			Group:    "Device",
			IconPath: "SystemAO/system_setting/img/device.svg",
			Desc:     "Connected clients and IoT devices",
		},
		{
			Name:     "Module Management",
			Group:    "Module",
			IconPath: "SystemAO/system_setting/img/module.svg",
			Desc:     "List of modules loaded in the system",
		},
		{
			Name:     "Desktop & Themes",
			Group:    "Desktop",
			IconPath: "SystemAO/desktop/img/personalization.png",
			Desc:     "Personalize your desktop experience",
		},
		{
			Name:     "Disk & Storage",
			Group:    "Disk",
			IconPath: "SystemAO/system_setting/img/drive.svg",
			Desc:     "Manage Storage Devices and Disks",
		},
		{
			Name:     "Network & Connection",
			Group:    "Network",
			IconPath: "SystemAO/system_setting/img/network.svg",
			Desc:     "Manage Host Network and Connections",
		},
		{
			Name:     "Users & Groups",
			Group:    "Users",
			IconPath: "SystemAO/system_setting/img/users.svg",
			Desc:     "Add, removed or edit users and groups",
		},
		{
			Name:     "Clusters & Scheduling",
			Group:    "Cluster",
			IconPath: "SystemAO/system_setting/img/cluster.svg",
			Desc:     "Cluster, Network Scanning and Task Scheduling",
		},
		{
			Name:     "Security & Auth",
			Group:    "Security",
			IconPath: "SystemAO/system_setting/img/security.svg",
			Desc:     "System Security and Auth Credentials",
		},
		{
			Name:     "Developer Options",
			Group:    "Advance",
			IconPath: "SystemAO/system_setting/img/code.svg",
			Desc:     "Advance configs for developers",
		},
		{
			Name:     "AI Integration",
			Group:    "AInteg",
			IconPath: "SystemAO/system_setting/img/ai.svg",
			Desc:     "Connect AI models, manage pricing, quota and usage",
		},
		{
			Name:     "About ArOZ",
			Group:    "About",
			IconPath: "SystemAO/system_setting/img/info.svg",
			Desc:     "Information of the current running ArOZ Online System",
		},
	}

	//The "Containers" group only has content when Docker management is active
	//(dockerManager is non-nil). Showing it otherwise would render an empty
	//group whose listing returns no modules and breaks the settings UI.
	if dockerManager != nil {
		containerGroup := settingGroup{
			Name:     "Containers",
			Group:    "Container",
			IconPath: "SystemAO/system_setting/img/docker.svg",
			Desc:     "Manage Docker Engine and container runtime",
		}
		//Insert just before the "About" group so it sits after AI Integration
		//rather than at the very bottom of the settings list.
		inserted := false
		for i, g := range groups {
			if g.Group == "About" {
				groups = append(groups[:i], append([]settingGroup{containerGroup}, groups[i:]...)...)
				inserted = true
				break
			}
		}
		if !inserted {
			groups = append(groups, containerGroup)
		}
	}

	return groups
}

func registerSetting(thismodule settingModule) {
	settingModules = append(settingModules, thismodule)
}

// List all the setting modules and output it as JSON
func system_setting_handleListing(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	allSettingGroups := system_setting_getSettingGroups()
	listGroup, _ := utils.GetPara(r, "listGroup")
	if len(listGroup) > 0 {
		//List the given group
		var results []settingModule
		for _, setMod := range settingModules {
			if setMod.Group == listGroup {
				//Check if the module is admin only.
				if setMod.RequireAdmin && userinfo.IsAdmin() {
					//Admin module and user is admin. Append to list
					results = append(results, setMod)
				} else if setMod.RequireAdmin == false {
					//Normal module. Append to list
					results = append(results, setMod)
				}

			}
		}

		//Always return a JSON array (possibly empty). The front-end iterates the
		//response with forEach, so returning an error object here would throw a
		//"forEach is not a function" in the settings UI for any empty group.
		if results == nil {
			results = []settingModule{}
		}
		jsonString, _ := json.Marshal(results)
		utils.SendJSONResponse(w, string(jsonString))
		return

	} else {
		//List all root groups
		jsonString, _ := json.Marshal(allSettingGroups)
		utils.SendJSONResponse(w, string(jsonString))
		return
	}

}
