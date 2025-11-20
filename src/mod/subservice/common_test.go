package subservice

import (
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestSendTextResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendTextResponse(w, "Test Message")

	if w.Body.String() != "Test Message" {
		t.Errorf("Expected: 'Test Message', Got: '%s'", w.Body.String())
	}
}

func TestSendJSONResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendJSONResponse(w, `{"status":"success"}`)

	expectedBody := `{"status":"success"}`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestSendErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendErrorResponse(w, "Error occurred")

	expectedBody := `{"error":"Error occurred"}`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestSendOK(t *testing.T) {
	w := httptest.NewRecorder()
	sendOK(w)

	expectedBody := `"OK"`
	if w.Body.String() != expectedBody {
		t.Errorf("Expected: '%s', Got: '%s'", expectedBody, w.Body.String())
	}

	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("Content-Type header should be set to 'application/json'")
	}
}

func TestMv(t *testing.T) {
	// Test case 1: GET parameter exists
	req := httptest.NewRequest("GET", "/test?key=value", nil)
	result, err := mv(req, "key", false)
	if err != nil || result != "value" {
		t.Errorf("Test case 1 failed. Expected: 'value', Got: '%s', Error: %v", result, err)
	}

	// Test case 2: GET parameter missing
	_, err = mv(req, "missing", false)
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for missing parameter")
	}

	// Test case 3: POST parameter exists
	req = httptest.NewRequest("POST", "/test", nil)
	req.PostForm = map[string][]string{"key": {"postvalue"}}
	result, err = mv(req, "key", true)
	if err != nil || result != "postvalue" {
		t.Errorf("Test case 3 failed. Expected: 'postvalue', Got: '%s', Error: %v", result, err)
	}

	// Test case 4: POST parameter missing
	_, err = mv(req, "missing", true)
	if err == nil {
		t.Error("Test case 4 failed. Expected an error for missing POST parameter")
	}
}

func TestStringInSlice(t *testing.T) {
	slice := []string{"apple", "banana", "orange"}

	// Test case 1: String exists
	if !stringInSlice("banana", slice) {
		t.Error("Test case 1 failed. Expected: true")
	}

	// Test case 2: String does not exist
	if stringInSlice("grape", slice) {
		t.Error("Test case 2 failed. Expected: false")
	}

	// Test case 3: Empty slice
	if stringInSlice("test", []string{}) {
		t.Error("Test case 3 failed. Expected: false for empty slice")
	}
}

func TestFileExists(t *testing.T) {
	// Create a temporary file
	tempFile, err := os.CreateTemp("", "testfile.txt")
	if err != nil {
		t.Fatal(err)
	}
	tempFile.Close()
	defer os.Remove(tempFile.Name())

	// Test case 1: File exists
	if !fileExists(tempFile.Name()) {
		t.Error("Test case 1 failed. Expected: true for existing file")
	}

	// Test case 2: File does not exist
	os.Remove(tempFile.Name())
	if fileExists(tempFile.Name()) {
		t.Error("Test case 2 failed. Expected: false for non-existing file")
	}
}

func TestIsDir(t *testing.T) {
	// Test case 1: Directory exists
	tempDir, err := os.MkdirTemp("", "testdir")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	if !isDir(tempDir) {
		t.Error("Test case 1 failed. Expected: true for directory")
	}

	// Test case 2: File (not directory)
	tempFile, err := os.CreateTemp("", "testfile.txt")
	if err != nil {
		t.Fatal(err)
	}
	tempFile.Close()
	defer os.Remove(tempFile.Name())

	if isDir(tempFile.Name()) {
		t.Error("Test case 2 failed. Expected: false for file")
	}

	// Test case 3: Path does not exist
	if isDir("/nonexistent/path") {
		t.Error("Test case 3 failed. Expected: false for non-existent path")
	}
}

func TestInArray(t *testing.T) {
	arr := []string{"cat", "dog", "bird"}

	// Test case 1: Element exists
	if !inArray(arr, "dog") {
		t.Error("Test case 1 failed. Expected: true")
	}

	// Test case 2: Element does not exist
	if inArray(arr, "fish") {
		t.Error("Test case 2 failed. Expected: false")
	}
}

func TestTimeToString(t *testing.T) {
	testTime := time.Date(2023, 5, 15, 14, 30, 45, 0, time.UTC)
	result := timeToString(testTime)

	expected := "2023-05-15 14:30:45"
	if result != expected {
		t.Errorf("Expected: '%s', Got: '%s'", expected, result)
	}
}

