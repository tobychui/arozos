package nightly

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestNewNightlyTaskManager(t *testing.T) {
	// Create a new nightly task manager with runtime 23 (11 PM)
	tm := NewNightlyTaskManager(23)
	if tm == nil {
		t.Fatal("Expected non-nil TaskManager")
	}
	if tm.NightlTasks == nil {
		t.Error("Expected non-nil NightlTasks slice")
	}
	if len(tm.NightlTasks) != 0 {
		t.Errorf("Expected 0 tasks, got %d", len(tm.NightlTasks))
	}
}

func TestRegisterNightlyTask(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	// Register tasks
	tm.RegisterNightlyTask(func() {})
	if len(tm.NightlTasks) != 1 {
		t.Errorf("Expected 1 task after registration, got %d", len(tm.NightlTasks))
	}

	tm.RegisterNightlyTask(func() {})
	tm.RegisterNightlyTask(func() {})
	if len(tm.NightlTasks) != 3 {
		t.Errorf("Expected 3 tasks after registrations, got %d", len(tm.NightlTasks))
	}
}

func TestNightlyTaskRun(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	var counter int32
	tm.RegisterNightlyTask(func() { atomic.AddInt32(&counter, 1) })
	tm.RegisterNightlyTask(func() { atomic.AddInt32(&counter, 1) })
	tm.RegisterNightlyTask(func() { atomic.AddInt32(&counter, 1) })

	// Run all tasks manually
	tm.NightlyTaskRun()

	// Give tasks time to complete (they run synchronously in NightlyTaskRun)
	time.Sleep(10 * time.Millisecond)

	if atomic.LoadInt32(&counter) != 3 {
		t.Errorf("Expected counter to be 3 after running tasks, got %d", counter)
	}
}

func TestNightlyTaskRun_NoTasks(t *testing.T) {
	tm := NewNightlyTaskManager(0)
	// Should not panic with no registered tasks
	tm.NightlyTaskRun()
}

func TestRegisterAndRunMultipleTimes(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	var callCount int32
	tm.RegisterNightlyTask(func() { atomic.AddInt32(&callCount, 1) })

	// Run multiple times
	tm.NightlyTaskRun()
	tm.NightlyTaskRun()
	tm.NightlyTaskRun()

	time.Sleep(10 * time.Millisecond)

	if atomic.LoadInt32(&callCount) != 3 {
		t.Errorf("Expected callCount to be 3, got %d", callCount)
	}
}

/*
	Master node only tasks

	A nightly task marked MasterNodeOnly belongs to whichever node maintains
	the storage shared by the whole cluster, so that a cluster wide scan runs
	once per night instead of once per node per night.
*/

func TestShouldRunWithoutResolver(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	//A host outside a cluster maintains its own storage
	if !tm.IsMasterNode() {
		t.Error("Expected a host with no resolver to count as the master node")
	}
	if !tm.ShouldRun(TaskOption{MasterNodeOnly: true}) {
		t.Error("Expected a master node only task to run where there is no cluster")
	}
}

func TestShouldRunOnMasterNodeOnly(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	testcases := []struct {
		name     string
		isMaster bool
		option   TaskOption
		expected bool
	}{
		{"plain task on the master", true, TaskOption{}, true},
		{"plain task on a follower", false, TaskOption{}, true},
		{"master only task on the master", true, TaskOption{MasterNodeOnly: true}, true},
		{"master only task on a follower", false, TaskOption{MasterNodeOnly: true}, false},
	}

	for _, tc := range testcases {
		t.Run(tc.name, func(t *testing.T) {
			isMaster := tc.isMaster
			tm.SetMasterNodeResolver(func() bool { return isMaster })
			if got := tm.ShouldRun(tc.option); got != tc.expected {
				t.Errorf("Expected ShouldRun to be %v, got %v", tc.expected, got)
			}
		})
	}
}

func TestRegisterNightlyTaskWithOption(t *testing.T) {
	tm := NewNightlyTaskManager(23)

	var masterOnlyRuns int32
	var everyNodeRuns int32
	tm.RegisterNightlyTaskWithOption(TaskOption{Name: "cluster scan", MasterNodeOnly: true},
		func() { atomic.AddInt32(&masterOnlyRuns, 1) })
	tm.RegisterNightlyTask(func() { atomic.AddInt32(&everyNodeRuns, 1) })

	if len(tm.NightlTasks) != 2 {
		t.Fatalf("Expected 2 tasks after registration, got %d", len(tm.NightlTasks))
	}

	//Registration happens before the cluster starts, so the decision has to
	//be taken when the task runs and not when it is registered
	tm.SetMasterNodeResolver(func() bool { return false })
	tm.NightlyTaskRun()
	if atomic.LoadInt32(&masterOnlyRuns) != 0 {
		t.Errorf("Expected the master only task to be skipped on a follower, ran %d time(s)", masterOnlyRuns)
	}
	if atomic.LoadInt32(&everyNodeRuns) != 1 {
		t.Errorf("Expected the plain task to run on a follower, ran %d time(s)", everyNodeRuns)
	}

	tm.SetMasterNodeResolver(func() bool { return true })
	tm.NightlyTaskRun()
	if atomic.LoadInt32(&masterOnlyRuns) != 1 {
		t.Errorf("Expected the master only task to run once this node is the master, ran %d time(s)", masterOnlyRuns)
	}
	if atomic.LoadInt32(&everyNodeRuns) != 2 {
		t.Errorf("Expected the plain task to run again, ran %d time(s)", everyNodeRuns)
	}
}
