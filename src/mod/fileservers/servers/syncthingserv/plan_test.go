package syncthingserv

import (
	"errors"
	"path/filepath"
	"testing"
)

// fakeQuota is a storage quota with fixed numbers.
type fakeQuota struct {
	used, total int64
	recounts    int
	//afterRecount is the usage a recount finds, when set
	afterRecount int64
}

func (q *fakeQuota) Usage() (int64, int64) { return q.used, q.total }
func (q *fakeQuota) Recount() {
	q.recounts++
	if q.afterRecount != 0 {
		q.used = q.afterRecount
	}
}

func testRoot(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "drive")
}

// planFixture resolves "<owner>:/<name>" style paths below root.
type planFixture struct {
	root    string
	exists  map[string]bool
	allowed map[string]bool
	broken  map[string]bool //vpaths that do not resolve
	quota   map[string]Quota
	full    map[string]bool
}

func (f *planFixture) input(devices []Device, folders []Folder) planInput {
	return planInput{
		Devices: devices,
		Folders: folders,
		Exists:  func(owner string) bool { return f.exists[owner] },
		Allowed: func(owner string) bool { return f.allowed[owner] },
		Resolve: func(owner, vpath string) (Location, error) {
			if f.broken[vpath] {
				return Location{}, errors.New("This drive is not mounted")
			}
			return Location{RealPath: filepath.Join(f.root, filepath.FromSlash(vpath[len("user:/"):])), Quota: f.quota[owner]}, nil
		},
		QuotaFull: func(folder Folder, loc Location) bool { return f.full[folder.Owner] },
	}
}

func newFixture(t *testing.T) *planFixture {
	return &planFixture{
		root:    testRoot(t),
		exists:  map[string]bool{"alice": true, "bob": true},
		allowed: map[string]bool{"alice": true, "bob": true},
		broken:  map[string]bool{},
		quota:   map[string]Quota{},
		full:    map[string]bool{},
	}
}

const (
	devA1 = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA"
	devA2 = "CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC"
	devB1 = "BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB"
)

func findFolder(p plan, id string) (planFolder, bool) {
	for _, f := range p.Folders {
		if f.ID == id {
			return f, true
		}
	}
	return planFolder{}, false
}

func findDevice(p plan, id string) (planDevice, bool) {
	for _, d := range p.Devices {
		if d.ID == id {
			return d, true
		}
	}
	return planDevice{}, false
}

func TestPlanNeverSharesWithAnotherUsersDevice(t *testing.T) {
	fx := newFixture(t)
	devices := []Device{{ID: devA1, Owner: "alice"}, {ID: devB1, Owner: "bob"}}
	folders := []Folder{{ID: "f1", Owner: "alice", Path: "user:/Phone", Mode: ModeBackup, Devices: []string{devA1, devB1, "unknown"}}}
	result := buildPlan(fx.input(devices, folders))
	f, ok := findFolder(result.Plan, "f1")
	if !ok {
		t.Fatalf("folder missing from plan")
	}
	if len(f.Devices) != 1 || f.Devices[0] != devA1 {
		t.Fatalf("folder devices = %v, want only %s", f.Devices, devA1)
	}
	if f.Paused {
		t.Fatalf("folder should not be paused: %v", result.FolderReasons["f1"])
	}
}

func TestPlanPausesWhatAUserMayNoLongerUse(t *testing.T) {
	fx := newFixture(t)
	fx.allowed["bob"] = false
	devices := []Device{{ID: devB1, Owner: "bob"}}
	folders := []Folder{{ID: "fb", Owner: "bob", Path: "user:/Bob", Mode: ModeBackup, Devices: []string{devB1}}}
	result := buildPlan(fx.input(devices, folders))
	d, _ := findDevice(result.Plan, devB1)
	if !d.Paused || result.DeviceReasons[devB1].Key != ReasonNotAllowed {
		t.Errorf("device paused=%v reason=%v, want paused not_allowed", d.Paused, result.DeviceReasons[devB1])
	}
	f, _ := findFolder(result.Plan, "fb")
	if !f.Paused || result.FolderReasons["fb"].Key != ReasonNotAllowed {
		t.Errorf("folder paused=%v reason=%v, want paused not_allowed", f.Paused, result.FolderReasons["fb"])
	}
}

func TestPlanDropsDeletedAccounts(t *testing.T) {
	fx := newFixture(t)
	fx.exists["bob"] = false
	devices := []Device{{ID: devA1, Owner: "alice"}, {ID: devB1, Owner: "bob"}}
	folders := []Folder{{ID: "fb", Owner: "bob", Path: "user:/Bob", Devices: []string{devB1}}}
	result := buildPlan(fx.input(devices, folders))
	if _, ok := findDevice(result.Plan, devB1); ok {
		t.Errorf("device of a deleted account is still in the plan")
	}
	if _, ok := findFolder(result.Plan, "fb"); ok {
		t.Errorf("folder of a deleted account is still in the plan")
	}
	if len(result.Gone) != 1 || result.Gone[0] != "bob" {
		t.Errorf("gone = %v, want [bob]", result.Gone)
	}
}

