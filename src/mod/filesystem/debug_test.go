package filesystem

import (
	"os"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
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

// TestFshDebugName checks how a handler is named in debug records, nil and
// closed handlers included.
func TestFshDebugName(t *testing.T) {
	abs := localfs.NewLocalFileSystemAbstraction("d1", t.TempDir(), "public", false)
	tests := []struct {
		name string
		fsh  *FileSystemHandler
		want string
	}{
		{"nil handler", nil, "<nil handler>"},
		{"no abstraction", &FileSystemHandler{UUID: "d1"}, "d1:/ <nil abstraction>"},
		{"closed", &FileSystemHandler{UUID: "d1", FileSystemAbstraction: abs, Closed: true}, "d1:/ <closed>"},
		{"open", &FileSystemHandler{UUID: "d1", FileSystemAbstraction: abs}, "d1:/"},
	}
	for _, tt := range tests {
		if got := fshDebugName(tt.fsh); got != tt.want {
			t.Errorf("%s: fshDebugName() = %q, want %q", tt.name, got, tt.want)
		}
	}
}

// TestHandlerDebugf checks that a handler's debug record names the drive and
// warns about the states that make the next call panic.
func TestHandlerDebugf(t *testing.T) {
	abs := localfs.NewLocalFileSystemAbstraction("d1", t.TempDir(), "public", false)
	tests := []struct {
		name    string
		enabled bool
		fsh     *FileSystemHandler
		want    string
	}{
		{"debug off", false, &FileSystemHandler{UUID: "d1", FileSystemAbstraction: abs}, ""},
		{"nil handler", true, nil, "[File System] reading x [handler is nil, this call will panic]"},
		{"no abstraction", true, &FileSystemHandler{UUID: "d1", Name: "Disk", Filesystem: "ext4"}, "[File System] d1:/ (Disk, ext4) reading x [abstraction is nil, a call on it will panic]"},
		{"closed", true, &FileSystemHandler{UUID: "d1", Name: "Disk", Filesystem: "ext4", FileSystemAbstraction: abs, Closed: true}, "[File System] d1:/ (Disk, ext4) reading x [drive is closed]"},
		{"open", true, &FileSystemHandler{UUID: "d1", Name: "Disk", Filesystem: "ext4", FileSystemAbstraction: abs}, "[File System] d1:/ (Disk, ext4) reading x\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			read := captureDebug(t, tt.enabled)
			tt.fsh.debugf("reading %s", "x")
			got := read()
			if tt.want == "" {
				if got != "" {
					t.Errorf("expected no record, got %q", got)
				}
				return
			}
			if !strings.Contains(got, tt.want) {
				t.Errorf("record %q does not contain %q", got, tt.want)
			}
		})
	}
}

// TestFileCopyDebugTrace checks that a copy leaves a trail of what it did, in
// order, when debug mode is on.
func TestFileCopyDebugTrace(t *testing.T) {
	read := captureDebug(t, true)
	srcFsh, srcRoot := newTestLocalHandler(t, "srcdrive")
	destFsh, destRoot := newTestLocalHandler(t, "destdrive")
	writeTestFile(t, srcRoot+"a.bin", 1024)

	if err := FileCopy(srcFsh, srcRoot+"a.bin", destFsh, destRoot, "overwrite", nil); err != nil {
		t.Fatalf("FileCopy() returned error: %v", err)
	}
	log := read()
	steps := []string{
		"[Copy] srcdrive:/ ",
		"[Stream] srcdrive:/ ",
		"(1024 bytes) -> destdrive:/ ",
		"[Copy] " + `"` + srcRoot + "a.bin" + `"`,
	}
	last := -1
	for _, step := range steps {
		i := strings.Index(log, step)
		if i < 0 {
			t.Fatalf("trace step %q missing from %q", step, log)
		}
		if i < last {
			t.Errorf("trace step %q is out of order in %q", step, log)
		}
		last = i
	}
	if !strings.Contains(log, " done") {
		t.Errorf("the copy was not reported done: %q", log)
	}
}

// TestGetIDFromVirtualPathDebug checks that refused virtual paths are traced.
func TestGetIDFromVirtualPathDebug(t *testing.T) {
	tests := []struct {
		vpath string
		want  string
	}{
		{"nodrive", "[Vpath] \"nodrive\" has no drive id"},
		{"user:../bob/a.txt", "climbs above the root of user:/, refused"},
	}
	for _, tt := range tests {
		read := captureDebug(t, true)
		if _, _, err := GetIDFromVirtualPath(tt.vpath); err == nil {
			t.Errorf("GetIDFromVirtualPath(%q) should fail", tt.vpath)
		}
		if got := read(); !strings.Contains(got, tt.want) {
			t.Errorf("GetIDFromVirtualPath(%q) record %q does not contain %q", tt.vpath, got, tt.want)
		}
	}
}
