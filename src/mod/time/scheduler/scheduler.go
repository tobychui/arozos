package scheduler

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

// WebRootFshID is stored in Job.FshID for scripts that live inside the webapp
// folder (./web/<AppName>/…) rather than in a user's virtual filesystem.
// At execution time the scheduler resolves the script via the OS filesystem
// instead of the user's storage pool.
const WebRootFshID = "__webroot__"

// WebRootBase is the directory from which app-relative script paths are resolved.
const WebRootBase = "./web"

/*
	ArozOS System Scheduler
	author: tobychui

	This module provide scheduling executable feature for ArozOS
	Some feature was migrated from the v1.113 aecron module
*/

type Job struct {
	Name              string //The name of this job
	Creator           string //The creator of this job. When execute, this user permission will be used
	Description       string //Job description, can be empty
	ExecutionInterval int64  //Execuation interval in seconds
	BaseTime          int64  //Exeuction basetime. The next interval is calculated using (current time - base time ) % execution interval
	FshID             string //The target FSH ID that this script file is stored
	ScriptVpath       string //The agi script file being called, require Vpath
	AppName           string //The webapp/module that registered this job (empty for manual jobs)

	lastExecutionTime   int64  //Last time this job being executed
	lastExecutionOutput string //The output of last execution
}

type ScheudlerOption struct {
	UserHandler *user.UserHandler
	Gateway     *agi.Gateway
	Logger      *logger.Logger
	CronFile    string //The location of the cronfile which store the jobs registry in file format
}

type Scheduler struct {
	jobs    []*Job
	options *ScheudlerOption
	ticker  chan bool
}

var ()

func NewScheduler(option *ScheudlerOption) (*Scheduler, error) {
	if !utils.FileExists(option.CronFile) {
		//Cronfile not exists. Create it
		emptyJobList := []*Job{}
		ls, _ := json.Marshal(emptyJobList)
		err := os.WriteFile(option.CronFile, ls, 0755)
		if err != nil {
			return nil, err
		}
	}

	//Load previous jobs from file
	jobs, err := loadJobsFromFile(option.CronFile)
	if err != nil {
		return nil, err
	}

	//Create the ArOZ Emulated Crontask
	thisScheduler := Scheduler{
		jobs:    jobs,
		options: option,
	}

	option.Logger.PrintAndLog("Scheduler", "Scheduler started", nil)

	//Start the cronjob at 1 minute ticker interval
	go func() {
		//Delay start: Wait until seconds = 0
		for time.Now().Unix()%60 > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		stopChannel := thisScheduler.createTicker(1 * time.Minute)
		thisScheduler.ticker = stopChannel
		option.Logger.PrintAndLog("Scheduler", "ArozOS System Scheduler Started", nil)
	}()

	//Return the crontask
	return &thisScheduler, nil
}

func (a *Scheduler) createTicker(duration time.Duration) chan bool {
	ticker := time.NewTicker(duration)
	stop := make(chan bool, 1)

	go func() {
		defer logger.PrintAndLog("Scheduler", "Scheduler Stopped", nil)
		for {
			select {
			case <-ticker.C:
				//Run jobs
				for _, thisJob := range a.jobs {
					if (time.Now().Unix()-thisJob.BaseTime)%thisJob.ExecutionInterval == 0 {
						a.executeJob(thisJob)
					}
				}
			case <-stop:
				return
			}
		}
	}()

	return stop
}

