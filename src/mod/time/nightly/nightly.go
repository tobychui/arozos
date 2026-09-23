package nightly

import (
	"sync"
	"time"
)

/*
	Nightly.go
	Author: tobychui

	This module handles tasks that have to be done every night
	like updating all user storage capacity and clean trash etc

*/

// TaskOption describes how a nightly task (or one step of it) should be
// treated by the manager.
type TaskOption struct {
	//Name of the task, for logging
	Name string

	/*
		MasterNodeOnly limits the work to the master node of the cluster.

		Shared storage like the cluster:/ file system shows the same files on
		every member, so a maintenance pass that runs on all of them repeats
		the same scan, and the same deletions, once per node. Marking that
		work master node only keeps it to a single pass per cluster per night.
		A host that is not part of a cluster is the only node there is, so it
		counts as its own master and still runs the task.
	*/
	MasterNodeOnly bool
}

type TaskManager struct {
	NightlTasks []func()

	//Answers TaskOption.MasterNodeOnly, installed by the cluster once it
	//starts. Guarded by mu as the nightly timer runs in its own goroutine.
	masterNodeResolver func() bool
	mu                 sync.RWMutex
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
	tm.RegisterNightlyTaskWithOption(TaskOption{}, task)
}

// Register a nightly task that only runs where its option allows it
func (tm *TaskManager) RegisterNightlyTaskWithOption(option TaskOption, task func()) {
	tm.NightlTasks = append(tm.NightlTasks, func() {
		if !tm.ShouldRun(option) {
			return
		}
		task()
	})
}

/*
	Master node

	The master node is the one node that performs maintenance on storage
	shared by the whole cluster. The resolver is installed by the cluster
	module; until then, and on a standalone host, this node is the master.
*/

// Set the function that reports if this host is the cluster master node
func (tm *TaskManager) SetMasterNodeResolver(resolver func() bool) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.masterNodeResolver = resolver
}

// Check if this host is currently the master node of its cluster
func (tm *TaskManager) IsMasterNode() bool {
	tm.mu.RLock()
	resolver := tm.masterNodeResolver
	tm.mu.RUnlock()
	if resolver == nil {
		//Not in a cluster: this host maintains its own storage
		return true
	}
	return resolver()
}

// Check if work carrying this option belongs to this host tonight. A task
// that walks several file systems can call this once per file system instead
// of gating the whole task, so local drives are still maintained on every
// node while the shared cluster drive is left to the master node.
func (tm *TaskManager) ShouldRun(option TaskOption) bool {
	if option.MasterNodeOnly {
		return tm.IsMasterNode()
	}
	return true
}
