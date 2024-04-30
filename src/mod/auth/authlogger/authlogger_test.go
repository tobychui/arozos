package authlogger

import (
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"
)

var filePath = "./system/auth/"

func setupSuite(t *testing.T) func(t *testing.T) {
	//t.Log("Setting up env")

	os.Mkdir(filePath, 0777)

	// Return a function to teardown the test
	return func(t *testing.T) {
		//t.Log("Cleaning up")
		err := os.RemoveAll(filePath)
		os.RemoveAll("./system/")
		if err != nil {
			t.Fatalf("Failed to clean up: %v", err)
		}
	}
}

func TestNewLogger(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Test creating a new logger
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	// Ensure that the logger's database is not nil
	if logger.database == nil {
		t.Error("Logger's database should not be nil")
	}
}

func TestLogAuth(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Setup a test HTTP request
	request, err := http.NewRequest("POST", "/login", nil)
	if err != nil {
		t.Fatal(err)
	}

	form := url.Values{}
	form.Add("username", "automatictest")

	request.RemoteAddr = "8.8.8.8:8080"
	request.PostForm = form

	// Setup a test server to capture the response
	//rr := httptest.NewRecorder()

	// Create a new logger
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	// Test logging authentication with a successful login
	err = logger.LogAuth(request, true)
	if err != nil {
		t.Fatalf("Failed to log authentication: %v", err)
	}

	if len(logger.ListSummary()) != 1 {
		t.Fatalf("Expected list summary:1, curr: 0")
	}

	summary, err := logger.ListRecords(logger.ListSummary()[0])
	if err != nil {
		t.Fatalf("Failed to list records: %v", err)
	}
	// should be only 1
	for _, record := range summary {
		if record.AuthType != "web" {
			t.Fatalf("AuthType expected: %v, got: %v", "web", record.AuthType)
		}
		if record.IpAddr != "8.8.8.8" {
			t.Fatalf("IpAddr expected: %v, got: %v", "8.8.8.8", record.IpAddr)
		}
		if record.LoginSucceed != true {
			t.Fatalf("LoginSucceed expected: %v, got: %v", true, record.LoginSucceed)
		}
		if record.Port != 8080 {
			t.Fatalf("Port expected: %v, got: %v", 8080, record.LoginSucceed)
		}
		if record.TargetUsername != "automatictest" {
			t.Fatalf("TargetUsername expected: %v, got: %v", "automatictest", record.TargetUsername)
		}
	}
}

func TestListSummary(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new logger
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	// Test listing summary
	summary := logger.ListSummary()

	// Assuming there is at least one table in the test environment
	if len(summary) != 0 {
		t.Fatal("Expected at least one table in the summary, got none")
	}
}

func TestListRecords(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new logger
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	err = logger.LogAuthByRequestInfo("testUser", "192.168.1.1:8080", time.Now().Unix(), true, "custom")

	// Assuming there is at least one table in the test environment
	summary := logger.ListSummary()
	if len(summary) == 0 {
		t.Fatalf("Expected at least one record in the table, got none")
	}

	// Test listing records from the first table
	records, err := logger.ListRecords(summary[0])
	if err != nil {
		t.Fatalf("Failed to list records: %v", err)
	}

	// Assuming there are records in the table
	if len(records) == 0 {
		t.Fatalf("Expected at least one record in the table, got none")
	}
}

func TestLogAuthByRequestInfo(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new logger
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	// Test logging authentication with custom request info
	tt := time.Now().Unix()
	err = logger.LogAuthByRequestInfo("testUser", "192.168.1.1:8080", tt, true, "custom")
	if err != nil {
		t.Errorf("Failed to log authentication with custom request info: %v", err)
	}

	if len(logger.ListSummary()) != 1 {
		t.Fatalf("Expected list summary:1, curr: 0")
	}

	summary, err := logger.ListRecords(logger.ListSummary()[0])
	if err != nil {
		t.Fatalf("Failed to list records: %v", err)
	}
	// should be only 1
	for _, record := range summary {
		if record.AuthType != "custom" {
			t.Fatalf("AuthType expected: %v, got: %v", "custom", record.AuthType)
		}
		if record.IpAddr != "192.168.1.1" {
			t.Fatalf("IpAddr expected: %v, got: %v", "192.168.1.1", record.IpAddr)
		}
		if record.LoginSucceed != true {
			t.Fatalf("LoginSucceed expected: %v, got: %v", true, record.LoginSucceed)
		}
		if record.Port != 8080 {
			t.Fatalf("Port expected: %v, got: %v", 8080, record.LoginSucceed)
		}
		if record.TargetUsername != "testUser" {
			t.Fatalf("TargetUsername expected: %v, got: %v", "testUser", record.TargetUsername)
		}
		if record.Timestamp != tt {
			t.Fatalf("Timestamp expected: %v, got: %v", tt, record.Timestamp)
		}
	}
}
