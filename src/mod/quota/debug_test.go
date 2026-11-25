package quota

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebugMode(enabled)
	t.Cleanup(func() {
		logger.SetDebugMode(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return func() string {
		data, err := os.ReadFile(l.CurrentLogFile)
		if err != nil {
			t.Fatalf("ReadFile error: %v", err)
		}
		return string(data)
	}
}

// TestCalculateQuotaUsageDebug checks the usage measured over a user drive
// and the debug records of the walk.
func TestCalculateQuotaUsageDebug(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "users", "testuser")
	os.MkdirAll(home, 0755)
	os.WriteFile(filepath.Join(home, "a.bin"), make([]byte, 300), 0644)
	drive := &fs.FileSystemHandler{UUID: "user", Hierarchy: "user", Path: root}

	read := captureDebug(t, true)
	qh := NewUserQuotaHandler(openTempDB(t), "testuser", []*fs.FileSystemHandler{drive}, -1)
	qh.CalculateQuotaUsage()
	if qh.UsedStorageQuota != 300 {
		t.Errorf("UsedStorageQuota = %d, want 300", qh.UsedStorageQuota)
	}
	log := read()
	for _, want := range []string{
		"[Quota] testuser: measuring usage over 1 drive(s)",
		"[Quota] testuser: walking user:/",
		"[Quota] testuser: 300 bytes used",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("%q missing from %q", want, log)
		}
	}
}
