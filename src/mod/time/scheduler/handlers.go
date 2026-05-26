package scheduler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/utils"
)

// List all the jobs related to the given user
func (a *Scheduler) HandleListJobs(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get username from user info
	username := userinfo.Username

	//Check if the user request list all
	listAll := false
	la, _ := utils.GetPara(r, "listall")
	if la == "true" && userinfo.IsAdmin() {
		listAll = true
	}

	//Find the scheduled task that belongs to this user
	userCreatedJobs := []*Job{}

	for _, thisJob := range a.jobs {
		if listAll {
			//List all the user jobs.
			userCreatedJobs = append(userCreatedJobs, thisJob)
		} else {
			//Only list user's job
			if thisJob.Creator == username {
				userCreatedJobs = append(userCreatedJobs, thisJob)
			}
		}

	}

	//Return the values as json
	js, _ := json.Marshal(userCreatedJobs)
	utils.SendJSONResponse(w, string(js))
}

func (a *Scheduler) HandleAddJob(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	// Check if the user has permission to create cron jobs
	if !userinfo.CanCreateCronJob() {
		utils.SendErrorResponse(w, "Permission Denied: your account does not have cron job creation permission")
		return
	}

	//Get required paramaters
	taskName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid task name")
		return
	}

	//Check taskname length valid
	if len(taskName) > 32 {
		utils.SendErrorResponse(w, "Task name must be shorter than 32 characters")
		return
	}

	//Check if the name already existsed
	for _, runningJob := range a.jobs {
		if runningJob.Name == taskName {
			utils.SendErrorResponse(w, "Task Name already occupied")
			return
		}
	}

	scriptpath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid script path")
		return
	}

	//Can be empty
	jobDescription, _ := utils.PostPara(r, "desc")
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(scriptpath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	fshAbs := fsh.FileSystemAbstraction
	realScriptPath, err := fshAbs.VirtualPathToRealPath(scriptpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if the file exists
	if !fshAbs.FileExists(realScriptPath) {
		utils.SendErrorResponse(w, "script file not exists")
		return
	}

	interval := int64(86400) //default 1 day in seconds
	intervalString, err := utils.PostPara(r, "interval")
	if err != nil {
		//Default 1 day

	} else {
		//Parse the intervalString into int
		intervalInt, err := strconv.ParseInt(intervalString, 10, 64)
		if err != nil {
			//Failed to parse interval to int
			utils.SendErrorResponse(w, "invalid interval")
			return
		}

		interval = intervalInt
	}

	baseUnixTime := time.Now().Unix()
	baseTimeString, err := utils.PostPara(r, "base")
	if err != nil {
		//Use curent timestamp as base

	} else {
		baseTimeInt, err := strconv.Atoi(baseTimeString)
		if err != nil {
			//Failed to parse interval to int
			utils.SendErrorResponse(w, "Invalid Base Time")
			return
		}

		baseUnixTime = int64(baseTimeInt)
	}

	//Create a new job
	newJob := Job{
		Name:              taskName,
		Creator:           userinfo.Username,
		Description:       jobDescription,
		ExecutionInterval: int64(interval),
		BaseTime:          alignBaseTime(baseUnixTime),
		ScriptVpath:       scriptpath,
		FshID:             fsh.UUID,
	}

	//Write current job lists to file
	a.jobs = append(a.jobs, &newJob)
	a.saveJobsToCronFile()

	//OK
	utils.SendOK(w)
}

func (a *Scheduler) HandleJobRemoval(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get required paramaters
	taskName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid task name")
		return
	}

	//Check if Job exists
	if !a.JobExists(taskName) {
		//Job with that name not exists
		utils.SendErrorResponse(w, "Job not exists")
		return
	}

	targetJob := a.GetScheduledJobByName(taskName)

	//Job exists. Check if the job is created by the user.
	//User can only remove job created by himself or all job is he is admin
	allowRemove := false
	if !userinfo.IsAdmin() && targetJob.Creator == userinfo.Username {
		allowRemove = true
	} else if userinfo.IsAdmin() {
		allowRemove = true
	}

	if !allowRemove {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	//Ok. Remove Job from the list
	a.RemoveJobFromScheduleList(taskName)

	//Write current job lists to file
	a.saveJobsToCronFile()

	utils.SendOK(w)
}

// HandleCheckPermission returns whether the current user has cron job creation permission
func (a *Scheduler) HandleCheckPermission(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	type permResult struct {
		CanCreate bool
	}
	js, _ := json.Marshal(permResult{CanCreate: userinfo.CanCreateCronJob()})
	utils.SendJSONResponse(w, string(js))
}

// HandleAppRegisterJob allows a webapp to register a cron job on behalf of the current user.
//
// The script lives inside the webapp's own folder (next to init.agi), NOT in user storage.
// POST params:
//
//	appname   – module folder name, e.g. "MyApp"  (required)
//	taskname  – unique task identifier, max 32 chars  (required)
//	scriptname – filename relative to the app folder, default "cron.agi"
//	interval  – execution interval in seconds, default 86400 (1 day)
//	base      – base unix timestamp for interval alignment, default now
//	desc      – optional description
func (a *Scheduler) HandleAppRegisterJob(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	// Permission check
	if !userinfo.CanCreateCronJob() {
		utils.SendErrorResponse(w, "Permission Denied: your account does not have cron job creation permission")
		return
	}

	appName, err := utils.PostPara(r, "appname")
	if err != nil || appName == "" {
		utils.SendErrorResponse(w, "Invalid app name")
		return
	}

	taskName, err := utils.PostPara(r, "taskname")
	if err != nil || taskName == "" {
		utils.SendErrorResponse(w, "Invalid task name")
		return
	}
	if len(taskName) > 32 {
		utils.SendErrorResponse(w, "Task name must be shorter than 32 characters")
		return
	}

	// Check name uniqueness
	for _, runningJob := range a.jobs {
		if runningJob.Name == taskName {
			utils.SendErrorResponse(w, "Task name already occupied")
			return
		}
	}

	// Script filename relative to the app folder, default cron.agi
	scriptName, _ := utils.PostPara(r, "scriptname")
	if scriptName == "" {
		scriptName = "cron.agi"
	}

	// Security: reject any path that tries to escape the app folder
	if strings.Contains(scriptName, "..") || strings.Contains(scriptName, "/") {
		utils.SendErrorResponse(w, "Invalid script name: must be a plain filename inside the app folder")
		return
	}

	// Resolve and verify the real path on disk
	relPath := appName + "/" + scriptName
	realScriptPath := filepath.Join(WebRootBase, filepath.FromSlash(relPath))
	if _, statErr := os.Stat(realScriptPath); os.IsNotExist(statErr) {
		utils.SendErrorResponse(w, "Script not found in app folder: "+relPath)
		return
	}

	jobDescription, _ := utils.PostPara(r, "desc")

	interval := int64(86400)
	if intervalString, ierr := utils.PostPara(r, "interval"); ierr == nil {
		intervalInt, perr := strconv.ParseInt(intervalString, 10, 64)
		if perr != nil {
			utils.SendErrorResponse(w, "Invalid interval")
			return
		}
		interval = intervalInt
	}

	baseUnixTime := time.Now().Unix()
	if baseTimeString, berr := utils.PostPara(r, "base"); berr == nil {
		baseTimeInt, perr := strconv.Atoi(baseTimeString)
		if perr != nil {
			utils.SendErrorResponse(w, "Invalid base time")
			return
		}
		baseUnixTime = int64(baseTimeInt)
	}

	newJob := Job{
		Name:              taskName,
		Creator:           userinfo.Username,
		Description:       jobDescription,
		ExecutionInterval: interval,
		BaseTime:          alignBaseTime(baseUnixTime),
		ScriptVpath:       relPath, // e.g. "MyApp/cron.agi"
		FshID:             WebRootFshID,
		AppName:           appName,
	}

	a.jobs = append(a.jobs, &newJob)
	a.saveJobsToCronFile()
	utils.SendOK(w)
}

// HandleAppCheckJob checks whether a specific app job is registered for the current user
// GET params: appname, taskname
func (a *Scheduler) HandleAppCheckJob(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	appName, _ := utils.GetPara(r, "appname")
	taskName, _ := utils.GetPara(r, "taskname")

	registered := a.AppJobExists(appName, userinfo.Username, taskName)
	type checkResult struct {
		Registered bool
	}
	js, _ := json.Marshal(checkResult{Registered: registered})
	utils.SendJSONResponse(w, string(js))
}

// HandleAppUnregisterJob removes a cron job registered by a specific app for the current user
// POST params: appname, taskname
func (a *Scheduler) HandleAppUnregisterJob(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	appName, err := utils.PostPara(r, "appname")
	if err != nil || appName == "" {
		utils.SendErrorResponse(w, "Invalid app name")
		return
	}

	taskName, err := utils.PostPara(r, "taskname")
	if err != nil || taskName == "" {
		utils.SendErrorResponse(w, "Invalid task name")
		return
	}

	// Find and verify ownership
	targetJob := a.GetScheduledJobByName(taskName)
	if targetJob == nil {
		utils.SendErrorResponse(w, "Job not found")
		return
	}
	if targetJob.AppName != appName {
		utils.SendErrorResponse(w, "Job not registered by this app")
		return
	}
	if targetJob.Creator != userinfo.Username && !userinfo.IsAdmin() {
		utils.SendErrorResponse(w, "Permission denied")
		return
	}

	a.RemoveJobFromScheduleList(taskName)
	a.saveJobsToCronFile()
	utils.SendOK(w)
}
