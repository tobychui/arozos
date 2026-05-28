package utils

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
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

// --- GetPara ---

func TestGetPara(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?foo=bar", nil)

	val, err := GetPara(req, "foo")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "bar" {
		t.Errorf("expected 'bar', got '%s'", val)
	}

	_, err = GetPara(req, "missing")
	if err == nil {
		t.Error("expected error for missing key, got nil")
	}
}

// --- GetBool ---

func TestGetBool(t *testing.T) {
	cases := []struct {
		query    string
		key      string
		expected bool
		wantErr  bool
	}{
		{"?flag=true", "flag", true, false},
		{"?flag=1", "flag", true, false},
		{"?flag=false", "flag", false, false},
		{"?flag=0", "flag", false, false},
		{"?flag=yes", "flag", false, true},
		{"", "flag", false, true},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, "/"+tc.query, nil)
		got, err := GetBool(req, tc.key)
		if tc.wantErr {
			if err == nil {
				t.Errorf("query=%q key=%q: expected error, got nil", tc.query, tc.key)
			}
		} else {
			if err != nil {
				t.Errorf("query=%q key=%q: unexpected error: %v", tc.query, tc.key, err)
			}
			if got != tc.expected {
				t.Errorf("query=%q key=%q: expected %v, got %v", tc.query, tc.key, tc.expected, got)
			}
		}
	}
}

// --- GetInt ---

