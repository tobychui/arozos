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
