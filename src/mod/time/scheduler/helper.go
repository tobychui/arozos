package scheduler

import (
	"encoding/json"
	"os"
)

// Load a list of jobs from file
func loadJobsFromFile(cronfile string) ([]*Job, error) {
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
	js, err := json.Marshal(a.jobs)
	if err != nil {
		return err
	}
	return os.WriteFile(a.options.CronFile, js, 0775)
}

func (a *Scheduler) cronlog(message string) {
	a.options.Logger.PrintAndLog("Scheduler", message, nil)
}

func (a *Scheduler) cronlogError(message string, err error) {
	a.options.Logger.PrintAndLog("Scheduler", message, err)
}
