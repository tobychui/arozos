package agi

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderErrorTemplate(t *testing.T) {
	// Setup: Create a temporary error.html template file
	tempDir, err := os.MkdirTemp("", "agi_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create system/agi directory structure
	agiDir := filepath.Join(tempDir, "system", "agi")
	err = os.MkdirAll(agiDir, 0755)
	if err != nil {
		t.Fatalf("Failed to create agi directory: %v", err)
	}

	// Create a test error.html template
	templateContent := `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<h1>AGI Error</h1>
<p>Error: {{.error_msg}}</p>
<p>Script: {{.script_filepath}}</p>
<p>Timestamp: {{.timestamp}}</p>
<p>Version: {{.major_version}}.{{.minor_version}}</p>
<p>AGI Version: {{.agi_version}}</p>
</body>
</html>`

	errorTemplatePath := filepath.Join(agiDir, "error.html")
	err = os.WriteFile(errorTemplatePath, []byte(templateContent), 0644)
	if err != nil {
		t.Fatalf("Failed to write error template: %v", err)
	}

	// Change to temp directory for testing
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalWd)

	err = os.Chdir(tempDir)
	if err != nil {
		t.Fatalf("Failed to change directory: %v", err)
	}

	// Test case 1: Successful error template rendering
	gateway := &Gateway{
		Option: AgiOptions{
			BuildVersion:    "2.0",
			InternalVersion: "24",
		},
	}

	w := httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "Test error message", "/test/script.agi")

	body := w.Body.String()
	if !strings.Contains(body, "Test error message") {
		t.Error("Test case 1 failed. Error message not found in rendered template")
	}
	if !strings.Contains(body, "/test/script.agi") {
		t.Error("Test case 1 failed. Script path not found in rendered template")
	}
	if !strings.Contains(body, "2.0") {
		t.Error("Test case 1 failed. Build version not found in rendered template")
	}
	if !strings.Contains(body, "24") {
		t.Error("Test case 1 failed. Internal version not found in rendered template")
	}

	// Test case 2: Error message with special characters
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "Error with <special> & \"characters\"", "/path/to/script.js")

	body = w.Body.String()
	// Template should escape HTML special characters
	if !strings.Contains(body, "Error with") {
		t.Error("Test case 2 failed. Error message with special chars not rendered")
	}

	// Test case 3: Empty error message
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "", "/empty/error/script.agi")

	if w.Body.Len() == 0 {
		t.Error("Test case 3 failed. Should render template even with empty error message")
	}

	// Test case 4: Long error message
	longError := strings.Repeat("This is a very long error message. ", 100)
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, longError, "/script.agi")

	body = w.Body.String()
	if !strings.Contains(body, "very long error message") {
		t.Error("Test case 4 failed. Long error message not rendered")
	}

	// Test case 5: Unicode characters in error message
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "错误信息 🚨 エラー", "/unicode/script.agi")

	body = w.Body.String()
	if !strings.Contains(body, "错误信息") && !strings.Contains(body, "エラー") {
		t.Error("Test case 5 failed. Unicode characters not rendered correctly")
	}

	// Test case 6: Script path with special characters
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "Error occurred", "/path/with spaces/and-dashes/script.agi")

	body = w.Body.String()
	if !strings.Contains(body, "/path/with spaces/and-dashes/script.agi") {
		t.Error("Test case 6 failed. Script path with spaces not rendered")
	}

	// Test case 7: Different version numbers
	gateway2 := &Gateway{
		Option: AgiOptions{
			BuildVersion:    "3.1.4",
			InternalVersion: "159",
		},
	}

	w = httptest.NewRecorder()
	gateway2.RenderErrorTemplate(w, "Version test", "/script.agi")

	body = w.Body.String()
	if !strings.Contains(body, "3.1.4") {
		t.Error("Test case 7 failed. Different build version not rendered")
	}
	if !strings.Contains(body, "159") {
		t.Error("Test case 7 failed. Different internal version not rendered")
	}

	// Test case 8: Multiple line error message
	multilineError := "Line 1 error\nLine 2 error\nLine 3 error"
	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, multilineError, "/multiline/script.agi")

	body = w.Body.String()
	if !strings.Contains(body, "Line 1 error") {
		t.Error("Test case 8 failed. Multiline error message not rendered")
	}

	// Restore working directory
	os.Chdir(originalWd)

	// Test case 9: Template file does not exist
	// Create a new temp directory without error.html
	tempDir2, err := os.MkdirTemp("", "agi_test_notemplate")
	if err != nil {
		t.Fatalf("Failed to create second temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir2)

	err = os.Chdir(tempDir2)
	if err != nil {
		t.Fatalf("Failed to change to second temp directory: %v", err)
	}

	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "Error", "/script.agi")

	// Should return Internal Server Error
	body = w.Body.String()
	if !strings.Contains(body, "Internal Server Error") {
		t.Error("Test case 9 failed. Should return Internal Server Error when template missing")
	}

	os.Chdir(originalWd)

	// Test case 10: Invalid template syntax
	tempDir3, err := os.MkdirTemp("", "agi_test_invalid")
	if err != nil {
		t.Fatalf("Failed to create third temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir3)

	agiDir3 := filepath.Join(tempDir3, "system", "agi")
	err = os.MkdirAll(agiDir3, 0755)
	if err != nil {
		t.Fatalf("Failed to create third agi directory: %v", err)
	}

	invalidTemplate := `{{.error_msg} {{end}}`
	errorTemplatePath3 := filepath.Join(agiDir3, "error.html")
	err = os.WriteFile(errorTemplatePath3, []byte(invalidTemplate), 0644)
	if err != nil {
		t.Fatalf("Failed to write invalid template: %v", err)
	}

	err = os.Chdir(tempDir3)
	if err != nil {
		t.Fatalf("Failed to change to third temp directory: %v", err)
	}

	w = httptest.NewRecorder()
	gateway.RenderErrorTemplate(w, "Error", "/script.agi")

	// Should return Internal Server Error for invalid template
	body = w.Body.String()
	if !strings.Contains(body, "Internal Server Error") {
		t.Error("Test case 10 failed. Should return Internal Server Error for invalid template")
	}

	os.Chdir(originalWd)
}
