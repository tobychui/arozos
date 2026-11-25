package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem/abstractions/emptyfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/info/logger"
)

// withDebugLog turns debug logging on or off for one test and points the
// system log at a file in a temp folder, whose path it returns
func withDebugLog(t *testing.T, enabled bool) string {
	t.Helper()
	was := logger.IsDebug()
	logger.SetDebug(enabled)
	l, err := logger.NewLogger("fsdebug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger returned error: %v", err)
	}
	logger.SetDefaultLogger(l)
	t.Cleanup(func() {
		logger.SetDebug(was)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return l.CurrentLogFile
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("unable to read %s: %v", path, err)
	}
	return string(b)
}

// TestWrapForDebugFollowsFlag checks that drives are only wrapped while debug
// logging is on, and never wrapped twice
func TestWrapForDebugFollowsFlag(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		wrapped bool
	}{
		{"debug on", true, true},
		{"debug off", false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugLog(t, tt.enabled)
			inner := localfs.NewLocalFileSystemAbstraction("tst", t.TempDir()+"/", "public", false)
			got := wrapForDebug("tst", "ext4", inner)
			_, isWrapped := got.(*debugAbstraction)
			if isWrapped != tt.wrapped {
				t.Fatalf("wrapped = %v, want %v", isWrapped, tt.wrapped)
			}
			if again := wrapForDebug("tst", "ext4", got); again != got {
				t.Errorf("wrapping twice changed the abstraction")
			}
			if _, ok := UnwrapAbstraction(got).(localfs.LocalFileSystemAbstraction); !ok {
				t.Errorf("UnwrapAbstraction did not return the local abstraction, got %T", UnwrapAbstraction(got))
			}
		})
	}
}

// TestWrapForDebugNil checks that a missing abstraction stays missing
func TestWrapForDebugNil(t *testing.T) {
	withDebugLog(t, true)
	if got := wrapForDebug("tst", "ext4", nil); got != nil {
		t.Errorf("wrapForDebug(nil) = %v, want nil", got)
	}
}

// TestDebugAbstractionForwardsAndLogs checks that calls reach the drive with
// their results, and which of them are logged
func TestDebugAbstractionForwardsAndLogs(t *testing.T) {
	logFile := withDebugLog(t, true)
	root := t.TempDir()
	fsa := wrapForDebug("tst", "ext4", localfs.NewLocalFileSystemAbstraction("tst", root+"/", "public", false))
	target := filepath.Join(root, "a.txt")

	if err := fsa.WriteFile(target, []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	data, err := fsa.ReadFile(target)
	if err != nil || string(data) != "hello" {
		t.Fatalf("ReadFile = %q, %v", data, err)
	}
	if !fsa.FileExists(target) || fsa.IsDir(target) || fsa.GetFileSize(target) != 5 {
		t.Errorf("queries through the wrapper gave wrong answers")
	}
	if _, err := fsa.Stat(filepath.Join(root, "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("Stat of a missing file = %v, want not exist", err)
	}
	if err := fsa.Rename(target, filepath.Join(root, "b.txt")); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	content := readFile(t, logFile)
	tests := []struct {
		text   string
		logged bool
	}{
		{"tst:/(ext4) WriteFile(", true},
		{"tst:/(ext4) ReadFile(", true},
		{"tst:/(ext4) Rename(", true},
		{"tst:/(ext4) Stat(", true}, //The failed one
		{"FileExists(", false},
		{"GetFileSize(", false},
	}
	for _, tt := range tests {
		if got := strings.Contains(content, tt.text); got != tt.logged {
			t.Errorf("%q logged = %v, want %v", tt.text, got, tt.logged)
		}
	}
}

// panicky is an abstraction whose Heartbeat panics
type panicky struct {
	emptyfs.EmptyFileSystemAbstraction
}

func (panicky) Heartbeat() error {
	var fsa FileSystemAbstraction
	return fsa.Heartbeat() //nil interface call, like a drive closed under a request
}

// TestDebugAbstractionTracesPanic checks that a panic in a drive call is logged
// with the drive and operation, and still reaches the caller
func TestDebugAbstractionTracesPanic(t *testing.T) {
	logFile := withDebugLog(t, true)
	fsa := wrapForDebug("S1", "smb", panicky{emptyfs.NewEmptyFileSystemAbstraction()})

	var recovered interface{}
	func() {
		defer func() { recovered = recover() }()
		fsa.Heartbeat()
	}()
	if recovered == nil {
		t.Fatal("the panic did not reach the caller")
	}
	content := readFile(t, logFile)
	if !strings.Contains(content, "PANIC in S1:/(smb) Heartbeat()") {
		t.Errorf("panic not traced with its drive and operation: %q", content)
	}
}

// TestIsLocalFileSystemThroughWrapper checks that a wrapped local disk still
// counts as local, which picks the fast move path
func TestIsLocalFileSystemThroughWrapper(t *testing.T) {
	withDebugLog(t, true)
	fsh := &FileSystemHandler{
		UUID:                  "tst",
		FileSystemAbstraction: wrapForDebug("tst", "ext4", localfs.NewLocalFileSystemAbstraction("tst", t.TempDir()+"/", "public", false)),
	}
	if !isLocalFileSystem(fsh) {
		t.Error("a wrapped local drive is not seen as local")
	}
}

// TestNewFileSystemHandlerWrapsInDebug checks that drives opened in debug mode
// get the wrapper and others do not
func TestNewFileSystemHandlerWrapsInDebug(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
	}{
		{"debug on", true},
		{"debug off", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withDebugLog(t, tt.enabled)
			fsh, err := NewFileSystemHandler(FileSystemOption{
				Name:       "Test",
				Uuid:       "tst",
				Path:       t.TempDir(),
				Hierarchy:  "public",
				Filesystem: "ext4",
			}, RuntimePersistenceConfig{LocalBufferPath: t.TempDir()})
			if err != nil {
				t.Fatalf("NewFileSystemHandler: %v", err)
			}
			defer fsh.Close()
			_, isWrapped := fsh.FileSystemAbstraction.(*debugAbstraction)
			if isWrapped != tt.enabled {
				t.Errorf("wrapped = %v, want %v", isWrapped, tt.enabled)
			}
		})
	}
}
