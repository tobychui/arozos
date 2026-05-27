package scheduler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

// ── Helpers ──────────────────────────────────────────────────────────────────

// newTestScheduler returns a minimal Scheduler wired to a temp cron file.
// Only options.CronFile and options.Logger are set; UserHandler and Gateway
// are left nil because the functions under test don't call them.
func newTestScheduler(t *testing.T) (*Scheduler, func()) {
	t.Helper()
	dir := t.TempDir()
	cronFile := filepath.Join(dir, "cron.json")

	// Write an empty job list so the file is valid from the start
	if err := os.WriteFile(cronFile, []byte("[]"), 0644); err != nil {
		t.Fatalf("could not create temp cron file: %v", err)
	}

	log, err := logger.NewTmpLogger()
	if err != nil {
		t.Fatalf("could not create tmp logger: %v", err)
	}

	s := &Scheduler{
		jobs: []*Job{},
		options: &ScheudlerOption{
			CronFile: cronFile,
			Logger:   log,
		},
	}
	return s, func() {} // t.TempDir already cleans up
}

// sampleJob returns a predictable Job for use in multiple tests.
func sampleJob(name, creator, appName string) *Job {
	return &Job{
		Name:              name,
		Creator:           creator,
		AppName:           appName,
		Description:       "test job",
		ExecutionInterval: 3600,
		BaseTime:          1_000_000,
		ScriptVpath:       appName + "/cron.agi",
		FshID:             WebRootFshID,
	}
}

// ── alignBaseTime ─────────────────────────────────────────────────────────────

func TestAlignBaseTime_AlreadyAligned(t *testing.T) {
	// A value already on a minute boundary should be unchanged.
	aligned := int64(1_000_000 * 60) // divisible by 60
	if got := alignBaseTime(aligned); got != aligned {
		t.Errorf("alignBaseTime(%d) = %d, want %d", aligned, got, aligned)
	}
}

func TestAlignBaseTime_FloorsToMinute(t *testing.T) {
	base := int64(1_748_391_847) // arbitrary timestamp with seconds component
	want := (base / 60) * 60
	if got := alignBaseTime(base); got != want {
		t.Errorf("alignBaseTime(%d) = %d, want %d", base, got, want)
	}
	if got := alignBaseTime(base) % 60; got != 0 {
		t.Errorf("alignBaseTime result %d is not divisible by 60", alignBaseTime(base))
	}
}

func TestAlignBaseTime_Zero(t *testing.T) {
	if got := alignBaseTime(0); got != 0 {
		t.Errorf("alignBaseTime(0) = %d, want 0", got)
	}
}

func TestAlignBaseTime_NowIsAligned(t *testing.T) {
	// Simulates registration happening at any real unix second.
	now := time.Now().Unix()
	aligned := alignBaseTime(now)
	if aligned%60 != 0 {
		t.Errorf("alignBaseTime(now=%d) = %d, not minute-aligned", now, aligned)
	}
	if aligned > now {
		t.Errorf("alignBaseTime(now=%d) = %d, must not be in the future", now, aligned)
	}
}

// ── containsVpathSeparator ────────────────────────────────────────────────────

func TestContainsVpathSeparator(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"user:/AppData/MyApp/cron.agi", true},
		{"tmp:/scratch/foo.agi", true},
		{"cron.agi", false},
		{"MyApp/cron.agi", false},
		{"", false},
		{":::", true},
		{"/no/colon/here", false},
	}
	for _, c := range cases {
		if got := containsVpathSeparator(c.input); got != c.want {
			t.Errorf("containsVpathSeparator(%q) = %v, want %v", c.input, got, c.want)
		}
	}
}

// ── In-memory job list operations ────────────────────────────────────────────

func TestJobExists_TrueWhenPresent(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("MyTask", "alice", "MyApp"))
	if !s.JobExists("MyTask") {
		t.Error("JobExists returned false for a present job")
	}
}

func TestJobExists_FalseWhenAbsent(t *testing.T) {
	s, _ := newTestScheduler(t)
	if s.JobExists("NonExistent") {
		t.Error("JobExists returned true for an absent job")
	}
}

