package nightly

import "time"

/*
	Nightly.go
	Author: tobychui

	This module handles tasks that have to be done every night
	like updating all user storage capacity and clean trash etc

*/

type TaskManager struct {
	NightlTasks []func()
}

func NewNightlyTaskManager(nightlyTaskRunTime int) *TaskManager {
	//Create a new return structure
	thisManager := TaskManager{
		NightlTasks: []func(){},
	}
	//Start the nightly scheduler
	go func(tm *TaskManager) {
		t := time.Now()
		n := time.Date(t.Year(), t.Month(), t.Day(), nightlyTaskRunTime, 0, 0, 0, t.Location())
		d := n.Sub(t)
		if d < 0 {
			n = n.Add(24 * time.Hour)
			d = n.Sub(t)
		}
		for {
			time.Sleep(d)
			d = 24 * time.Hour
			tm.NightlyTaskRun()
		}
	}(&thisManager)

	return &thisManager
}

func (tm *TaskManager) NightlyTaskRun() {
	for _, nightlyTask := range tm.NightlTasks {
		nightlyTask()
	}
}

func (tm *TaskManager) RegisterNightlyTask(task func()) {
	tm.NightlTasks = append(tm.NightlTasks, task)
}
