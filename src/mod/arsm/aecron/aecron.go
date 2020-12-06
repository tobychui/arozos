package aecron

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/user"
)

/*
	ArOZ Emulated Crontab
	author: tobychui

	This is not actually a crontab but something similar that provide
	timered operations for executing commands in agi or bash in an interval
	bases

*/

type Job struct {
	Name              string //The name of this job
	Creator           string //The creator of this job. When execute, this user permission will be used
	Description       string //Job description, can be empty
	Admin             bool   //If the creator has admin permission during the creation of this job. If this doesn't match with the runtime instance, this job wille be skipped
	ExecutionInterval int64  //Execuation interval in seconds
	BaseTime          int64  //Exeuction basetime. The next interval is calculated using (current time - base time ) % execution interval
	ScriptFile        string //The script file being called. Can be an agi script (.agi / .js) or shell script (.bat or .sh)
}

type Aecron struct {
	jobs        []*Job
	cronfile    string
	userHandler *user.UserHandler
	gateway     *agi.Gateway
	ticker      chan bool
}

var (
	logFolder string = "./system/aecron/"
)

func NewArozEmulatedCrontab(userHandler *user.UserHandler, gateway *agi.Gateway, cronfile string) (*Aecron, error) {
	if !fileExists(cronfile) {
		//Cronfile not exists. Create it
		emptyJobList := []*Job{}
		ls, _ := json.Marshal(emptyJobList)
		err := ioutil.WriteFile(cronfile, ls, 0755)
		if err != nil {
			return nil, err
		}
	}

	//Load previous jobs from file
	jobs, err := loadJobsFromFile(cronfile)
	if err != nil {
		return nil, err
	}

	//Create the ArOZ Emulated Crontask
	aecron := Aecron{
		jobs:        jobs,
		userHandler: userHandler,
		gateway:     gateway,
		cronfile:    cronfile,
	}

	//Create log folder
	os.MkdirAll(logFolder, 0755)

	//Start the cronjob at 1 minute ticker interval
	go func() {
		//Delay start: Wait until seconds = 0
		for time.Now().Unix()%60 > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		stopChannel := aecron.createTicker(1 * time.Minute)
		aecron.ticker = stopChannel
		log.Println("Emulated Crontab Started - Scheduling Tasks")
	}()

	//Return the crontask
	return &aecron, nil
}

//Load a list of jobs from file
func loadJobsFromFile(cronfile string) ([]*Job, error) {
	//Try to read the cronfile
	filecontent, err := ioutil.ReadFile(cronfile)
	if err != nil {
		return []*Job{}, err
	}

	//Phrase the cronfile
	prevousJobs := []Job{}
	err = json.Unmarshal(filecontent, &prevousJobs)
	if err != nil {
		return []*Job{}, err
	}

	//Convert the json objets to pointer for easy changing by other process
	jobsPointers := []*Job{}
	for _, thisJob := range prevousJobs {
		var newJobPointer Job = thisJob
		jobsPointers = append(jobsPointers, &newJobPointer)
	}

	return jobsPointers, nil
}

func (a *Aecron) createTicker(duration time.Duration) chan bool {
	ticker := time.NewTicker(duration)
	stop := make(chan bool, 1)

	go func() {
		defer log.Println("Aecron Stopped")
		for {
			select {
			case <-ticker.C:
				//Run jobs
				for _, thisJob := range a.jobs {
					if (time.Now().Unix()-thisJob.BaseTime)%thisJob.ExecutionInterval == 0 {
						//Execute this job
						scriptFile := thisJob.ScriptFile
						if !fileExists(scriptFile) {
							//This job no longer exists in the file system. Remove it
							a.RemoveJobFromScheduleList(thisJob.Name)
						}
						clonedJobStructure := *thisJob
						ext := filepath.Ext(scriptFile)
						if ext == ".js" || ext == ".agi" {
							//Run using AGI interface in go routine
							go func(thisJob Job) {
								userinfo, err := a.userHandler.GetUserInfoFromUsername(thisJob.Creator)
								if err != nil {
									//This user not exists. Skip this script
									cronlog("[ERROR] User not exists: " + thisJob.Creator + ". Skipping scheduled job: " + thisJob.Name + ".")
									return
								}

								//Run the script with this user scope
								resp, err := a.gateway.ExecuteAGIScriptAsUser(thisJob.ScriptFile, userinfo)
								if err != nil {
									cronlog("[ERROR] " + thisJob.Name + " " + err.Error())
								} else {
									cronlog(thisJob.Name + " " + resp)
								}
							}(clonedJobStructure)

						} else if ext == ".bat" || ext == ".sh" {
							//Run as shell script
							go func(thisJob Job) {
								scriptPath := thisJob.ScriptFile
								if runtime.GOOS == "windows" {
									scriptPath = strings.ReplaceAll(filepath.ToSlash(scriptPath), "/", "\\")
								}
								cmd := exec.Command(scriptPath)
								out, err := cmd.CombinedOutput()
								if err != nil {
									cronlog("[ERROR] " + thisJob.Name + " " + err.Error() + " => " + string(out))
								}
								cronlog(thisJob.Name + " " + string(out))
							}(clonedJobStructure)
						} else {
							//Unknown script file. Ignore this
							log.Println("This extension is not yet supported: ", ext)
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

func (a *Aecron) Close() {
	if a.ticker != nil {
		//Stop the ticker
		a.ticker <- true
	}
}

func (a *Aecron) GetScheduledJobByName(name string) *Job {
	for _, thisJob := range a.jobs {
		if thisJob.Name == name {
			return thisJob
		}
	}

	return nil
}

func (a *Aecron) RemoveJobFromScheduleList(taskName string) {
	newJobSlice := []*Job{}
	for _, j := range a.jobs {
		if j.Name != taskName {
			thisJob := j
			newJobSlice = append(newJobSlice, thisJob)
		}
	}
	a.jobs = newJobSlice
}

func (a *Aecron) JobExists(name string) bool {
	targetJob := a.GetScheduledJobByName(name)
	if targetJob == nil {
		return false
	} else {
		return true
	}
}

//Write the output to log file. Default to ./system/aecron/{date}.log
func cronlog(message string) {
	currentTime := time.Now()
	timestamp := currentTime.Format("2006-01-02 15:04:05")
	message = timestamp + " " + message
	currentLogFile := filepath.ToSlash(filepath.Clean(logFolder)) + "/" + time.Now().Format("01-02-2006") + ".log"
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