func TestGetInt(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?n=42", nil)
	val, err := GetInt(req, "n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != 42 {
		t.Errorf("expected 42, got %d", val)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/?n=abc", nil)
	_, err = GetInt(req2, "n")
	if err == nil {
		t.Error("expected error for non-integer value")
	}

	req3 := httptest.NewRequest(http.MethodGet, "/", nil)
	_, err = GetInt(req3, "n")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

// --- PostPara ---

func TestPostPara(t *testing.T) {
	form := url.Values{}
	form.Set("name", "alice")
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	val, err := PostPara(req, "name")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "alice" {
		t.Errorf("expected 'alice', got '%s'", val)
	}

	_, err = PostPara(req, "missing")
	if err == nil {
		t.Error("expected error for missing key, got nil")
	}
}

// --- PostBool ---

func TestPostBool(t *testing.T) {
	cases := []struct {
		formVal  string
		expected bool
		wantErr  bool
	}{
		{"true", true, false},
		{"1", true, false},
		{"false", false, false},
		{"0", false, false},
		{"maybe", false, true},
	}

	for _, tc := range cases {
		form := url.Values{}
		form.Set("flag", tc.formVal)
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		got, err := PostBool(req, "flag")
		if tc.wantErr {
			if err == nil {
				t.Errorf("formVal=%q: expected error, got nil", tc.formVal)
			}
		} else {
			if err != nil {
				t.Errorf("formVal=%q: unexpected error: %v", tc.formVal, err)
			}
			if got != tc.expected {
				t.Errorf("formVal=%q: expected %v, got %v", tc.formVal, tc.expected, got)
			}
		}
	}

	// Missing key
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	_, err := PostBool(req, "flag")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

// --- PostInt ---

func TestPostInt(t *testing.T) {
	form := url.Values{}
	form.Set("count", "7")
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	val, err := PostInt(req, "count")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != 7 {
		t.Errorf("expected 7, got %d", val)
	}

	// Non-integer value
	form2 := url.Values{}
	form2.Set("count", "notanint")
	req2 := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form2.Encode()))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	_, err = PostInt(req2, "count")
	if err == nil {
		t.Error("expected error for non-integer value")
	}

	// Missing key
	req3 := httptest.NewRequest(http.MethodPost, "/", nil)
	_, err = PostInt(req3, "count")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

// --- IsDir ---

func TestIsDir(t *testing.T) {
	dir, err := os.MkdirTemp("", "testdir")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	if !IsDir(dir) {
		t.Errorf("expected IsDir=true for directory %s", dir)
	}

	tmpFile, err := os.CreateTemp(dir, "file")
	if err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	if IsDir(tmpFile.Name()) {
		t.Errorf("expected IsDir=false for regular file %s", tmpFile.Name())
	}

	if IsDir("/nonexistent/path/xyz") {
		t.Error("expected IsDir=false for non-existent path")
	}
}

// --- LoadImageAsBase64 ---

func TestLoadImageAsBase64(t *testing.T) {
	// Write some bytes to a temp file and verify roundtrip
	content := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A} // PNG magic bytes
	tmpFile, err := os.CreateTemp("", "img*.png")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(content); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	encoded, err := LoadImageAsBase64(tmpFile.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode base64: %v", err)
	}
	if string(decoded) != string(content) {
		t.Errorf("decoded content mismatch: expected %v, got %v", content, decoded)
	}

	// Non-existent file
	_, err = LoadImageAsBase64("/nonexistent/image.png")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

// --- ConstructRelativePathFromRequestURL ---

func TestConstructRelativePathFromRequestURL(t *testing.T) {
	cases := []struct {
		requestURI string
		location   string
		expected   string
	}{
		// Root level: only one slash, no prepend
		{"/page", "index.html", "index.html"},
		// One level deep: one extra slash → one "../"
		{"/section/page", "index.html", "../index.html"},
		// Two levels deep: two extra slashes → two "../"
		{"/a/b/page", "index.html", "../../index.html"},
	}

	for _, tc := range cases {
		got := ConstructRelativePathFromRequestURL(tc.requestURI, tc.location)
		if got != tc.expected {
			t.Errorf("requestURI=%q location=%q: expected %q, got %q",
				tc.requestURI, tc.location, tc.expected, got)
		}
	}
}

// --- StringInArray ---

func TestStringInArray(t *testing.T) {
	arr := []string{"apple", "banana", "cherry"}

	if !StringInArray(arr, "banana") {
		t.Error("expected 'banana' to be found in array")
	}
	if StringInArray(arr, "Banana") {
		t.Error("expected case-sensitive check to fail for 'Banana'")
	}
	if StringInArray(arr, "mango") {
		t.Error("expected 'mango' not to be found in array")
	}
	if StringInArray([]string{}, "apple") {
		t.Error("expected false for empty array")
	}
}

// --- StringInArrayIgnoreCase ---

func TestStringInArrayIgnoreCase(t *testing.T) {
	arr := []string{"Apple", "Banana", "Cherry"}

	if !StringInArrayIgnoreCase(arr, "apple") {
		t.Error("expected 'apple' to be found (case-insensitive)")
	}
	if !StringInArrayIgnoreCase(arr, "BANANA") {
		t.Error("expected 'BANANA' to be found (case-insensitive)")
	}
	if StringInArrayIgnoreCase(arr, "mango") {
		t.Error("expected 'mango' not to be found")
	}
	if StringInArrayIgnoreCase([]string{}, "apple") {
		t.Error("expected false for empty array")
	}
}

// --- Templateload ---

func TestTemplateload(t *testing.T) {
	content := "Hello, {{name}}! You are {{age}} years old."
	tmpFile, err := os.CreateTemp("", "template*.html")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())
	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	data := map[string]string{
		"name": "Alice",
		"age":  "30",
	}
	result, err := Templateload(tmpFile.Name(), data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := "Hello, Alice! You are 30 years old."
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}

	// Non-existent template file
	_, err = Templateload("/nonexistent/template.html", data)
	if err == nil {
		t.Error("expected error for non-existent template file")
	}
}

// --- TemplateApply ---

func TestTemplateApply(t *testing.T) {
	tmpl := "Dear {{title}} {{surname}}, welcome to {{place}}."
	data := map[string]string{
		"title":   "Dr.",
		"surname": "Smith",
		"place":   "ArozOS",
	}
	result := TemplateApply(tmpl, data)
	expected := "Dear Dr. Smith, welcome to ArozOS."
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}

	// No replacements needed
	plain := "No placeholders here."
	result2 := TemplateApply(plain, map[string]string{})
	if result2 != plain {
		t.Errorf("expected unchanged string %q, got %q", plain, result2)
	}

	// Placeholder that doesn't exist in data is left intact
	partial := "Hello {{name}}, your code is {{code}}."
	result3 := TemplateApply(partial, map[string]string{"name": "Bob"})
	if result3 != "Hello Bob, your code is {{code}}." {
		t.Errorf("unexpected result for partial replacement: %q", result3)
	}
}

// --- FilenameIsWebSafe ---

func TestFilenameIsWebSafe(t *testing.T) {
	safeNames := []string{
		"myfile.txt",
		"image-001.png",
		"document_v2.pdf",
		"report 2024.docx",
	}
	for _, name := range safeNames {
		if !FilenameIsWebSafe(name) {
			t.Errorf("expected %q to be web-safe", name)
		}
	}

	unsafeNames := []string{
		"file/with/slashes.txt",
		"back\\slash.txt",
		"query?param=1",
		"percent%20encoded",
		"wild*card",
		"colon:name",
		"pipe|name",
		`quote"name`,
		"less<than",
		"greater>than",
	}
	for _, name := range unsafeNames {
		if FilenameIsWebSafe(name) {
			t.Errorf("expected %q to be NOT web-safe", name)
		}
	}
}
