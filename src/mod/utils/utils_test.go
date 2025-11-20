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

func TestGetPara(t *testing.T) {
	// Test case 1: Valid parameter
	req := httptest.NewRequest("GET", "/test?key=value", nil)
	result, err := GetPara(req, "key")
	if err != nil || result != "value" {
		t.Errorf("Test case 1 failed. Expected: 'value', Got: '%s', Error: %v", result, err)
	}

	// Test case 2: Missing parameter
	_, err = GetPara(req, "missing")
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for missing parameter.")
	}

	// Test case 3: Empty parameter
	req = httptest.NewRequest("GET", "/test?key=", nil)
	_, err = GetPara(req, "key")
	if err == nil {
		t.Error("Test case 3 failed. Expected an error for empty parameter.")
	}
}

func TestPostPara(t *testing.T) {
	// Test case 1: Valid POST parameter
	req := httptest.NewRequest("POST", "/test", nil)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Form = map[string][]string{"key": {"value"}}
	result, err := PostPara(req, "key")
	if err != nil || result != "value" {
		t.Errorf("Test case 1 failed. Expected: 'value', Got: '%s', Error: %v", result, err)
	}

	// Test case 2: Missing POST parameter
	_, err = PostPara(req, "missing")
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for missing parameter.")
	}
}

func TestPostBool(t *testing.T) {
	// Test case 1: Valid "true" string
	req := httptest.NewRequest("POST", "/test", nil)
	req.Form = map[string][]string{"key": {"true"}}
	result, err := PostBool(req, "key")
	if err != nil || !result {
		t.Errorf("Test case 1 failed. Expected: true, Got: %v, Error: %v", result, err)
	}

	// Test case 2: Valid "1" string
	req.Form = map[string][]string{"key": {"1"}}
	result, err = PostBool(req, "key")
	if err != nil || !result {
		t.Errorf("Test case 2 failed. Expected: true, Got: %v, Error: %v", result, err)
	}

	// Test case 3: Valid "false" string
	req.Form = map[string][]string{"key": {"false"}}
	result, err = PostBool(req, "key")
	if err != nil || result {
		t.Errorf("Test case 3 failed. Expected: false, Got: %v, Error: %v", result, err)
	}

	// Test case 4: Valid "0" string
	req.Form = map[string][]string{"key": {"0"}}
	result, err = PostBool(req, "key")
	if err != nil || result {
		t.Errorf("Test case 4 failed. Expected: false, Got: %v, Error: %v", result, err)
	}

	// Test case 5: Invalid boolean string
	req.Form = map[string][]string{"key": {"invalid"}}
	_, err = PostBool(req, "key")
	if err == nil {
		t.Error("Test case 5 failed. Expected an error for invalid boolean.")
	}
}

func TestPostInt(t *testing.T) {
	// Test case 1: Valid integer string
	req := httptest.NewRequest("POST", "/test", nil)
	req.Form = map[string][]string{"key": {"123"}}
	result, err := PostInt(req, "key")
	if err != nil || result != 123 {
		t.Errorf("Test case 1 failed. Expected: 123, Got: %v, Error: %v", result, err)
	}

	// Test case 2: Negative integer
	req.Form = map[string][]string{"key": {"-456"}}
	result, err = PostInt(req, "key")
	if err != nil || result != -456 {
		t.Errorf("Test case 2 failed. Expected: -456, Got: %v, Error: %v", result, err)
	}

	// Test case 3: Invalid integer string
	req.Form = map[string][]string{"key": {"abc"}}
	_, err = PostInt(req, "key")
	if err == nil {
		t.Error("Test case 3 failed. Expected an error for invalid integer.")
	}

	// Test case 4: Integer with whitespace
	req.Form = map[string][]string{"key": {"  789  "}}
	result, err = PostInt(req, "key")
	if err != nil || result != 789 {
		t.Errorf("Test case 4 failed. Expected: 789, Got: %v, Error: %v", result, err)
	}
}