func TestPlanFolderReasons(t *testing.T) {
	tests := []struct {
		name       string
		setup      func(fx *planFixture)
		folder     Folder
		lastPath   string
		wantReason string
		wantInPlan bool
	}{
		{
			name:       "running",
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A"},
			wantInPlan: true,
		},
		{
			name:       "paused by the user",
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A", Paused: true},
			wantReason: ReasonPaused,
			wantInPlan: true,
		},
		{
			name:       "quota full",
			setup:      func(fx *planFixture) { fx.quota["alice"] = &fakeQuota{}; fx.full["alice"] = true },
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A"},
			wantReason: ReasonQuota,
			wantInPlan: true,
		},
		{
			name:       "full quota does not matter on a drive without one",
			setup:      func(fx *planFixture) { fx.full["alice"] = true },
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A"},
			wantInPlan: true,
		},
		{
			name:       "drive gone, last path known",
			setup:      func(fx *planFixture) { fx.broken["user:/A"] = true },
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A"},
			lastPath:   "/somewhere/A",
			wantReason: ReasonNoAccess,
			wantInPlan: true,
		},
		{
			name:       "drive gone, never resolved",
			setup:      func(fx *planFixture) { fx.broken["user:/A"] = true },
			folder:     Folder{ID: "f", Owner: "alice", Path: "user:/A"},
			wantReason: ReasonNoAccess,
			wantInPlan: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newFixture(t)
			if tt.setup != nil {
				tt.setup(fx)
			}
			in := fx.input(nil, []Folder{tt.folder})
			in.LastPath = func(string) string { return tt.lastPath }
			result := buildPlan(in)
			f, inPlan := findFolder(result.Plan, "f")
			if inPlan != tt.wantInPlan {
				t.Fatalf("in plan = %v, want %v", inPlan, tt.wantInPlan)
			}
			if got := result.FolderReasons["f"].Key; got != tt.wantReason {
				t.Errorf("reason = %q, want %q", got, tt.wantReason)
			}
			if inPlan && f.Paused != (tt.wantReason != "") {
				t.Errorf("paused = %v with reason %q", f.Paused, tt.wantReason)
			}
			if inPlan && tt.lastPath != "" && f.Path != tt.lastPath {
				t.Errorf("path = %q, want the last known %q", f.Path, tt.lastPath)
			}
		})
	}
}

func TestPlanPausesTheNewerOfTwoOverlappingFolders(t *testing.T) {
	fx := newFixture(t)
	folders := []Folder{
		{ID: "inner", Owner: "bob", Path: "user:/Photos/2026", Added: 20},
		{ID: "outer", Owner: "alice", Path: "user:/Photos", Added: 10},
		{ID: "other", Owner: "alice", Path: "user:/Music", Added: 30},
	}
	result := buildPlan(fx.input(nil, folders))
	if r := result.FolderReasons["inner"]; r.Key != ReasonOverlap {
		t.Errorf("inner reason = %v, want overlap", r)
	}
	if _, ok := result.FolderReasons["outer"]; ok {
		t.Errorf("the older folder was paused: %v", result.FolderReasons["outer"])
	}
	if _, ok := result.FolderReasons["other"]; ok {
		t.Errorf("an unrelated folder was paused: %v", result.FolderReasons["other"])
	}
}

func TestPlanNeverIgnoresASharedFolder(t *testing.T) {
	fx := newFixture(t)
	devices := []Device{{ID: devA1, Owner: "alice", Ignored: []string{"f1", "f2"}}}
	folders := []Folder{{ID: "f1", Owner: "alice", Path: "user:/A", Devices: []string{devA1}}}
	result := buildPlan(fx.input(devices, folders))
	d, _ := findDevice(result.Plan, devA1)
	if len(d.Ignored) != 1 || d.Ignored[0] != "f2" {
		t.Errorf("ignored = %v, want [f2]", d.Ignored)
	}
}

func TestPlanUnknownModeFallsBackToBackup(t *testing.T) {
	fx := newFixture(t)
	result := buildPlan(fx.input(nil, []Folder{{ID: "f", Owner: "alice", Path: "user:/A", Mode: "bogus"}}))
	f, _ := findFolder(result.Plan, "f")
	if f.Mode != ModeBackup {
		t.Errorf("mode = %q, want %q", f.Mode, ModeBackup)
	}
}

func TestPathsOverlap(t *testing.T) {
	sep := string(filepath.Separator)
	base := filepath.Join(t.TempDir(), "x")
	tests := []struct {
		a, b string
		want bool
	}{
		{base, base, true},
		{base, base + sep, true},
		{filepath.Join(base, "a"), base, true},
		{base, filepath.Join(base, "a", "b"), true},
		{filepath.Join(base, "a"), filepath.Join(base, "ab"), false},
		{filepath.Join(base, "a"), filepath.Join(base, "b"), false},
		{"", base, false},
	}
	for _, tt := range tests {
		if got := pathsOverlap(tt.a, tt.b); got != tt.want {
			t.Errorf("pathsOverlap(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
		}
	}
}
