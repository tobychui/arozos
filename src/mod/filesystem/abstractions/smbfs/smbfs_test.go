package smbfs

import (
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/info/logger"
)

// Translation needs no connection, so the abstraction is built bare
func TestVirtualPathToRealPath(t *testing.T) {
	tests := []struct {
		hierarchy string
		vpath     string
		want      string
	}{
		{"user", "nas:/Desktop/a.txt", "share\\users\\alice\\Desktop\\a.txt"},
		{"user", "nas:/", "share\\users\\alice"},
		{"user", "nas:/Desktop/../Music", "share\\users\\alice\\Music"},
		{"public", "nas:/docs/a.txt", "share\\docs\\a.txt"},
		{"public", "nas:/", "share"},
	}

	for _, tt := range tests {
		a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", Hierarchy: tt.hierarchy, fsaRoot: "share"}
		got, err := a.VirtualPathToRealPath(tt.vpath, "alice")
		if err != nil {
			t.Errorf("[%s] VirtualPathToRealPath(%q) unexpected error: %v", tt.hierarchy, tt.vpath, err)
			continue
		}
		if got != tt.want {
			t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want %q", tt.hierarchy, tt.vpath, got, tt.want)
		}
	}
}

func TestVirtualPathToRealPath_RejectsTraversal(t *testing.T) {
	for _, hierarchy := range []string{"user", "public"} {
		a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", Hierarchy: hierarchy, fsaRoot: "share"}
		for _, vpath := range []string{"nas:../bob/secret.txt", "nas:/../bob", "nas:/a/../../bob", "nas:..\\bob"} {
			if got, err := a.VirtualPathToRealPath(vpath, "alice"); err == nil {
				t.Errorf("[%s] VirtualPathToRealPath(%q) = %q, want an error", hierarchy, vpath, got)
			}
		}
	}
}

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebug(enabled)
	t.Cleanup(func() {
		logger.SetDebug(false)
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

// TestDebugf checks the debug record of a drive, which warns when no share is
// mounted because the next call on it panics.
func TestDebugf(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		want    string
	}{
		{"debug off", false, ""},
		{"no share mounted", true, `[SMB-FS] nas:/ (10.0.0.2:445/media) Open "a.txt" [share is nil: the drive is not connected, this call will panic]`},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", ipaddr: "10.0.0.2:445", smbRoot: "media"}
		a.debugf("Open %q", "a.txt")
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q, want %q", tt.name, got, tt.want)
		}
	}
}

// TestVirtualPathToRealPathDebug checks that path translation is traced.
func TestVirtualPathToRealPathDebug(t *testing.T) {
	read := captureDebug(t, true)
	a := ServerMessageBlockFileSystemAbstraction{UUID: "nas", Hierarchy: "public", fsaRoot: "share"}
	if _, err := a.VirtualPathToRealPath("nas:/docs/a.txt", "alice"); err != nil {
		t.Fatalf("VirtualPathToRealPath error: %v", err)
	}
	want := `VirtualPathToRealPath "nas:/docs/a.txt" for alice -> "share\\docs\\a.txt"`
	if got := read(); !strings.Contains(got, want) {
		t.Errorf("record %q does not contain %q", got, want)
	}
}
