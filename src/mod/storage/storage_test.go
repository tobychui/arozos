package storage

import (
	"os"
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

func testDrive(uuid string) *fs.FileSystemHandler {
	return &fs.FileSystemHandler{UUID: uuid, Name: strings.ToUpper(uuid[:1]) + uuid[1:], Filesystem: "ext4", Hierarchy: "public"}
}

// TestPoolLookups checks finding, attaching and detaching drives in a pool.
func TestPoolLookups(t *testing.T) {
	pool, err := NewStoragePool([]*fs.FileSystemHandler{testDrive("media"), testDrive("music")}, "system")
	if err != nil {
		t.Fatalf("NewStoragePool error: %v", err)
	}
	tests := []struct {
		name string
		run  func() error
		want bool //whether the step succeeds
	}{
		{"find by id", func() error { _, err := pool.GetFsHandlerByUUID("media"); return err }, true},
		{"find by id with colon", func() error { _, err := pool.GetFsHandlerByUUID("music:/x"); return err }, true},
		{"find missing", func() error { _, err := pool.GetFsHandlerByUUID("video"); return err }, false},
		{"attach new", func() error { return pool.AttachFsHandler(testDrive("video")) }, true},
		{"attach duplicate", func() error { return pool.AttachFsHandler(testDrive("media")) }, false},
		{"vpath on pool", func() error { _, _, err := pool.GetFSHandlerFromVirtualPath("video:/docs"); return err }, true},
		{"vpath off pool", func() error { _, _, err := pool.GetFSHandlerFromVirtualPath("nowhere:/docs"); return err }, false},
	}
	for _, tt := range tests {
		if err := tt.run(); (err == nil) != tt.want {
			t.Errorf("%s: err = %v, want success %v", tt.name, err, tt.want)
		}
	}
	pool.DetachFsHandler("media")
	if pool.ContainDiskID("media") || !pool.ContainDiskID("music") {
		t.Errorf("after detaching media the pool holds %s", describeHandlers(pool.Storages))
	}
}

// TestDescribeHandlers checks the drive list written in pool debug records.
func TestDescribeHandlers(t *testing.T) {
	tests := []struct {
		name string
		fshs []*fs.FileSystemHandler
		want string
	}{
		{"empty", nil, ""},
		{"one", []*fs.FileSystemHandler{testDrive("media")}, "media:/ (Media, ext4, hierarchy public)"},
		{"nil handler", []*fs.FileSystemHandler{testDrive("media"), nil}, "media:/ (Media, ext4, hierarchy public), <nil handler>"},
	}
	for _, tt := range tests {
		if got := describeHandlers(tt.fshs); got != tt.want {
			t.Errorf("%s: describeHandlers() = %q, want %q", tt.name, got, tt.want)
		}
	}
}

// TestPoolDebugTrace checks the pool records written in debug mode, and that
// nothing is written while it is off.
func TestPoolDebugTrace(t *testing.T) {
	tests := []struct {
		enabled bool
		want    []string
	}{
		{false, nil},
		{true, []string{
			"[Pool system] created with 2 drive(s): media:/ (Media, ext4, hierarchy public), <nil handler>",
			"a nil drive handler was put in the pool, using it will panic",
			"[Pool system] attaching video:/ (Video, ext4)",
			"[Pool system] detaching video:/",
		}},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		//A pool holding a nil handler panics on its next lookup, which is
		//what its debug record warns about, so it is only created
		NewStoragePool([]*fs.FileSystemHandler{testDrive("media"), nil}, "system")
		pool, _ := NewStoragePool([]*fs.FileSystemHandler{testDrive("media")}, "system")
		pool.AttachFsHandler(testDrive("video"))
		pool.DetachFsHandler("video")
		got := read()
		if len(tt.want) == 0 && got != "" {
			t.Errorf("debug off: expected no records, got %q", got)
		}
		for _, want := range tt.want {
			if !strings.Contains(got, want) {
				t.Errorf("debug on: %q missing from %q", want, got)
			}
		}
	}
}
