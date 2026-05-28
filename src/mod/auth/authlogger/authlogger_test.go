package authlogger

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
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

// ----- handlers.go: HandleIndexListing -----

func TestHandleIndexListing_Empty(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	req := httptest.NewRequest(http.MethodGet, "/auth/log/index", nil)
	rr := httptest.NewRecorder()

	logger.HandleIndexListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	// Empty logger should return an empty JSON array
	var indexes []string
	if err := json.Unmarshal(rr.Body.Bytes(), &indexes); err != nil {
		t.Fatalf("response is not valid JSON: %v — body: %s", err, rr.Body.String())
	}
	if len(indexes) != 0 {
		t.Errorf("expected empty index list, got %v", indexes)
	}
}

func TestHandleIndexListing_WithRecords(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	// Log one record so a month table is created
	if err := logger.LogAuthByRequestInfo("user1", "10.0.0.1:1234", time.Now().Unix(), true, "web"); err != nil {
		t.Fatalf("LogAuthByRequestInfo: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/auth/log/index", nil)
	rr := httptest.NewRecorder()
	logger.HandleIndexListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var indexes []string
	if err := json.Unmarshal(rr.Body.Bytes(), &indexes); err != nil {
		t.Fatalf("response is not valid JSON: %v — body: %s", err, rr.Body.String())
	}
	if len(indexes) == 0 {
		t.Error("expected at least one month index after logging")
	}
}

// ----- handlers.go: HandleTableListing -----

func TestHandleTableListing_MissingRecord(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	form := url.Values{}
	// "record" parameter is missing
	req := httptest.NewRequest(http.MethodPost, "/auth/log/table", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	logger.HandleTableListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 (error encoded in body), got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error in response when 'record' param is missing, got: %s", body)
	}
}

func TestHandleTableListing_NonExistentTable(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	form := url.Values{}
	form.Set("record", "Jan-1970") // month table that doesn't exist
	req := httptest.NewRequest(http.MethodPost, "/auth/log/table", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	logger.HandleTableListing(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error for non-existent table, got: %s", body)
	}
}

func TestHandleTableListing_WithRecords(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	// Create a record so we have a month table
	if err := logger.LogAuthByRequestInfo("alice", "192.168.1.5:9000", time.Now().Unix(), false, "web"); err != nil {
		t.Fatalf("LogAuthByRequestInfo: %v", err)
	}

	// Find out which month table was created
	summary := logger.ListSummary()
	if len(summary) == 0 {
		t.Fatal("expected at least one month table after logging")
	}
	monthKey := summary[0]

	form := url.Values{}
	form.Set("record", monthKey)
	req := httptest.NewRequest(http.MethodPost, "/auth/log/table", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	logger.HandleTableListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var records []LoginRecord
	if err := json.Unmarshal(rr.Body.Bytes(), &records); err != nil {
		t.Fatalf("response not valid JSON: %v — body: %s", err, rr.Body.String())
	}
	if len(records) == 0 {
		t.Error("expected at least one login record in response")
	}
}

func TestHandleTableListing_UsernameFiltering(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger: %v", err)
	}
	defer logger.Close()

	// Log with a username that contains special characters
	if err := logger.LogAuthByRequestInfo("user@example.com", "10.0.0.2:80", time.Now().Unix(), true, "web"); err != nil {
		t.Fatalf("LogAuthByRequestInfo: %v", err)
	}

	summary := logger.ListSummary()
	if len(summary) == 0 {
		t.Fatal("expected at least one month table")
	}

	form := url.Values{}
	form.Set("record", summary[0])
	req := httptest.NewRequest(http.MethodPost, "/auth/log/table", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	logger.HandleTableListing(rr, req)

	var records []LoginRecord
	if err := json.Unmarshal(rr.Body.Bytes(), &records); err != nil {
		t.Fatalf("response not valid JSON: %v — body: %s", err, rr.Body.String())
	}

	// The handler replaces non-alphanumeric chars with '░'
	for _, r := range records {
		if strings.Contains(r.TargetUsername, "@") {
			t.Errorf("expected '@' to be filtered from username, got: %s", r.TargetUsername)
		}
	}
}

// ── getIpAddressFromRequest ──────────────────────────────────────────────────

func TestGetIpAddressFromRequest_RemoteAddr(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:8080"

	lastHop, sources := getIpAddressFromRequest(req)
	if lastHop != "10.0.0.1:8080" {
		t.Errorf("expected lastHop='10.0.0.1:8080', got %q", lastHop)
	}
	// No X-Forwarded-For header → sources slice contains one empty string
	_ = sources
}

func TestGetIpAddressFromRequest_XForwardedFor(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "proxy.example.com:80"
	req.Header.Set("X-Forwarded-For", "192.168.1.10, 10.0.0.2")

	_, sources := getIpAddressFromRequest(req)
	if len(sources) != 2 {
		t.Fatalf("expected 2 source addresses, got %d: %v", len(sources), sources)
	}
	if sources[0] != "192.168.1.10" {
		t.Errorf("expected first source '192.168.1.10', got %q", sources[0])
	}
	if sources[1] != " 10.0.0.2" && sources[1] != "10.0.0.2" {
		t.Logf("second source: %q (raw split may include space)", sources[1])
	}
}

// ── summaryDate sort.Interface ───────────────────────────────────────────────

func TestSummaryDate_Len(t *testing.T) {
	sd := summaryDate{"Jan-2024", "Feb-2024", "Mar-2024"}
	if sd.Len() != 3 {
		t.Errorf("expected Len()=3, got %d", sd.Len())
	}
}

func TestSummaryDate_Swap(t *testing.T) {
	sd := summaryDate{"Jan-2024", "Feb-2024"}
	sd.Swap(0, 1)
	if sd[0] != "Feb-2024" || sd[1] != "Jan-2024" {
		t.Errorf("Swap failed: got %v", sd)
	}
}

func TestSummaryDate_Less_NewerFirst(t *testing.T) {
	sd := summaryDate{"Jan-2024", "Dec-2023"}
	// Less(0,1) should return true if sd[0] is newer than sd[1] (i.e., sort descending)
	if !sd.Less(0, 1) {
		t.Error("expected Jan-2024 to sort before Dec-2023 (newer first)")
	}
	if sd.Less(1, 0) {
		t.Error("expected Dec-2023 to NOT sort before Jan-2024")
	}
}

func TestSummaryDate_Sort_OrderedDescending(t *testing.T) {
	sd := summaryDate{"Feb-2023", "Dec-2023", "Jan-2024", "Mar-2023"}
	sort.Sort(sd)
	// After sorting, newest first
	if sd[0] != "Jan-2024" {
		t.Errorf("expected first element 'Jan-2024', got %q", sd[0])
	}
	if sd[len(sd)-1] != "Feb-2023" {
		t.Errorf("expected last element 'Feb-2023', got %q", sd[len(sd)-1])
	}
}