func TestIntToString(t *testing.T) {
	// Test case 1: Positive number
	result := intToString(123)
	if result != "123" {
		t.Errorf("Test case 1 failed. Expected: '123', Got: '%s'", result)
	}

	// Test case 2: Negative number
	result = intToString(-456)
	if result != "-456" {
		t.Errorf("Test case 2 failed. Expected: '-456', Got: '%s'", result)
	}

	// Test case 3: Zero
	result = intToString(0)
	if result != "0" {
		t.Errorf("Test case 3 failed. Expected: '0', Got: '%s'", result)
	}
}

func TestStringToInt(t *testing.T) {
	// Test case 1: Valid positive number
	result, err := stringToInt("789")
	if err != nil || result != 789 {
		t.Errorf("Test case 1 failed. Expected: 789, Got: %v, Error: %v", result, err)
	}

	// Test case 2: Valid negative number
	result, err = stringToInt("-321")
	if err != nil || result != -321 {
		t.Errorf("Test case 2 failed. Expected: -321, Got: %v, Error: %v", result, err)
	}

	// Test case 3: Invalid number
	_, err = stringToInt("abc")
	if err == nil {
		t.Error("Test case 3 failed. Expected an error for invalid input")
	}
}

func TestStringToInt64(t *testing.T) {
	// Test case 1: Valid positive number
	result, err := stringToInt64("123456789")
	if err != nil || result != 123456789 {
		t.Errorf("Test case 1 failed. Expected: 123456789, Got: %v, Error: %v", result, err)
	}

	// Test case 2: Valid negative number
	result, err = stringToInt64("-987654321")
	if err != nil || result != -987654321 {
		t.Errorf("Test case 2 failed. Expected: -987654321, Got: %v, Error: %v", result, err)
	}

	// Test case 3: Invalid number
	_, err = stringToInt64("invalid")
	if err == nil {
		t.Error("Test case 3 failed. Expected an error for invalid input")
	}
}

func TestInt64ToString(t *testing.T) {
	// Test case 1: Positive number
	result := int64ToString(9876543210)
	if result != "9876543210" {
		t.Errorf("Test case 1 failed. Expected: '9876543210', Got: '%s'", result)
	}

	// Test case 2: Negative number
	result = int64ToString(-1234567890)
	if result != "-1234567890" {
		t.Errorf("Test case 2 failed. Expected: '-1234567890', Got: '%s'", result)
	}
}

func TestGetUnixTime(t *testing.T) {
	before := time.Now().Unix()
	result := getUnixTime()
	after := time.Now().Unix()

	// Result should be between before and after
	if result < before || result > after {
		t.Errorf("getUnixTime() returned unexpected value. Expected between %d and %d, Got: %d", before, after, result)
	}
}

func TestLoadImageAsBase64(t *testing.T) {
	// Test case 1: Valid file
	tempFile, err := os.CreateTemp("", "testimage.png")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())

	testData := []byte("test image data")
	_, err = tempFile.Write(testData)
	if err != nil {
		t.Fatal(err)
	}
	tempFile.Close()

	result, err := loadImageAsBase64(tempFile.Name())
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}
	if result == "" {
		t.Error("Test case 1 failed. Expected non-empty base64 string")
	}

	// Test case 2: Non-existent file
	_, err = loadImageAsBase64("/nonexistent/file.png")
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for non-existent file")
	}
}

func TestPushToSliceIfNotExist(t *testing.T) {
	slice := []string{"apple", "banana"}

	// Test case 1: Add new item
	result := pushToSliceIfNotExist(slice, "orange")
	if len(result) != 3 || result[2] != "orange" {
		t.Error("Test case 1 failed. Expected slice with 'orange' added")
	}

	// Test case 2: Try to add existing item
	result = pushToSliceIfNotExist(result, "banana")
	if len(result) != 3 {
		t.Error("Test case 2 failed. Expected slice length to remain 3")
	}

	// Test case 3: Add to empty slice
	result = pushToSliceIfNotExist([]string{}, "first")
	if len(result) != 1 || result[0] != "first" {
		t.Error("Test case 3 failed. Expected slice with one element 'first'")
	}
}

func TestRemoveFromSliceIfExists(t *testing.T) {
	slice := []string{"apple", "banana", "orange", "banana"}

	// Test case 1: Remove existing item (removes all occurrences)
	result := removeFromSliceIfExists(slice, "banana")
	if len(result) != 2 {
		t.Errorf("Test case 1 failed. Expected length 2, Got: %d", len(result))
	}
	for _, item := range result {
		if item == "banana" {
			t.Error("Test case 1 failed. 'banana' should be removed")
		}
	}

	// Test case 2: Remove non-existing item
	result = removeFromSliceIfExists(slice, "grape")
	if len(result) != 4 {
		t.Errorf("Test case 2 failed. Expected length 4, Got: %d", len(result))
	}

	// Test case 3: Remove from empty slice
	result = removeFromSliceIfExists([]string{}, "test")
	if len(result) != 0 {
		t.Error("Test case 3 failed. Expected empty slice")
	}
}
