package nightly

import (
	"testing"
)

func TestNewTaskManager(t *testing.T) {
	// Test case 1: Create new task manager
	tm := NewTaskManager()
	if tm == nil {
		t.Error("Test case 1 failed. Task manager should not be nil")
	}
}

func TestRegisterNightlyTask(t *testing.T) {
	// Test case 1: Register a task
	tm := NewTaskManager()
	err := tm.RegisterNightlyTask(NightlyTask{
		Name: "test-task",
		ExecuteTime: "00:00",
		Task: func() error {
			return nil
		},
	})
	if err != nil {
		t.Errorf("Test case 1 failed. Error registering task: %v", err)
	}
}
