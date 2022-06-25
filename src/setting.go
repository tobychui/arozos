package main

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/common"
	module "imuslab.com/arozos/mod/modules"
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
		InitFWSize:  []int{1080, 580},
		LaunchFWDir: "SystemAO/system_setting/index.html",
		SupportEmb:  false,
	})
}

//Setting group defination. Your setting module defination must match the group in-order to be shown
func system_setting_getSettingGroups() []settingGroup {
	return []settingGroup{
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
			Desc:     "System Functions related to Time and Dates",
		},
		{
			Name:     "Security & Keys",
			Group:    "Security",
			IconPath: "SystemAO/system_setting/img/security.svg",
			Desc:     "System Security and Keypairs",
		},
		{
			Name:     "Advance Options",
			Group:    "Advance",
			IconPath: "SystemAO/system_setting/img/code.svg",
			Desc:     "Advance configs for developers",
		},
		{
			Name:     "About ArOZ",
			Group:    "About",
			IconPath: "SystemAO/system_setting/img/info.svg",
			Desc:     "Information of the current running ArOZ Online System",
		},
	}
}

func registerSetting(thismodule settingModule) {
	settingModules = append(settingModules, thismodule)
}

//List all the setting modules and output it as JSON
func system_setting_handleListing(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	allSettingGroups := system_setting_getSettingGroups()
	listGroup, _ := common.Mv(r, "listGroup", false)
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

		if len(results) > 0 {
			jsonString, _ := json.Marshal(results)
			common.SendJSONResponse(w, string(jsonString))
			return
		} else {
			//This group not found,
			common.SendErrorResponse(w, "Group not found")
			return
		}

	} else {
		//List all root groups
		jsonString, _ := json.Marshal(allSettingGroups)
		common.SendJSONResponse(w, string(jsonString))
		return
	}

}
