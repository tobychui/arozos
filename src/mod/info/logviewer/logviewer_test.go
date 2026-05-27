package logviewer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNewLogViewer verifies that NewLogViewer constructs a non-nil Viewer
// and that the stored option is preserved.
func TestNewLogViewer(t *testing.T) {
	opt := &ViewerOption{
		RootFolder: "/tmp/nonexistent_log_dir",
		Extension:  ".log",
	}
	v := NewLogViewer(opt)
	if v == nil {
		t.Fatal("NewLogViewer() returned nil")
	}
	if v.option != opt {
		t.Error("NewLogViewer() did not store the option pointer correctly")
	}
}

// TestNewLogViewerEmptyOption verifies that NewLogViewer works with a
// zero-value option and does not panic.
func TestNewLogViewerEmptyOption(t *testing.T) {
	opt := &ViewerOption{}
	v := NewLogViewer(opt)
	if v == nil {
		t.Fatal("NewLogViewer() returned nil for empty option")
	}
}

// TestListLogFilesEmptyFolder verifies that ListLogFiles returns an empty (non-nil)
// map when the root folder does not exist.
func TestListLogFilesEmptyFolder(t *testing.T) {
	opt := &ViewerOption{
		RootFolder: "/tmp/nonexistent_logviewer_test_dir_xyz",
		Extension:  ".log",
	}
	v := NewLogViewer(opt)
	result := v.ListLogFiles(false)
	if result == nil {
		t.Error("ListLogFiles() returned nil; expected an empty map")
	}
	if len(result) != 0 {
		t.Errorf("ListLogFiles() on non-existent folder returned %d entries, expected 0", len(result))
	}
}

// TestListLogFilesWithLogs creates a temporary log tree and verifies that
// ListLogFiles correctly discovers and categorises the log files.
func TestListLogFilesWithLogs(t *testing.T) {
	// Build a temporary directory structure:
	//   tmpRoot/
	//     cat1/
	//       alpha.log
	//       beta.log
	//     cat2/
	//       gamma.log
	//     not_a_log.txt    ← should be ignored
	tmpRoot := t.TempDir()

	cat1 := filepath.Join(tmpRoot, "cat1")
	cat2 := filepath.Join(tmpRoot, "cat2")
	for _, dir := range []string{cat1, cat2} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("failed to create test directory %s: %v", dir, err)
		}
	}

	files := map[string]string{
		filepath.Join(cat1, "alpha.log"): "log line alpha",
		filepath.Join(cat1, "beta.log"):  "log line beta",
		filepath.Join(cat2, "gamma.log"): "log line gamma",
		filepath.Join(tmpRoot, "not_a_log.txt"): "should be ignored",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write test file %s: %v", path, err)
		}
	}

	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})

	result := v.ListLogFiles(false)

	if len(result["cat1"]) != 2 {
		t.Errorf("expected 2 log files in cat1, got %d", len(result["cat1"]))
	}
	if len(result["cat2"]) != 1 {
		t.Errorf("expected 1 log file in cat2, got %d", len(result["cat2"]))
	}

	// Fullpath should be empty when showFullpath == false.
	for _, logs := range result {
		for _, lf := range logs {
			if lf.Fullpath != "" {
				t.Errorf("expected empty Fullpath when showFullpath=false, got %q", lf.Fullpath)
			}
		}
	}
}

// TestListLogFilesShowFullpath verifies that Fullpath is populated when requested.
func TestListLogFilesShowFullpath(t *testing.T) {
	tmpRoot := t.TempDir()
	cat := filepath.Join(tmpRoot, "mycategory")
	if err := os.MkdirAll(cat, 0755); err != nil {
		t.Fatal(err)
	}
	logFile := filepath.Join(cat, "test.log")
	if err := os.WriteFile(logFile, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}

	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})

	result := v.ListLogFiles(true)
	if len(result["mycategory"]) != 1 {
		t.Fatalf("expected 1 log file, got %d", len(result["mycategory"]))
	}
	lf := result["mycategory"][0]
	if lf.Fullpath == "" {
		t.Error("expected non-empty Fullpath when showFullpath=true")
	}
}

// TestListLogFilesMetadata checks Title, Filename and Filesize fields.
func TestListLogFilesMetadata(t *testing.T) {
	tmpRoot := t.TempDir()
	cat := filepath.Join(tmpRoot, "system")
	if err := os.MkdirAll(cat, 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("hello world\n")
	logFile := filepath.Join(cat, "boot.log")
	if err := os.WriteFile(logFile, content, 0644); err != nil {
		t.Fatal(err)
	}

	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})

	result := v.ListLogFiles(false)
	logs, ok := result["system"]
	if !ok || len(logs) != 1 {
		t.Fatalf("expected 1 log file in 'system' category, got map=%v", result)
	}

	lf := logs[0]
	if lf.Title != "boot" {
		t.Errorf("Title = %q, expected %q", lf.Title, "boot")
	}
	if lf.Filename != "boot.log" {
		t.Errorf("Filename = %q, expected %q", lf.Filename, "boot.log")
	}
	if lf.Filesize != int64(len(content)) {
		t.Errorf("Filesize = %d, expected %d", lf.Filesize, len(content))
	}
}

