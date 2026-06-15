package main

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/agi"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/time/nightly"
	"imuslab.com/arozos/mod/time/scheduler"
	"imuslab.com/arozos/mod/utils"
)

/*
	Nightly.go
	author: tobychui

	This is a handle for putting everything that is required to run everynight.
	Default: Run once every day 3am in the morning.

*/

var (
	nightlyManager  *nightly.TaskManager
	systemScheduler *scheduler.Scheduler
)

func NightlyTasksInit() {
	/*
		Nighty Task Manager

		The tasks that should be done once per night. Internal function only.
	*/
	nightlyManager = nightly.NewNightlyTaskManager(*nightlyTaskRunTime)

}

func SchedulerInit() {

	/*
		System Scheudler

		The internal scheudler for arozos
	*/
	//Create an user router and its module

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Tasks Scheduler",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Tasks Scheduler",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Tasks Scheduler",
		Group:       "System Tools",
		IconPath:    "SystemAO/arsm/img/scheduler.png",
		Version:     "1.2",
		StartDir:    "SystemAO/arsm/scheduler.html",
		SupportFW:   true,
		InitFWSize:  []int{1080, 580},
		LaunchFWDir: "SystemAO/arsm/scheduler.html",
		SupportEmb:  false,
	})

	//Startup the ArOZ Emulated Crontab Service
	newScheduler, err := scheduler.NewScheduler(&scheduler.ScheudlerOption{
		UserHandler: userHandler,
		Gateway:     AGIGateway,
		Logger:      systemWideLogger,
		CronFile:    "system/cron.json",
	})
	if err != nil {
		systemWideLogger.PrintAndLog("Cron", "ArOZ Emulated Cron Startup Failed. Stopping all scheduled tasks.", err)
	}

	systemScheduler = newScheduler

	// Register the module uninstall hook to auto-clean cron jobs when a webapp is removed.
	moduleHandler.OnModuleUninstall = func(moduleName string) {
		systemWideLogger.PrintAndLog("Scheduler", "Module '"+moduleName+"' uninstalled – removing associated cron jobs", nil)
		newScheduler.RemoveJobsByApp(moduleName)
	}

	// Register the AGI scheduler library now that we have a scheduler instance.
	// We pass callback functions to avoid a circular import between agi and scheduler packages.
	AGIGateway.RegisterSchedulerLib(&agi.SchedulerCallbacks{
		RegisterJob: func(creator, appName, taskName, scriptVpath, fshID, description string, interval, baseTime int64) error {
			return newScheduler.RegisterJobFromAGI(creator, appName, taskName, scriptVpath, description, interval, baseTime)
		},
		UnregisterJob: func(creator, taskName string) error {
			return newScheduler.UnregisterJobFromAGI(creator, taskName)
		},
		AppJobExists: func(appName, creator, taskName string) bool {
			return newScheduler.AppJobExists(appName, creator, taskName)
		},
		CanCreate: func(username string) bool {
			u, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				return false
			}
			return u.CanCreateCronJob()
		},
	})

	//Register Endpoints
	http.HandleFunc("/system/arsm/aecron/list", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.CheckAuth(r) {
			//User logged in
			newScheduler.HandleListJobs(w, r)
		} else {
			//User not logged in
			errorHandlePermissionDenied(w, r)
		}
	})

	// Check whether the current user has cron creation permission
	http.HandleFunc("/system/arsm/aecron/permission", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.CheckAuth(r) {
			newScheduler.HandleCheckPermission(w, r)
		} else {
			errorHandlePermissionDenied(w, r)
		}
	})

	router.HandleFunc("/system/arsm/aecron/add", systemScheduler.HandleAddJob)
	router.HandleFunc("/system/arsm/aecron/remove", systemScheduler.HandleJobRemoval)

	// App-based scheduler registration endpoints (for webapp integration)
	router.HandleFunc("/system/arsm/aecron/app/register", systemScheduler.HandleAppRegisterJob)
	router.HandleFunc("/system/arsm/aecron/app/unregister", systemScheduler.HandleAppUnregisterJob)
	http.HandleFunc("/system/arsm/aecron/app/check", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.CheckAuth(r) {
			newScheduler.HandleAppCheckJob(w, r)
		} else {
			errorHandlePermissionDenied(w, r)
		}
	})

	// Admin endpoints for managing group cron permissions
	adminRouter.HandleFunc("/system/arsm/aecron/groupperm/list", handleListGroupCronPermissions)
	adminRouter.HandleFunc("/system/arsm/aecron/groupperm/set", handleSetGroupCronPermission)

	//Register settings
	registerSetting(settingModule{
		Name:         "Tasks Scheduler",
		Desc:         "System Tasks and Execution Scheduler",
		IconPath:     "SystemAO/arsm/img/small_icon.png",
		Group:        "Cluster",
		StartDir:     "SystemAO/arsm/aecron.html",
		RequireAdmin: false,
	})

}

// handleListGroupCronPermissions returns all permission groups and their cron creation setting
func handleListGroupCronPermissions(w http.ResponseWriter, r *http.Request) {
	ph := permissionHandler
	permMap := ph.GetGroupCronJobPermissionList()

	type groupPermEntry struct {
		GroupName        string
		IsAdmin          bool
		CanCreateCronJob bool
	}

	results := []groupPermEntry{}
	for _, pg := range ph.PermissionGroups {
		results = append(results, groupPermEntry{
			GroupName:        pg.Name,
			IsAdmin:          pg.IsAdmin,
			CanCreateCronJob: permMap[pg.Name],
		})
	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// handleSetGroupCronPermission sets the cron creation permission for a given group (admin only)
func handleSetGroupCronPermission(w http.ResponseWriter, r *http.Request) {
	groupName, err := utils.PostPara(r, "group")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid group name")
		return
	}

	allowStr, err := utils.PostPara(r, "allow")
	if err != nil {
		utils.SendErrorResponse(w, "Missing allow parameter")
		return
	}

	allow := (allowStr == "true")
	if err := permissionHandler.SetGroupCronJobPermission(groupName, allow); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}