// executeJob resolves the script path and runs it in a goroutine.
// It supports two modes:
//
//  1. App-root scripts (FshID == WebRootFshID):
//     ScriptVpath is relative to ./web/, e.g. "MyApp/cron.agi".
//     The file is read directly from the OS; no user FSH is involved.
//
//  2. User virtual-path scripts (any other FshID):
//     ScriptVpath is a virtual path like "user:/path/to/script.agi".
//     The file is resolved through the creator's storage pool.
func (a *Scheduler) executeJob(thisJob *Job) {
	targetUser, err := a.options.UserHandler.GetUserInfoFromUsername(thisJob.Creator)
	if err != nil {
		a.cronlogError("User "+thisJob.Creator+" no longer exists", err)
		return
	}

	cloned := *thisJob

	if thisJob.FshID == WebRootFshID {
		// ── App-root script ───────────────────────────────────────────────
		rpath := filepath.Join(WebRootBase, filepath.FromSlash(thisJob.ScriptVpath))
		if _, statErr := os.Stat(rpath); os.IsNotExist(statErr) {
			a.cronlog("Removing job " + thisJob.Name + " by " + thisJob.Creator + " as app script no longer exists: " + rpath)
			a.RemoveJobFromScheduleList(thisJob.Name)
			a.saveJobsToCronFile()
			return
		}
		ext := filepath.Ext(rpath)
		if ext != ".js" && ext != ".agi" {
			a.cronlogError("Unsupported app script extension: "+ext, errors.New("unsupported extension"))
			return
		}
		go func(job Job, realPath string, u *user.User) {
			job.lastExecutionTime = time.Now().Unix()
			// fsh == nil --> ExecuteAGIScriptAsUser reads via os.ReadFile
			execID, resp, execErr := a.options.Gateway.ExecuteAGIScriptAsUser(nil, realPath, u, nil, nil)
			if execErr != nil {
				a.cronlogError("["+execID+"] "+job.Name+" execution error: "+execErr.Error(), execErr)
				job.lastExecutionOutput = execErr.Error()
			} else {
				a.cronlog("[" + execID + "] " + job.Name + " executed: " + resp)
				job.lastExecutionOutput = resp
			}
		}(cloned, rpath, targetUser)
		return
	}

	// ── User virtual-path script ──────────────────────────────────────────
	fsh, err := targetUser.GetFileSystemHandlerFromVirtualPath(thisJob.ScriptVpath)
	if err != nil {
		a.cronlogError("Unable to resolve vpath for job: "+thisJob.Name+" (user: "+thisJob.Creator+")", err)
		return
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(thisJob.ScriptVpath, targetUser.Username)
	if err != nil {
		a.cronlogError("Unable to get real path for job: "+thisJob.Name, err)
		return
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		a.cronlog("Removing job " + thisJob.Name + " by " + thisJob.Creator + " as script no longer exists")
		a.RemoveJobFromScheduleList(thisJob.Name)
		a.saveJobsToCronFile()
		return
	}
	ext := filepath.Ext(rpath)
	if ext != ".js" && ext != ".agi" {
		a.cronlogError("Unsupported script extension: "+ext, errors.New("unsupported extension"))
		return
	}
	go func(job Job, f *filesystem.FileSystemHandler, realPath string, u *user.User) {
		job.lastExecutionTime = time.Now().Unix()
		execID, resp, execErr := a.options.Gateway.ExecuteAGIScriptAsUser(f, realPath, u, nil, nil)
		if execErr != nil {
			a.cronlogError("["+execID+"] "+job.Name+" execution error: "+execErr.Error(), execErr)
			job.lastExecutionOutput = execErr.Error()
		} else {
			a.cronlog("[" + execID + "] " + job.Name + " executed: " + resp)
			job.lastExecutionOutput = resp
		}
	}(cloned, fsh, rpath, targetUser)
}

func (a *Scheduler) Close() {
	if a.ticker != nil {
		//Stop the ticker
		a.ticker <- true
	}
}

// Add an job object to system scheduler
func (a *Scheduler) AddJobToScheduler(job *Job) error {
	a.jobs = append(a.jobs, job)
	return nil
}

func (a *Scheduler) GetScheduledJobByName(name string) *Job {
	for _, thisJob := range a.jobs {
		if thisJob.Name == name {
			return thisJob
		}
	}

	return nil
}

func (a *Scheduler) RemoveJobFromScheduleList(taskName string) {
	newJobSlice := []*Job{}
	for _, j := range a.jobs {
		if j.Name != taskName {
			thisJob := j
			newJobSlice = append(newJobSlice, thisJob)
		}
	}
	a.jobs = newJobSlice
}

func (a *Scheduler) JobExists(name string) bool {
	targetJob := a.GetScheduledJobByName(name)
	if targetJob == nil {
		return false
	} else {
		return true
	}
}

// GetJobsByApp returns all jobs registered by the given app name
func (a *Scheduler) GetJobsByApp(appName string) []*Job {
	result := []*Job{}
	for _, j := range a.jobs {
		if j.AppName == appName {
			result = append(result, j)
		}
	}
	return result
}

// RemoveJobsByApp removes all scheduler jobs associated with a given app name and saves to disk
func (a *Scheduler) RemoveJobsByApp(appName string) {
	newJobSlice := []*Job{}
	for _, j := range a.jobs {
		if j.AppName != appName {
			newJobSlice = append(newJobSlice, j)
		}
	}
	a.jobs = newJobSlice
	a.saveJobsToCronFile()
}

// AppJobExists checks whether a job with the given name was registered by the given app and creator
func (a *Scheduler) AppJobExists(appName, creator, taskName string) bool {
	for _, j := range a.jobs {
		if j.AppName == appName && j.Creator == creator && j.Name == taskName {
			return true
		}
	}
	return false
}

// RegisterJobFromAGI creates and saves a new job on behalf of a user/app from AGI scripts.
//
// When appName is non-empty and scriptVpath does not contain ":" (i.e. it is not
// a user virtual path), the script is treated as app-root-relative:
//
//	scriptVpath = "cron.agi"  -->  stored as "appName/cron.agi", FshID = WebRootFshID
//
// Otherwise scriptVpath must be a full virtual path (e.g. "user:/path/to/script.agi")
// and is resolved through the creator's storage pool as usual.
func (a *Scheduler) RegisterJobFromAGI(creator, appName, taskName, scriptVpath, description string, interval, baseTime int64) error {
	// Validate name uniqueness
	for _, j := range a.jobs {
		if j.Name == taskName {
			return errors.New("task name already occupied: " + taskName)
		}
	}

	var fshID string
	var storedVpath string

	isAppScript := appName != "" && !containsVpathSeparator(scriptVpath)
	if isAppScript {
		// App-root script: resolve relative to ./web/<appName>/
		relPath := appName + "/" + scriptVpath
		realPath := filepath.Join(WebRootBase, filepath.FromSlash(relPath))
		if _, err := os.Stat(realPath); os.IsNotExist(err) {
			return errors.New("app script not found: " + realPath)
		}
		fshID = WebRootFshID
		storedVpath = relPath
	} else {
		// User virtual-path script
		targetUser, err := a.options.UserHandler.GetUserInfoFromUsername(creator)
		if err != nil {
			return err
		}
		fsh, err := targetUser.GetFileSystemHandlerFromVirtualPath(scriptVpath)
		if err != nil {
			return err
		}
		fshID = fsh.UUID
		storedVpath = scriptVpath
	}

	newJob := &Job{
		Name:              taskName,
		Creator:           creator,
		AppName:           appName,
		Description:       description,
		ExecutionInterval: interval,
		BaseTime:          alignBaseTime(baseTime),
		ScriptVpath:       storedVpath,
		FshID:             fshID,
	}

	a.jobs = append(a.jobs, newJob)
	return a.saveJobsToCronFile()
}

// alignBaseTime floors t to the nearest whole minute so that the scheduler's
// per-minute ticker (which fires at unix timestamps divisible by 60) can
// satisfy the condition (ticker - baseTime) % interval == 0.
// Without this alignment, any job with interval < 86400 that was registered
// at a non-minute boundary will never fire.
func alignBaseTime(t int64) int64 {
	return (t / 60) * 60
}

// containsVpathSeparator returns true when s contains the ":" that marks a
// virtual-path root (e.g. "user:/…" or "tmp:/…").
func containsVpathSeparator(s string) bool {
	for _, c := range s {
		if c == ':' {
			return true
		}
	}
	return false
}

// UnregisterJobFromAGI removes a job by task name for a given creator (or admin)
func (a *Scheduler) UnregisterJobFromAGI(creator, taskName string) error {
	targetJob := a.GetScheduledJobByName(taskName)
	if targetJob == nil {
		return errors.New("job not found: " + taskName)
	}
	if targetJob.Creator != creator {
		// Check if creator is admin (requires a UserHandler; deny if unavailable)
		if a.options.UserHandler == nil {
			return errors.New("permission denied")
		}
		targetUser, err := a.options.UserHandler.GetUserInfoFromUsername(creator)
		if err != nil || !targetUser.IsAdmin() {
			return errors.New("permission denied")
		}
	}
	a.RemoveJobFromScheduleList(taskName)
	return a.saveJobsToCronFile()
}

//Write the output to log file. Default to ./system/aecron/{date}.log
/*
func cronlog(message string) {
	currentTime := time.Now()
	timestamp := currentTime.Format("2006-01-02 15:04:05")
	message = timestamp + " " + message
	currentLogFile := filepath.ToSlash(filepath.Clean(logFolder)) + "/" + time.Now().Format("2006-02-01") + ".log"
	f, err := os.OpenFile(currentLogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		//Unable to write to file. Log to STDOUT instead
		logger.PrintAndLog("Scheduler", fmt.Sprint(message), nil)
		return
	}
	if _, err := f.WriteString(message + "\n"); err != nil {
		logger.PrintAndLog("Scheduler", fmt.Sprint(message), nil)
		return
	}
	defer f.Close()

}
*/
