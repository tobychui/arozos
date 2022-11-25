package main

import (
	"imuslab.com/arozos/mod/time/nightly"
	//"imuslab.com/arozos/mod/time/scheduler"
)

/*
	Nightly.go
	author: tobychui

	This is a handle for putting everything that is required to run everynight.
	Default: Run once every day 3am in the morning.

*/

var (
	nightlyManager *nightly.TaskManager
	//systemScheduler *scheduler.Scheduler
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
	/*
		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "Tasks Scheduler",
			AdminOnly:   false,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				common.SendErrorResponse(w, "Permission Denied")
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
		newScheduler, err := scheduler.NewScheduler(userHandler, AGIGateway, "system/cron.json")
		if err != nil {
			systemWideLogger.PrintAndLog("Cron", "ArOZ Emulated Cron Startup Failed. Stopping all scheduled tasks.", err)
		}

		systemScheduler = newScheduler

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
		router.HandleFunc("/system/arsm/aecron/add", systemScheduler.HandleAddJob)
		router.HandleFunc("/system/arsm/aecron/remove", systemScheduler.HandleJobRemoval)
		router.HandleFunc("/system/arsm/aecron/listlog", systemScheduler.HandleShowLog)

		//Register settings
		registerSetting(settingModule{
			Name:         "Tasks Scheduler",
			Desc:         "System Tasks and Excution Scheduler",
			IconPath:     "SystemAO/arsm/img/small_icon.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/arsm/aecron.html",
			RequireAdmin: false,
		})
	*/
}
