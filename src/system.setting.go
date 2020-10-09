package main

import (
	"encoding/json"
	"net/http"
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

func system_setting_init() {
	http.HandleFunc("/system/setting/list", system_setting_handleListing)

	//Register the module
	registerModule(moduleInfo{
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
		settingGroup{
			Name:     "Host Information",
			Group:    "Info",
			IconPath: "SystemAO/system_setting/img/info.png",
			Desc:     "View basic system information",
		},
		settingGroup{
			Name:     "Devices & IoT",
			Group:    "Device",
			IconPath: "SystemAO/system_setting/img/device.png",
			Desc:     "Connected clients and IoT devices",
		},
		settingGroup{
			Name:     "Module Management",
			Group:    "Module",
			IconPath: "SystemAO/system_setting/img/module.png",
			Desc:     "List of modules loaded in the system",
		},
		settingGroup{
			Name:     "Disk & Storage",
			Group:    "Disk",
			IconPath: "SystemAO/system_setting/img/disk.png",
			Desc:     "Manage Storage Devices and Disks",
		},
		settingGroup{
			Name:     "Network & Connection",
			Group:    "Network",
			IconPath: "SystemAO/system_setting/img/network.png",
			Desc:     "Manage Host Network and Connections",
		},
		settingGroup{
			Name:     "Users & Groups",
			Group:    "Users",
			IconPath: "SystemAO/system_setting/img/users.png",
			Desc:     "Add, removed or edit users and groups",
		},
		settingGroup{
			Name:     "Date & Time",
			Group:    "Time",
			IconPath: "SystemAO/system_setting/img/time.png",
			Desc:     "Modify System Timezone and date",
		},
		settingGroup{
			Name:     "About ArOZ",
			Group:    "About",
			IconPath: "SystemAO/system_setting/img/about.png",
			Desc:     "Information of the current running ArOZ Online System",
		},
	}
}

func registerSetting(thismodule settingModule) {
	settingModules = append(settingModules, thismodule)
}

//List all the setting modules and output it as JSON
func system_setting_handleListing(w http.ResponseWriter, r *http.Request) {
	username, err := system_auth_getUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	usergroup, _ := system_permission_getUserGroups(username)
	allSettingGroups := system_setting_getSettingGroups()
	listGroup, _ := mv(r, "listGroup", false)
	if len(listGroup) > 0 {
		//List the given group
		var results []settingModule
		for _, setMod := range settingModules {
			if setMod.Group == listGroup {
				//Check if the module is admin only.
				if setMod.RequireAdmin && usergroup == "administrator" {
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
			sendJSONResponse(w, string(jsonString))
			return
		} else {
			//This group not found,
			sendErrorResponse(w, "Group not found")
			return
		}

	} else {
		//List all root groups
		jsonString, _ := json.Marshal(allSettingGroups)
		sendJSONResponse(w, string(jsonString))
		return
	}

}
