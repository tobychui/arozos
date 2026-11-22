package syncthingserv

import (
	"net/url"
	"slices"
	"testing"
	"time"
)

// stallStep is one look at a folder, at an offset from the start.
type stallStep struct {
	at          time.Duration
	state       string
	localFiles  int
	pulledBytes int64
	wantRestart bool
}

func runStallSteps(t *testing.T, w *stallWatch, start time.Time, steps []stallStep) {
	t.Helper()
	for i, s := range steps {
		st := FolderStatus{State: s.state, LocalFiles: s.localFiles, LocalBytes: int64(s.localFiles) * 100, PulledBytes: s.pulledBytes}
		now := start.Add(s.at)
		got := w.observe("f1", st, now)
		if got != s.wantRestart {
			t.Fatalf("step %d (%v, %s): restart = %v, want %v", i, s.at, s.state, got, s.wantRestart)
		}
		if got {
			w.restarted("f1", now)
		}
	}
}

func TestStallWatchObserve(t *testing.T) {
	m := time.Minute
	tests := []struct {
		name  string
		steps []stallStep
	}{
		{"blocks keep arriving", []stallStep{
			{0, "syncing", 1, 0, false},
			{2 * m, "syncing", 1, 10, false},
			{4 * m, "syncing", 1, 20, false},
			{6 * m, "syncing", 1, 30, false},
			{8 * m, "syncing", 2, 0, false},
		}},
		{"nothing arrives while syncing", []stallStep{
			{0, "syncing", 1, 10, false},
			{2 * m, "syncing", 1, 10, false},
			{3*m - time.Second, "syncing", 1, 10, false},
			{3 * m, "syncing", 1, 10, true},
		}},
		{"idle folders are left alone", []stallStep{
			{0, "idle", 5, 0, false},
			{10 * m, "idle", 5, 0, false},
			{60 * m, "idle", 5, 0, false},
		}},
		{"only time spent syncing counts", []stallStep{
			{0, "idle", 1, 0, false},
			{10 * m, "scanning", 1, 0, false},
			{11 * m, "syncing", 1, 0, false},
			{13 * m, "syncing", 1, 0, false},
			{14 * m, "syncing", 1, 0, true},
		}},
		{"waiting for another folder is not a stall", []stallStep{
			{0, "sync-waiting", 1, 0, false},
			{20 * m, "sync-waiting", 1, 0, false},
		}},
	}
	start := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runStallSteps(t, newStallWatch(), start, tt.steps)
		})
	}
}

func TestStallWatchBackoff(t *testing.T) {
	m := time.Minute
	start := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	w := newStallWatch()
	runStallSteps(t, w, start, []stallStep{
		{0, "syncing", 1, 50, false},
		{3 * m, "syncing", 1, 50, true}, //First stall after 3 minutes
		//The restarted folder scans, then picks its temporary file up again:
		//neither resets the doubled wait
		{4 * m, "scanning", 1, 0, false},
		{5 * m, "syncing", 1, 50, false},
		{10 * m, "syncing", 1, 50, false},
		{11 * m, "syncing", 1, 50, true}, //6 minutes this time
		{22 * m, "syncing", 1, 50, false},
		{23 * m, "syncing", 1, 50, true}, //12 minutes
		{46 * m, "syncing", 1, 50, false},
		{47 * m, "syncing", 1, 50, true}, //24 minutes
		{76 * m, "syncing", 1, 50, false},
		{77 * m, "syncing", 1, 50, true}, //Capped at 30 minutes
		//A finished file brings the wait back to 3 minutes
		{80 * m, "syncing", 2, 0, false},
		{83 * m, "syncing", 2, 0, true},
		{89 * m, "syncing", 2, 0, true}, //6 minutes again
		//So does a pull that finished files and went idle in between looks
		{90 * m, "idle", 3, 0, false},
		{91 * m, "syncing", 3, 0, false},
		{94 * m, "syncing", 3, 0, true},
	})
}

func TestStallWatchKeep(t *testing.T) {
	w := newStallWatch()
	now := time.Now()
	for _, id := range []string{"a", "b", "c"} {
		w.observe(id, FolderStatus{State: "syncing"}, now)
	}
	w.keep(map[string]bool{"b": true})
	if len(w.folders) != 1 || w.folders["b"] == nil {
		t.Errorf("folders after keep = %v, want only b", w.folders)
	}
}

func TestCheckStallsRestartsOnlyStalledFolders(t *testing.T) {
	env := newEnv(t)
	env.m.ServerToggle(true)
	if e := env.addDevice(t, "alice", devA1); e != "" {
		t.Fatalf("add device: %s", e)
	}
	stuck, e := env.addFolder(t, "alice", url.Values{"path": {"user:/Phone/Whatsapp"}, "devices": {`["` + devA1 + `"]`}})
	if e != "" {
		t.Fatalf("add folder: %s", e)
	}
	moving, e := env.addFolder(t, "alice", url.Values{"path": {"user:/Phone/Camera"}, "devices": {`["` + devA1 + `"]`}})
	if e != "" {
		t.Fatalf("add folder: %s", e)
	}
	idle, e := env.addFolder(t, "alice", url.Values{"path": {"user:/Phone/Notes"}, "devices": {`["` + devA1 + `"]`}})
	if e != "" {
		t.Fatalf("add folder: %s", e)
	}

	start := time.Now()
	check := func(offset time.Duration, pulled int64) {
		env.eng.mu.Lock()
		env.eng.status[stuck] = FolderStatus{State: "syncing", LocalFiles: 3795, PulledBytes: 1000}
		env.eng.status[moving] = FolderStatus{State: "syncing", LocalFiles: 10, PulledBytes: pulled}
		env.eng.status[idle] = FolderStatus{State: "idle", LocalFiles: 4}
		env.eng.mu.Unlock()
		env.m.mu.Lock()
		env.m.checkStallsLocked(start.Add(offset))
		env.m.mu.Unlock()
	}
	check(0, 0)
	check(2*time.Minute, 100)
	if len(env.eng.restarts) != 0 {
		t.Fatalf("restarted %v before any folder stalled", env.eng.restarts)
	}
	check(3*time.Minute, 200)
	if !slices.Equal(env.eng.restarts, []string{stuck}) {
		t.Fatalf("restarts = %v, want only the stalled folder %s", env.eng.restarts, stuck)
	}
	//Right after a restart the stuck folder gets a fresh, longer wait
	check(4*time.Minute, 300)
	if len(env.eng.restarts) != 1 {
		t.Fatalf("restarts = %v, want no second restart yet", env.eng.restarts)
	}

	//A paused folder is never restarted
	if _, result, _ := env.call(t, env.m.HandleFolderEdit, "alice", url.Values{"id": {stuck}, "paused": {"true"}}); errorOf(result) != "" {
		t.Fatalf("pause: %s", errorOf(result))
	}
	check(60*time.Minute, 400)
	if len(env.eng.restarts) != 1 {
		t.Fatalf("restarts = %v, a paused folder was restarted", env.eng.restarts)
	}
}
