package utils

import (
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestSendTextResponse(t *testing.T) {
	w := httptest.NewRecorder()
	SendTextResponse(w, "Hello, World!")

	if w.Body.String() != "Hello, World!" {
		t.Errorf("Expected: 'Hello, World!', Got: '%s'", w.Body.String())
	}
}

func TestSendJSONResponse(t *testing.T) {
	w := httptest.NewRecorder()
	SendJSONResponse(w, `{"key": "value"}`)

	expectedBody := `{"key": "value"}`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestSendErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	SendErrorResponse(w, "Something went wrong")

	expectedBody := `{"error":"Something went wrong"}`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestSendOK(t *testing.T) {
	w := httptest.NewRecorder()
	SendOK(w)

	expectedBody := `"OK"`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestTimeToString(t *testing.T) {
	testTime := time.Date(2022, 2, 3, 12, 30, 0, 0, time.UTC)
	result := TimeToString(testTime)

	expectedResult := "2022-02-03 12:30:00"
	if result != expectedResult {
		t.Errorf("Expected: '%s', Got: '%s'", expectedResult, result)
	}
}

func TestFileExists(t *testing.T) {
	// Create a temporary file for testing
	tempFile, err := os.CreateTemp("", "testfile.txt")
	tempFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())

	t.Log(tempFile.Name())
	// Test case 1: Existing file
	exists := FileExists(tempFile.Name())
	if !exists {
		t.Errorf("Test case 1 failed. Expected: true, Got: false")
	}

	// Test case 2: Non-existing file
	err = os.Remove(tempFile.Name())
	if err != nil {
		t.Errorf("OS Remove failed %v", err.Error())
	}
	exists = FileExists(tempFile.Name())
	if exists {
		t.Errorf("Test case 2 failed. Expected: false, Got: true")
	}
}