func TestGetScheduledJobByName_Found(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("TaskA", "bob", "AppX"))
	j := s.GetScheduledJobByName("TaskA")
	if j == nil {
		t.Fatal("GetScheduledJobByName returned nil for existing job")
	}
	if j.Creator != "bob" {
		t.Errorf("Creator = %q, want %q", j.Creator, "bob")
	}
}

func TestGetScheduledJobByName_NotFound(t *testing.T) {
	s, _ := newTestScheduler(t)
	if s.GetScheduledJobByName("Ghost") != nil {
		t.Error("GetScheduledJobByName should return nil for unknown job")
	}
}

func TestRemoveJobFromScheduleList(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs,
		sampleJob("Keep", "alice", "App1"),
		sampleJob("Remove", "alice", "App1"),
	)

	s.RemoveJobFromScheduleList("Remove")

	if s.JobExists("Remove") {
		t.Error("job 'Remove' should have been deleted")
	}
	if !s.JobExists("Keep") {
		t.Error("job 'Keep' should still exist")
	}
	if len(s.jobs) != 1 {
		t.Errorf("jobs length = %d, want 1", len(s.jobs))
	}
}

func TestRemoveJobFromScheduleList_NonExistent(t *testing.T) {
	// Removing a non-existent job should be a no-op.
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("Keep", "alice", "App1"))
	s.RemoveJobFromScheduleList("DoesNotExist")
	if len(s.jobs) != 1 {
		t.Errorf("jobs length changed unexpectedly: got %d", len(s.jobs))
	}
}

// ── App-specific operations ───────────────────────────────────────────────────

func TestAppJobExists(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("SyncTask", "alice", "MyApp"))

	if !s.AppJobExists("MyApp", "alice", "SyncTask") {
		t.Error("AppJobExists should return true for matching app/creator/task")
	}
	// Wrong creator
	if s.AppJobExists("MyApp", "bob", "SyncTask") {
		t.Error("AppJobExists should return false for wrong creator")
	}
	// Wrong app
	if s.AppJobExists("OtherApp", "alice", "SyncTask") {
		t.Error("AppJobExists should return false for wrong app name")
	}
	// Wrong task
	if s.AppJobExists("MyApp", "alice", "WrongTask") {
		t.Error("AppJobExists should return false for wrong task name")
	}
}

func TestGetJobsByApp(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs,
		sampleJob("Task1", "alice", "AppA"),
		sampleJob("Task2", "bob", "AppA"),
		sampleJob("Task3", "alice", "AppB"),
	)

	appAJobs := s.GetJobsByApp("AppA")
	if len(appAJobs) != 2 {
		t.Errorf("GetJobsByApp(AppA) = %d jobs, want 2", len(appAJobs))
	}
	appBJobs := s.GetJobsByApp("AppB")
	if len(appBJobs) != 1 {
		t.Errorf("GetJobsByApp(AppB) = %d jobs, want 1", len(appBJobs))
	}
	if len(s.GetJobsByApp("Unknown")) != 0 {
		t.Error("GetJobsByApp should return empty slice for unknown app")
	}
}

func TestRemoveJobsByApp(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs,
		sampleJob("Task1", "alice", "AppA"),
		sampleJob("Task2", "bob", "AppA"),
		sampleJob("Task3", "alice", "AppB"),
	)

	s.RemoveJobsByApp("AppA")

	if s.JobExists("Task1") || s.JobExists("Task2") {
		t.Error("AppA jobs should have been removed")
	}
	if !s.JobExists("Task3") {
		t.Error("AppB job should still exist")
	}
	// Verify cron file was persisted
	saved, err := loadJobsFromFile(s.options.CronFile)
	if err != nil {
		t.Fatalf("could not load saved cron file: %v", err)
	}
	if len(saved) != 1 {
		t.Errorf("saved jobs = %d, want 1", len(saved))
	}
}

// ── File I/O round-trip ───────────────────────────────────────────────────────

