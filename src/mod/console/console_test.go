package console

import (
	"testing"
)

func TestNewConsole(t *testing.T) {
	// Test case 1: Create new console with handler
	handler := func(input string) string {
		return "Processed: " + input
	}

	console := NewConsole(handler)
	if console == nil {
		t.Error("Test case 1 failed. Expected non-nil Console")
	}

	if console.Handler == nil {
		t.Error("Test case 1 failed. Handler should not be nil")
	}
}

func TestConsoleHandler(t *testing.T) {
	// Test case 1: Handler function works correctly
	handler := func(input string) string {
		return "Echo: " + input
	}

	console := NewConsole(handler)
	result := console.Handler("test")
	expected := "Echo: test"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 2: Handler with empty string
	result = console.Handler("")
	expected = "Echo: "
	if result != expected {
		t.Errorf("Test case 2 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 3: Handler with special characters
	result = console.Handler("!@#$%^&*()")
	expected = "Echo: !@#$%^&*()"
	if result != expected {
		t.Errorf("Test case 3 failed. Expected: '%s', Got: '%s'", expected, result)
	}
}

func TestConsoleHandlerComplexLogic(t *testing.T) {
	// Test case 1: Handler with command parsing
	handler := func(input string) string {
		switch input {
		case "help":
			return "Available commands: help, exit, status"
		case "exit":
			return "Exiting..."
		case "status":
			return "System is running"
		default:
			return "Unknown command: " + input
		}
	}

	console := NewConsole(handler)

	// Test help command
	result := console.Handler("help")
	if result != "Available commands: help, exit, status" {
		t.Errorf("Test case 1a failed. Expected help text, Got: '%s'", result)
	}

	// Test exit command
	result = console.Handler("exit")
	if result != "Exiting..." {
		t.Errorf("Test case 1b failed. Expected 'Exiting...', Got: '%s'", result)
	}

	// Test status command
	result = console.Handler("status")
	if result != "System is running" {
		t.Errorf("Test case 1c failed. Expected 'System is running', Got: '%s'", result)
	}

	// Test unknown command
	result = console.Handler("unknown")
	if result != "Unknown command: unknown" {
		t.Errorf("Test case 1d failed. Expected unknown command message, Got: '%s'", result)
	}
}

func TestConsoleHandlerStateful(t *testing.T) {
	// Test case 1: Stateful handler (counts invocations)
	counter := 0
	handler := func(input string) string {
		counter++
		return "Call count: " + string(rune(counter+'0'))
	}

	console := NewConsole(handler)

	// First call
	result := console.Handler("test1")
	if result != "Call count: 1" {
		t.Errorf("Test case 1a failed. Expected 'Call count: 1', Got: '%s'", result)
	}

	// Second call
	result = console.Handler("test2")
	if result != "Call count: 2" {
		t.Errorf("Test case 1b failed. Expected 'Call count: 2', Got: '%s'", result)
	}

	// Third call
	result = console.Handler("test3")
	if result != "Call count: 3" {
		t.Errorf("Test case 1c failed. Expected 'Call count: 3', Got: '%s'", result)
	}
}