func TestIsDir(t *testing.T) {
	// Test case 1: Create a temporary directory
	tempDir, err := os.MkdirTemp("", "testdir")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	if !IsDir(tempDir) {
		t.Error("Test case 1 failed. Expected: true for directory")
	}

	// Test case 2: Create a temporary file
	tempFile, err := os.CreateTemp("", "testfile.txt")
	if err != nil {
		t.Fatal(err)
	}
	tempFile.Close()
	defer os.Remove(tempFile.Name())

	if IsDir(tempFile.Name()) {
		t.Error("Test case 2 failed. Expected: false for file")
	}

	// Test case 3: Non-existent path
	if IsDir("/nonexistent/path") {
		t.Error("Test case 3 failed. Expected: false for non-existent path")
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

	result, err := LoadImageAsBase64(tempFile.Name())
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}
	if result == "" {
		t.Error("Test case 1 failed. Expected non-empty base64 string")
	}

	// Test case 2: Non-existent file
	_, err = LoadImageAsBase64("/nonexistent/file.png")
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for non-existent file")
	}
}

func TestConstructRelativePathFromRequestURL(t *testing.T) {
	// Test case 1: Root level URL
	result := ConstructRelativePathFromRequestURL("/", "login.html")
	expected := "login.html"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 2: One level deep
	result = ConstructRelativePathFromRequestURL("/admin/", "login.html")
	expected = "../login.html"
	if result != expected {
		t.Errorf("Test case 2 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 3: Two levels deep
	result = ConstructRelativePathFromRequestURL("/admin/users/", "login.html")
	expected = "../../login.html"
	if result != expected {
		t.Errorf("Test case 3 failed. Expected: '%s', Got: '%s'", expected, result)
	}
}

func TestStringInArray(t *testing.T) {
	arr := []string{"apple", "banana", "orange"}

	// Test case 1: String exists in array
	if !StringInArray(arr, "banana") {
		t.Error("Test case 1 failed. Expected: true")
	}

	// Test case 2: String does not exist in array
	if StringInArray(arr, "grape") {
		t.Error("Test case 2 failed. Expected: false")
	}

	// Test case 3: Empty array
	if StringInArray([]string{}, "test") {
		t.Error("Test case 3 failed. Expected: false for empty array")
	}
}

func TestStringInArrayIgnoreCase(t *testing.T) {
	arr := []string{"Apple", "Banana", "Orange"}

	// Test case 1: String exists (different case)
	if !StringInArrayIgnoreCase(arr, "banana") {
		t.Error("Test case 1 failed. Expected: true")
	}

	// Test case 2: String exists (exact case)
	if !StringInArrayIgnoreCase(arr, "Apple") {
		t.Error("Test case 2 failed. Expected: true")
	}

	// Test case 3: String does not exist
	if StringInArrayIgnoreCase(arr, "grape") {
		t.Error("Test case 3 failed. Expected: false")
	}

	// Test case 4: Mixed case match
	if !StringInArrayIgnoreCase(arr, "ORANGE") {
		t.Error("Test case 4 failed. Expected: true")
	}
}

func TestTemplateload(t *testing.T) {
	// Test case 1: Valid template file
	tempFile, err := os.CreateTemp("", "template.html")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tempFile.Name())

	templateContent := "Hello {{name}}, welcome to {{place}}!"
	_, err = tempFile.WriteString(templateContent)
	if err != nil {
		t.Fatal(err)
	}
	tempFile.Close()

	data := map[string]string{
		"name":  "John",
		"place": "ArozOS",
	}
	result, err := Templateload(tempFile.Name(), data)
	if err != nil {
		t.Errorf("Test case 1 failed. Error: %v", err)
	}

	expected := "Hello John, welcome to ArozOS!"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 2: Non-existent file
	_, err = Templateload("/nonexistent/template.html", data)
	if err == nil {
		t.Error("Test case 2 failed. Expected an error for non-existent file")
	}
}

func TestTemplateApply(t *testing.T) {
	// Test case 1: Simple template
	template := "Hello {{name}}, your age is {{age}}!"
	data := map[string]string{
		"name": "Alice",
		"age":  "30",
	}
	result := TemplateApply(template, data)
	expected := "Hello Alice, your age is 30!"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 2: Template with no placeholders
	template = "No placeholders here"
	result = TemplateApply(template, data)
	if result != template {
		t.Errorf("Test case 2 failed. Expected: '%s', Got: '%s'", template, result)
	}

	// Test case 3: Empty data map
	template = "Hello {{name}}!"
	result = TemplateApply(template, map[string]string{})
	if result != template {
		t.Errorf("Test case 3 failed. Expected: '%s', Got: '%s'", template, result)
	}
}