func TestSaveAndLoadJobsRoundTrip(t *testing.T) {
	s, _ := newTestScheduler(t)
	original := []*Job{
		{
			Name:              "DailyBackup",
			Creator:           "carol",
			AppName:           "BackupApp",
			Description:       "Nightly backup",
			ExecutionInterval: 86400,
			BaseTime:          alignBaseTime(time.Now().Unix()),
			ScriptVpath:       "BackupApp/cron.agi",
			FshID:             WebRootFshID,
		},
		{
			Name:              "HourlySync",
			Creator:           "dave",
			AppName:           "",
			Description:       "Hourly sync",
			ExecutionInterval: 3600,
			BaseTime:          alignBaseTime(time.Now().Unix()),
			ScriptVpath:       "user:/AppData/sync.agi",
			FshID:             "some-fsh-uuid",
		},
	}
	s.jobs = original

	if err := s.saveJobsToCronFile(); err != nil {
		t.Fatalf("saveJobsToCronFile: %v", err)
	}

	loaded, err := loadJobsFromFile(s.options.CronFile)
	if err != nil {
		t.Fatalf("loadJobsFromFile: %v", err)
	}
	if len(loaded) != len(original) {
		t.Fatalf("loaded %d jobs, want %d", len(loaded), len(original))
	}
	for i, j := range loaded {
		if j.Name != original[i].Name {
			t.Errorf("[%d] Name = %q, want %q", i, j.Name, original[i].Name)
		}
		if j.Creator != original[i].Creator {
			t.Errorf("[%d] Creator = %q, want %q", i, j.Creator, original[i].Creator)
		}
		if j.ExecutionInterval != original[i].ExecutionInterval {
			t.Errorf("[%d] ExecutionInterval = %d, want %d", i, j.ExecutionInterval, original[i].ExecutionInterval)
		}
		if j.FshID != original[i].FshID {
			t.Errorf("[%d] FshID = %q, want %q", i, j.FshID, original[i].FshID)
		}
	}
}

func TestLoadJobsFromFile_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(bad, []byte("{not json}"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadJobsFromFile(bad); err == nil {
		t.Error("expected error for invalid JSON, got nil")
	}
}

func TestLoadJobsFromFile_Missing(t *testing.T) {
	if _, err := loadJobsFromFile("/nonexistent/path/cron.json"); err == nil {
		t.Error("expected error for missing file, got nil")
	}
}

func TestSaveJobsToCronFile_EmptyList(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = []*Job{}
	if err := s.saveJobsToCronFile(); err != nil {
		t.Fatalf("saveJobsToCronFile with empty list: %v", err)
	}
	data, _ := os.ReadFile(s.options.CronFile)
	var jobs []*Job
	if err := json.Unmarshal(data, &jobs); err != nil {
		t.Fatalf("saved content is not valid JSON: %v", err)
	}
	if len(jobs) != 0 {
		t.Errorf("saved %d jobs, want 0", len(jobs))
	}
}

// ── RegisterJobFromAGI (app-root path) ───────────────────────────────────────

func TestRegisterJobFromAGI_AppRootSuccess(t *testing.T) {
	s, _ := newTestScheduler(t)

	// Create a real temp script so os.Stat succeeds.
	scriptDir := t.TempDir()
	appName := "TestApp"
	webRoot := filepath.Join(scriptDir, appName)
	if err := os.MkdirAll(webRoot, 0755); err != nil {
		t.Fatal(err)
	}
	scriptFile := filepath.Join(webRoot, "cron.agi")
	if err := os.WriteFile(scriptFile, []byte("sendOK();"), 0644); err != nil {
		t.Fatal(err)
	}

	// Temporarily override WebRootBase for this test by passing the
	// constructed realPath directly via a non-colon path with the scriptDir
	// as root.  We replicate the internal resolution logic here so we can
	// inject a custom WebRootBase path.

	// Directly exercise the internal logic without patching the constant:
	// build the expected stored vpath and verify the job is created.
	origBase := WebRootBase
	// Can't change a const at runtime, so we test via the file-system state
	// the function reads.  Place our temp web root inside a path matching
	// the constant: we shadow it with a symlink trick.
	realWebRoot, _ := filepath.Abs("./web")
	scriptAppDir := filepath.Join(realWebRoot, appName)
	if err := os.MkdirAll(scriptAppDir, 0755); err != nil {
		// If ./web doesn't exist (CI), skip the os.Stat part and test
		// the error path instead.
		t.Skipf("cannot create web root dir (%v), skipping app-root registration test", err)
	}
	defer os.RemoveAll(scriptAppDir)
	realScript := filepath.Join(scriptAppDir, "cron.agi")
	os.WriteFile(realScript, []byte("sendOK();"), 0644)
	defer os.Remove(realScript)
	_ = origBase

	err := s.RegisterJobFromAGI("alice", appName, "AppTask", "cron.agi", "desc", 3600, time.Now().Unix())
	if err != nil {
		t.Fatalf("RegisterJobFromAGI: %v", err)
	}
	if !s.JobExists("AppTask") {
		t.Error("job 'AppTask' should exist after RegisterJobFromAGI")
	}
	j := s.GetScheduledJobByName("AppTask")
	if j.FshID != WebRootFshID {
		t.Errorf("FshID = %q, want %q", j.FshID, WebRootFshID)
	}
	if j.AppName != appName {
		t.Errorf("AppName = %q, want %q", j.AppName, appName)
	}
	if j.BaseTime%60 != 0 {
		t.Errorf("BaseTime %d is not minute-aligned", j.BaseTime)
	}
}

func TestRegisterJobFromAGI_DuplicateName(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("Dupe", "alice", "App"))

	err := s.RegisterJobFromAGI("alice", "App", "Dupe", "cron.agi", "", 3600, time.Now().Unix())
	if err == nil {
		t.Error("expected error for duplicate task name, got nil")
	}
}

