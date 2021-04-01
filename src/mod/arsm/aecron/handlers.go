package aecron

import (
	"encoding/json"
	"io/ioutil"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tidwall/pretty"
)

//List all the jobs related to the given user
func (a *Aecron) HandleListJobs(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get username from user info
	username := userinfo.Username
	isAdmin := userinfo.IsAdmin()

	//Check if the user request list all
	listAll := false
	la, _ := mv(r, "listall", false)
	if la == "true" && isAdmin {
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
	sendJSONResponse(w, string(js))
}

func (a *Aecron) HandleAddJob(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get required paramaters
	taskName, err := mv(r, "name", true)
	if err != nil {
		sendErrorResponse(w, "Invalid task name")
		return
	}

	//Check taskname length valid
	if len(taskName) > 32 {
		sendErrorResponse(w, "Task name must be shorter than 32 characters")
		return
	}

	//Check if the name already existsed
	for _, runningJob := range a.jobs {
		if runningJob.Name == taskName {
			sendErrorResponse(w, "Task Name already occupied")
			return
		}
	}

	scriptpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "Invalid script path")
		return
	}

	//Can be empty
	jobDescription, _ := mv(r, "desc", true)

	realScriptPath, err := userinfo.VirtualPathToRealPath(scriptpath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Check if the user has permission to create this script
	if filepath.Ext(realScriptPath) != ".js" && filepath.Ext(realScriptPath) != ".agi" {
		//Require admin permission
		if userinfo.IsAdmin() == false {
			sendErrorResponse(w, "Admin permission required for scheduling non AGI script")
			return
		}
	}

	interval := int64(86400) //default 1 day in seconds
	intervalString, err := mv(r, "interval", true)
	if err != nil {
		//Default 1 day

	} else {
		//Parse the intervalString into int
		intervalInt, err := strconv.ParseInt(intervalString, 10, 64)
		if err != nil {
			//Failed to parse interval to int
			sendErrorResponse(w, "Invalid interval")
			return
		}

		interval = intervalInt
	}

	baseUnixTime := time.Now().Unix()
	baseTimeString, err := mv(r, "base", true)
	if err != nil {
		//Use curent timestamp as base

	} else {
		baseTimeInt, err := strconv.Atoi(baseTimeString)
		if err != nil {
			//Failed to parse interval to int
			sendErrorResponse(w, "Invalid Base Time")
			return
		}

		baseUnixTime = int64(baseTimeInt)
	}

	//Create a new job
	newJob := Job{
		Name:              taskName,
		Creator:           userinfo.Username,
		Admin:             userinfo.IsAdmin(),
		Description:       jobDescription,
		ExecutionInterval: int64(interval),
		BaseTime:          baseUnixTime,
		ScriptFile:        realScriptPath,
	}

	//Write current job lists to file
	a.jobs = append(a.jobs, &newJob)

	js, _ := json.MarshalIndent(a.jobs, "", " ")

	ioutil.WriteFile(a.cronfile, js, 0755)

	//OK
	sendOK(w)
}

func (a *Aecron) HandleJobRemoval(w http.ResponseWriter, r *http.Request) {
	userinfo, err := a.userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get required paramaters
	taskName, err := mv(r, "name", true)
	if err != nil {
		sendErrorResponse(w, "Invalid task name")
		return
	}

	//Check if Job exists
	if !a.JobExists(taskName) {
		//Job with that name not exists
		sendErrorResponse(w, "Job not exists")
		return
	}

	targetJob := a.GetScheduledJobByName(taskName)

	//Job exists. Check if the job is created by the user.
	//User can only remove job created by himself or all job is he is admin
	allowRemove := false
	if userinfo.IsAdmin() == false && targetJob.Creator == userinfo.Username {
		allowRemove = true
	} else if userinfo.IsAdmin() == true {
		allowRemove = true
	}

	if !allowRemove {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	//Ok. Remove Job from the list
	a.RemoveJobFromScheduleList(taskName)

	//Write current job lists to file
	js, _ := json.Marshal(a.jobs)
	js = []byte(pretty.Pretty(js))
	ioutil.WriteFile(a.cronfile, js, 0755)

	sendOK(w)
}

func (a *Aecron) HandleShowLog(w http.ResponseWriter, r *http.Request) {
	filename, _ := mv(r, "filename", false)
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
			logContent, err := ioutil.ReadFile(filepath.Join(logFolder, filename))
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
