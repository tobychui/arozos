package scheduler

import (
	"encoding/json"
	"fmt"
	"os"

	"imuslab.com/arozos/mod/info/logger"
)

// Load a list of jobs from file
func loadJobsFromFile(cronfile string) ([]*Job, error) {
	if logger.IsDebug() {
		logger.Debugf("time/scheduler", "loadJobsFromFile: cronfile=%.120q", cronfile)
	}
	//Try to read the cronfile
	filecontent, err := os.ReadFile(cronfile)
	if err != nil {
		return []*Job{}, err
	}

	//Phrase the cronfile
	prevousJobs := []*Job{}
	err = json.Unmarshal(filecontent, &prevousJobs)
	if err != nil {
		return []*Job{}, err
	}

	return prevousJobs, nil
}

// save the changes in job list to file
func (a *Scheduler) saveJobsToCronFile() error {
	logger.Debug("time/scheduler", "Scheduler.saveJobsToCronFile")
	js, err := json.Marshal(a.jobs)
	if err != nil {
		return err
	}
	return os.WriteFile(a.options.CronFile, js, 0775)
}

func (a *Scheduler) cronlog(message string) {
	logger.DebugTrace("time/scheduler", "Scheduler.cronlog")
	a.options.Logger.PrintAndLog("Scheduler", fmt.Sprint(message), nil)
}

func (a *Scheduler) cronlogError(message string, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("time/scheduler", "Scheduler.cronlogError: err=%v", err)
	}
	a.options.Logger.PrintAndLog("Scheduler", message, err)
}