func TestRegisterJobFromAGI_AppScriptNotFound(t *testing.T) {
	s, _ := newTestScheduler(t)
	err := s.RegisterJobFromAGI("alice", "NoSuchApp", "Task", "cron.agi", "", 3600, time.Now().Unix())
	if err == nil {
		t.Error("expected error when app script file does not exist, got nil")
	}
}

// ── UnregisterJobFromAGI ─────────────────────────────────────────────────────

func TestUnregisterJobFromAGI_OwnerCanRemove(t *testing.T) {
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("OwnedTask", "alice", "App"))

	if err := s.UnregisterJobFromAGI("alice", "OwnedTask"); err != nil {
		t.Fatalf("UnregisterJobFromAGI: %v", err)
	}
	if s.JobExists("OwnedTask") {
		t.Error("job should be removed after unregistration")
	}
}

func TestUnregisterJobFromAGI_NotFound(t *testing.T) {
	s, _ := newTestScheduler(t)
	if err := s.UnregisterJobFromAGI("alice", "Ghost"); err == nil {
		t.Error("expected error for non-existent task, got nil")
	}
}

func TestUnregisterJobFromAGI_WrongCreatorNoUserHandler(t *testing.T) {
	// When creator doesn't match and there's no UserHandler, expect permission denied.
	s, _ := newTestScheduler(t)
	s.jobs = append(s.jobs, sampleJob("AliceTask", "alice", "App"))

	err := s.UnregisterJobFromAGI("bob", "AliceTask")
	if err == nil {
		t.Error("expected permission denied error, got nil")
	}
}

// ── BaseTime alignment in Register paths ─────────────────────────────────────

func TestAlignBaseTime_IntegrationWithJobCreation(t *testing.T) {
	// Create a Job directly (as the handlers do) and verify alignment.
	baseRaw := time.Now().Unix()
	j := &Job{
		Name:              "AlignTest",
		BaseTime:          alignBaseTime(baseRaw),
		ExecutionInterval: 60,
	}
	if j.BaseTime%60 != 0 {
		t.Errorf("job BaseTime %d is not minute-aligned", j.BaseTime)
	}
}