// TestLoadLogFile verifies reading an existing log file.
func TestLoadLogFile(t *testing.T) {
	tmpRoot := t.TempDir()
	cat := filepath.Join(tmpRoot, "mycat")
	if err := os.MkdirAll(cat, 0755); err != nil {
		t.Fatal(err)
	}
	expected := "this is log content"
	if err := os.WriteFile(filepath.Join(cat, "app.log"), []byte(expected), 0644); err != nil {
		t.Fatal(err)
	}

	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})

	content, err := v.LoadLogFile("mycat", "app.log")
	if err != nil {
		t.Fatalf("LoadLogFile() unexpected error: %v", err)
	}
	if content != expected {
		t.Errorf("LoadLogFile() = %q, expected %q", content, expected)
	}
}

// TestLoadLogFileNotFound verifies that a missing file returns an error.
func TestLoadLogFileNotFound(t *testing.T) {
	v := NewLogViewer(&ViewerOption{
		RootFolder: "/tmp/nonexistent_logviewer_xyz",
		Extension:  ".log",
	})

	_, err := v.LoadLogFile("nocat", "nofile.log")
	if err == nil {
		t.Error("LoadLogFile() expected error for non-existent file, got nil")
	}
}

// TestListLogFilesNoMatchingExtension verifies that files with a different
// extension are ignored.
func TestListLogFilesNoMatchingExtension(t *testing.T) {
	tmpRoot := t.TempDir()
	cat := filepath.Join(tmpRoot, "logs")
	if err := os.MkdirAll(cat, 0755); err != nil {
		t.Fatal(err)
	}
	// Write files with .txt extension, viewer is set to .log
	for _, name := range []string{"a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(cat, name), []byte("data"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})

	result := v.ListLogFiles(false)
	if len(result) != 0 {
		t.Errorf("expected 0 categories for non-matching extension, got %d", len(result))
	}
}

// ---------------------------------------------------------------------------
// HTTP handler tests
// ---------------------------------------------------------------------------

// buildViewerWithLogs is a helper that creates a temp log tree and returns a Viewer.
func buildViewerWithLogs(t *testing.T) (*Viewer, string) {
	t.Helper()
	tmpRoot := t.TempDir()
	cat := filepath.Join(tmpRoot, "svclog")
	if err := os.MkdirAll(cat, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cat, "server.log"), []byte("log content"), 0644); err != nil {
		t.Fatal(err)
	}
	v := NewLogViewer(&ViewerOption{
		RootFolder: tmpRoot,
		Extension:  ".log",
	})
	return v, tmpRoot
}

// TestHandleListLog verifies the HTTP handler returns JSON with at least one entry.
func TestHandleListLog(t *testing.T) {
	v, _ := buildViewerWithLogs(t)

	req := httptest.NewRequest(http.MethodGet, "/api/log/list", nil)
	w := httptest.NewRecorder()
	v.HandleListLog(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("HandleListLog status = %d, expected 200", resp.StatusCode)
	}

	body := w.Body.String()
	if strings.TrimSpace(body) == "" {
		t.Fatal("HandleListLog returned empty body")
	}

	// Response should be a JSON object (map of category → []LogFile).
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("HandleListLog returned invalid JSON: %v\nbody: %s", err, body)
	}

	if _, ok := result["svclog"]; !ok {
		t.Errorf("HandleListLog response missing 'svclog' category; got: %v", result)
	}
}

// TestHandleReadLogMissingParams verifies that HandleReadLog sends an error
// when required query parameters are absent.
func TestHandleReadLogMissingParams(t *testing.T) {
	v, _ := buildViewerWithLogs(t)

	// No query parameters at all.
	req := httptest.NewRequest(http.MethodGet, "/api/log/read", nil)
	w := httptest.NewRecorder()
	v.HandleReadLog(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("HandleReadLog with missing params expected error response, got: %s", body)
	}
}

// TestHandleReadLogMissingCategory verifies an error when 'catergory' param is absent.
func TestHandleReadLogMissingCategory(t *testing.T) {
	v, _ := buildViewerWithLogs(t)

	req := httptest.NewRequest(http.MethodGet, "/api/log/read?file=server.log", nil)
	w := httptest.NewRecorder()
	v.HandleReadLog(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("HandleReadLog with missing catergory expected error response, got: %s", body)
	}
}

// TestHandleReadLogSuccess verifies that HandleReadLog returns file contents
// when both required parameters are provided.
func TestHandleReadLogSuccess(t *testing.T) {
	v, _ := buildViewerWithLogs(t)

	req := httptest.NewRequest(http.MethodGet, "/api/log/read?file=server.log&catergory=svclog", nil)
	w := httptest.NewRecorder()
	v.HandleReadLog(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("HandleReadLog status = %d, expected 200", resp.StatusCode)
	}
	body := w.Body.String()
	if !strings.Contains(body, "log content") {
		t.Errorf("HandleReadLog body = %q, expected to contain 'log content'", body)
	}
}

// TestHandleReadLogFileNotFound verifies an error response when the requested
// log file does not exist.
func TestHandleReadLogFileNotFound(t *testing.T) {
	v, _ := buildViewerWithLogs(t)

	req := httptest.NewRequest(http.MethodGet, "/api/log/read?file=missing.log&catergory=svclog", nil)
	w := httptest.NewRecorder()
	v.HandleReadLog(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("HandleReadLog for missing file expected error response, got: %s", body)
	}
}
