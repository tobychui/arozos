package nightly

import (
	"testing"
)

func TestNewNightlyTaskManager(t *testing.T) {
	// Test case 1: Create new task manager with runtime at 3 AM
	tm := NewNightlyTaskManager(3)
	if tm == nil {
		t.Error("Test case 1 failed. Task manager should not be nil")
	}
}

func TestRegisterNightlyTask(t *testing.T) {
	// Test case 1: Register a task
	tm := NewNightlyTaskManager(3)
	tm.RegisterNightlyTask(func() {
		// Test task function
	})
	if len(tm.NightlTasks) != 1 {
		t.Error("Task was not registered correctly")
	}
}
