package scheduler

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

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
		err := ioutil.WriteFile(option.CronFile, ls, 0755)
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
		defer log.Println("Scheduler Stopped")
		for {
			select {
			case <-ticker.C:
				//Run jobs
				for _, thisJob := range a.jobs {
					if (time.Now().Unix()-thisJob.BaseTime)%thisJob.ExecutionInterval == 0 {
						//Execute this job
						//Get the creator userinfo
						targetUser, err := a.options.UserHandler.GetUserInfoFromUsername(thisJob.Creator)
						if err != nil {
							a.cronlogError("User "+thisJob.Creator+" no longer exists", err)
							return
						}

						//Check if the script exists
						fsh, err := targetUser.GetFileSystemHandlerFromVirtualPath(thisJob.ScriptVpath)
						if err != nil {
							a.cronlogError("Unable to resolve required vpath for job: "+thisJob.Name+" for user "+thisJob.Creator, err)
							return
						}

						rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(thisJob.ScriptVpath, targetUser.Username)
						if err != nil {
							a.cronlogError("Unable to resolve file real path for job: "+thisJob.Name+" for user "+thisJob.Creator, err)
							return
						}

						if !fsh.FileSystemAbstraction.FileExists(rpath) {
							//This job no longer exists in the file system. Remove it
							a.cronlog("Removing job " + thisJob.Name + " by " + thisJob.Creator + " as job file no longer exists")
							a.RemoveJobFromScheduleList(thisJob.Name)
							return
						}

						clonedJobStructure := *thisJob
						ext := filepath.Ext(rpath)
						if ext == ".js" || ext == ".agi" {
							//Run using AGI interface in go routine
							go func(thisJob Job) {
								//Resolve the sript path to realpath
								//Run the script with this user scope
								thisJob.lastExecutionTime = time.Now().Unix()
								resp, err := a.options.Gateway.ExecuteAGIScriptAsUser(fsh, rpath, targetUser, nil)
								if err != nil {
									a.cronlogError(thisJob.Name+" execution error: "+err.Error(), err)
									thisJob.lastExecutionOutput = err.Error()
								} else {
									a.cronlog(thisJob.Name + " executed: " + resp)
									thisJob.lastExecutionOutput = resp
								}
							}(clonedJobStructure)

						} else {
							//Unknown script file. Ignore this
							a.cronlogError("This extension is not yet supported: "+ext, errors.New("unsupported AGI interface script extension"))
						}

					}
				}
			case <-stop:
				return
			}
		}
	}()

	return stop
}

func (a *Scheduler) Close() {
	if a.ticker != nil {
		//Stop the ticker
		a.ticker <- true
	}
}

//Add an job object to system scheduler
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
		log.Println(message)
		return
	}
	if _, err := f.WriteString(message + "\n"); err != nil {
		log.Println(message)
		return
	}
	defer f.Close()

}
*/
