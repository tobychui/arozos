package ftpfs

import (
	"os"
	"strings"
	"testing"

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

// TestDebugf checks the debug record of a drive.
func TestDebugf(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		want    string
	}{
		{"debug off", false, ""},
		{"debug on", true, `[FTP FS] ftp1:/ (10.0.0.4:21) Stat "/a"`},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		l := FTPFSAbstraction{uuid: "ftp1", hostname: "10.0.0.4:21"}
		l.debugf("Stat %q", "/a")
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q, want %q", tt.name, got, tt.want)
		}
	}
}
