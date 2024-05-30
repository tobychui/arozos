package authlogger

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandleIndexListing(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	tt := time.Now()
	err = logger.LogAuthByRequestInfo("testUser", "192.168.1.1:8080", tt.Unix(), true, "custom")
	if err != nil {
		t.Fatalf("Failed to create a new entry: %v", err)
	}

	// Setup a test HTTP request for index listing
	request, err := http.NewRequest("GET", "/index", nil)
	if err != nil {
		t.Fatal(err)
	}

	// Setup a test server to capture the response
	rr := httptest.NewRecorder()

	// Test handling index listing
	logger.HandleIndexListing(rr, request)

	// Check the response status code
	if status := rr.Code; status != http.StatusOK {
		t.Errorf("HandleIndexListing returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	// Check the response body
	expectedBody := `["` + time.Now().UTC().Format("Jan-2006") + `"]`
	if rr.Body.String() != expectedBody {
		t.Errorf("HandleIndexListing returned unexpected body: got %v want %v", rr.Body.String(), expectedBody)
	}
}

func TestHandleTableListing(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}
	defer logger.Close()

	tt := time.Now().Unix()
	err = logger.LogAuthByRequestInfo("testUser", "192.168.1.1:8080", tt, true, "custom")
	if err != nil {
		t.Fatalf("Failed to create a new logger: %v", err)
	}

	// Setup a test HTTP request for table listing
	request, err := http.NewRequest("POST", "/table", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Post parameter "record" is required
	request.PostForm = make(map[string][]string)
	request.PostForm.Add("record", time.Now().UTC().Format("Jan-2006"))

	// Setup a test server to capture the response
	rr := httptest.NewRecorder()

	// Test handling table listing
	logger.HandleTableListing(rr, request)

	// Check the response status code
	if status := rr.Code; status != http.StatusOK {
		t.Errorf("HandleTableListing returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	// Check the response body
	expectedBody := `[{"Timestamp":` + fmt.Sprint(tt) + `,"TargetUsername":"testUser","LoginSucceed":true,"IpAddr":"192.168.1.1","AuthType":"custom","Port":8080}]`
	if rr.Body.String() != expectedBody {
		t.Errorf("HandleTableListing returned unexpected body: got %v want %v", rr.Body.String(), expectedBody)
	}
}
