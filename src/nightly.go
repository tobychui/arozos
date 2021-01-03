package main

import "time"

/*
	Nightly.go
	author: tobychui

	This is a handle for putting everything that is required to run everynight.
	Default: Run once every day 3am in the morning.

*/

var NightlTasks = []func(){}

func NightlyInit() {
	//Start the nightly scheduler
	go func() {
		t := time.Now()
		n := time.Date(t.Year(), t.Month(), t.Day(), *nightlyTaskRunTime, 0, 0, 0, t.Location())
		d := n.Sub(t)
		if d < 0 {
			n = n.Add(24 * time.Hour)
			d = n.Sub(t)
		}
		for {
			time.Sleep(d)
			d = 24 * time.Hour
			NightlyTaskRun()
		}
	}()

}

func NightlyTaskRun() {
	for _, nightlyTask := range NightlTasks {
		nightlyTask()
	}
}

func RegisterNightlyTask(task func()) {
	NightlTasks = append(NightlTasks, task)
}
