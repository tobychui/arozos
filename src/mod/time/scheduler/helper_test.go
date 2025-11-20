package scheduler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadJobsFromFile(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "scheduler_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Test case 1: Load valid jobs from file
	testFile := filepath.Join(tempDir, "test_cron.json")
	jobs := []*Job{
		{
			Name:              "Test Job 1",
			Creator:           "admin",
			Description:       "Test job 1 description",
			ExecutionInterval: 60,
			BaseTime:          0,
			FshID:             "fsh1",
			ScriptVpath:       "/script1.js",
		},
		{
			Name:              "Test Job 2",
			Creator:           "admin",
			Description:       "Test job 2 description",
			ExecutionInterval: 3600,
			BaseTime:          0,
			FshID:             "fsh2",
			ScriptVpath:       "/script2.js",
		},
	}

	jobsJSON, _ := json.Marshal(jobs)
	err = os.WriteFile(testFile, jobsJSON, 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	loadedJobs, err := loadJobsFromFile(testFile)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if len(loadedJobs) != 2 {
		t.Errorf("Test case 1 failed. Expected 2 jobs, got %d", len(loadedJobs))
	}
	if len(loadedJobs) > 0 && loadedJobs[0].Name != "Test Job 1" {
		t.Errorf("Test case 1 failed. Expected 'Test Job 1', got %s", loadedJobs[0].Name)
	}

	// Test case 2: Non-existent file
	_, err = loadJobsFromFile("/non/existent/file.json")
	if err == nil {
		t.Error("Test case 2 failed. Expected error for non-existent file")
	}

	// Test case 3: Invalid JSON file
	invalidFile := filepath.Join(tempDir, "invalid.json")
	err = os.WriteFile(invalidFile, []byte("not valid json"), 0644)
	if err != nil {
		t.Fatalf("Failed to create invalid file: %v", err)
	}

	_, err = loadJobsFromFile(invalidFile)
	if err == nil {
		t.Error("Test case 3 failed. Expected error for invalid JSON")
	}

	// Test case 4: Empty jobs array
	emptyFile := filepath.Join(tempDir, "empty.json")
	emptyJSON, _ := json.Marshal([]*Job{})
	err = os.WriteFile(emptyFile, emptyJSON, 0644)
	if err != nil {
		t.Fatalf("Failed to create empty file: %v", err)
	}

	loadedJobs, err = loadJobsFromFile(emptyFile)
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if len(loadedJobs) != 0 {
		t.Errorf("Test case 4 failed. Expected 0 jobs, got %d", len(loadedJobs))
	}

	// Test case 5: Empty file
	emptyContentFile := filepath.Join(tempDir, "empty_content.json")
	err = os.WriteFile(emptyContentFile, []byte(""), 0644)
	if err != nil {
		t.Fatalf("Failed to create empty content file: %v", err)
	}

	_, err = loadJobsFromFile(emptyContentFile)
	if err == nil {
		t.Error("Test case 5 failed. Expected error for empty file content")
	}

	// Test case 6: Single job
	singleJobFile := filepath.Join(tempDir, "single.json")
	singleJob := []*Job{
		{
			Name:              "Single Job",
			Creator:           "admin",
			Description:       "Single job description",
			ExecutionInterval: 43200,
			BaseTime:          0,
			FshID:             "fsh3",
			ScriptVpath:       "/script3.js",
		},
	}
	singleJSON, _ := json.Marshal(singleJob)
	err = os.WriteFile(singleJobFile, singleJSON, 0644)
	if err != nil {
		t.Fatalf("Failed to create single job file: %v", err)
	}

	loadedJobs, err = loadJobsFromFile(singleJobFile)
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	if len(loadedJobs) != 1 {
		t.Errorf("Test case 6 failed. Expected 1 job, got %d", len(loadedJobs))
	}

	// Test case 7: File with special characters in job names
	specialFile := filepath.Join(tempDir, "special.json")
	specialJobs := []*Job{
		{
			Name:              "Job with special chars: !@#$%",
			Creator:           "admin",
			Description:       "Special characters test",
			ExecutionInterval: 60,
			BaseTime:          0,
			FshID:             "fsh4",
			ScriptVpath:       "/script4.js",
		},
	}
	specialJSON, _ := json.Marshal(specialJobs)
	err = os.WriteFile(specialFile, specialJSON, 0644)
	if err != nil {
		t.Fatalf("Failed to create special file: %v", err)
	}

	loadedJobs, err = loadJobsFromFile(specialFile)
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if len(loadedJobs) > 0 && loadedJobs[0].Name != "Job with special chars: !@#$%" {
		t.Errorf("Test case 7 failed. Special characters not preserved")
	}
}
