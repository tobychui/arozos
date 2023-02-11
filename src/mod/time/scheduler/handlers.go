package scheduler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/utils"
)

//List all the jobs related to the given user
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
		BaseTime:          baseUnixTime,
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

//Deprecated. Replace with system wide logger
/*
func (a *Scheduler) HandleShowLog(w http.ResponseWriter, r *http.Request) {
	filename, _ := utils.GetPara(r,"filename")
	if filename == "" {
		//Show index
		logFiles, _ := filepath.Glob(logFolder + "*.log")

		//Convert all to linux syntax
		linuxLogFiles := []string{}
		for _, lf := range logFiles {
			linuxLogFiles = append(linuxLogFiles, filepath.Base(lf))
		}
		js, _ := json.Marshal(linuxLogFiles)
		sendJSONResponse(w, string(js))
	} else {
		//Show log content
		filename = strings.ReplaceAll(filepath.ToSlash(filename), "/", "")
		if fileExists(filepath.Join(logFolder, filename)) {
			logContent, err := os.ReadFile(filepath.Join(logFolder, filename))
			if err != nil {
				sendTextResponse(w, "Unable to load log file: "+filename)
			} else {
				sendTextResponse(w, string(logContent))
			}
		} else {
			sendTextResponse(w, "Unable to load log file: "+filename)
		}
	}
}
*/
