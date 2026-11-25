package scheduler

import (
	"encoding/json"
	"fmt"
	"os"

	"imuslab.com/arozos/mod/info/logger"
)

// Load a list of jobs from file
func loadJobsFromFile(cronfile string) (out0 []*Job, out1 error) {
	defer logger.Out2(logger.In1("time/scheduler", "loadJobsFromFile", "cronfile", cronfile), &out0, &out1)
	//Try to read the cronfile
	filecontent, err := os.ReadFile(cronfile)
	if err != nil {
		logger.DebugErr("time/scheduler", err)
		return []*Job{}, err
	}

	//Phrase the cronfile
	prevousJobs := []*Job{}
	err = json.Unmarshal(filecontent, &prevousJobs)
	if err != nil {
		logger.DebugErr("time/scheduler", err)
		return []*Job{}, err
	}

	return prevousJobs, nil
}

// save the changes in job list to file
func (a *Scheduler) saveJobsToCronFile() (out0 error) {
	defer logger.Out1(logger.In1("time/scheduler", "Scheduler.saveJobsToCronFile", "a", a), &out0)
	js, err := json.Marshal(a.jobs)
	if err != nil {
		logger.DebugErr("time/scheduler", err)
		return err
	}
	return os.WriteFile(a.options.CronFile, js, 0775)
}

func (a *Scheduler) cronlog(message string) {
	logger.DebugTrace("time/scheduler", "Scheduler.cronlog")
	a.options.Logger.PrintAndLog("Scheduler", fmt.Sprint(message), nil)
}

func (a *Scheduler) cronlogError(message string, err error) {
	logger.DebugTrace("time/scheduler", "Scheduler.cronlogError")
	a.options.Logger.PrintAndLog("Scheduler", message, err)
}
