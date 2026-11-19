package syncthingserv

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/database"
)

const serverID = "SSSSSSS-SSSSSSS-SSSSSSS-SSSSSSS-SSSSSSS-SSSSSSS-SSSSSSS-SSSSSSS"

// fakeEngine records what the manager asks of Syncthing.
type fakeEngine struct {
	mu       sync.Mutex
	running  bool
	starts   int
	applied  []plan
	offers   map[string][]Offer
	bytes    map[string]int64
	startErr error
}

func (e *fakeEngine) Start(cfg engineConfig, p plan) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.startErr != nil {
		return e.startErr
	}
	e.running = true
	e.starts++
	e.applied = append(e.applied, p)
	return nil
}
func (e *fakeEngine) Stop() { e.mu.Lock(); e.running = false; e.mu.Unlock() }
func (e *fakeEngine) Apply(cfg engineConfig, p plan) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.applied = append(e.applied, p)
	return nil
}
func (e *fakeEngine) DeviceID() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.running {
		return ""
	}
	return serverID
}
func (e *fakeEngine) ParseDeviceID(s string) (string, error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) != len(serverID) || strings.Count(s, "-") != 7 {
		return "", errors.New("bad id")
	}
	return s, nil
}
func (e *fakeEngine) FolderStatus(id string) FolderStatus { return FolderStatus{State: "idle"} }
func (e *fakeEngine) DeviceStatus(id string) DeviceStatus { return DeviceStatus{} }
func (e *fakeEngine) Offers(deviceID string) []Offer {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.offers[deviceID]
}
func (e *fakeEngine) Rescan(folderID string) error { return nil }
func (e *fakeEngine) LocalBytes(folderID string) (int64, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.running {
		return 0, false
	}
	return e.bytes[folderID], true
}
func (e *fakeEngine) UnknownDevices() []UnknownDevice { return nil }

func (e *fakeEngine) lastPlan() plan {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.applied) == 0 {
		return plan{}
	}
	return e.applied[len(e.applied)-1]
}

// testEnv is a manager over a temp database, with users alice (admin), bob
// (in group "family") and carol (in no allowed group).
type testEnv struct {
	m        *Manager
	eng      *fakeEngine
	db       *database.Database
	root     string
	password bool //What ConfirmPassword answers
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()
	db, err := database.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	t.Cleanup(db.Close)
	env := &testEnv{eng: &fakeEngine{offers: map[string][]Offer{}, bytes: map[string]int64{}}, db: db, root: filepath.Join(dir, "drives"), password: true}
	groups := map[string][]string{"alice": {"administrator"}, "bob": {"family"}, "carol": {"guests"}}
	opt := &ManagerOption{
		Sysdb:    db,
		StateDir: filepath.Join(dir, "syncthing"),
		CurrentUser: func(w http.ResponseWriter, r *http.Request) (string, error) {
			if u := r.Header.Get("X-Test-User"); u != "" {
				return u, nil
			}
			return "", errors.New("not logged in")
		},
		ConfirmPassword: func(w http.ResponseWriter, r *http.Request) bool {
			if !env.password {
				w.WriteHeader(http.StatusUnauthorized)
			}
			return env.password
		},
		UserExists: func(u string) bool { _, ok := groups[u]; return ok },
		IsAdmin:    func(u string) bool { return u == "alice" },
		InGroups: func(u string, want []string) bool {
			for _, g := range groups[u] {
				for _, w := range want {
					if g == w {
						return true
					}
				}
			}
			return false
		},
		ListGroups: func() []string { return []string{"administrator", "family", "guests"} },
		ResolveFolder: func(username, vpath string, create bool) (Location, error) {
			if !strings.HasPrefix(vpath, "user:/") {
				return Location{}, errors.New("Syncthing can only keep folders on a local disk")
			}
			return Location{RealPath: filepath.Join(env.root, username, filepath.FromSlash(strings.TrimPrefix(vpath, "user:/")))}, nil
		},
		engine: env.eng,
	}
	m, err := NewManager(opt)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	t.Cleanup(m.Close)
	env.m = m
	return env
}

// call sends a request as a user and decodes the JSON answer.
func (env *testEnv) call(t *testing.T, handler http.HandlerFunc, user string, form url.Values) (int, map[string]any, string) {
	t.Helper()
	var r *http.Request
	if form == nil {
		r = httptest.NewRequest(http.MethodGet, "/", nil)
	} else {
		r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	handler(w, r)
	body := w.Body.String()
	result := map[string]any{}
	json.Unmarshal([]byte(body), &result)
	return w.Code, result, body
}

func errorOf(result map[string]any) string {
	if e, ok := result["error"].(string); ok {
		return e
	}
	return ""
}

func (env *testEnv) setGroups(t *testing.T, groups ...string) {
	t.Helper()
	list, _ := json.Marshal(groups)
	_, result, _ := env.call(t, env.m.HandleConfig, "alice", url.Values{"groups": {string(list)}})
	if e := errorOf(result); e != "" {
		t.Fatalf("config: %s", e)
	}
}

func (env *testEnv) addDevice(t *testing.T, user, id string) string {
	t.Helper()
	_, result, _ := env.call(t, env.m.HandleDeviceAdd, user, url.Values{"id": {id}, "name": {"Phone"}, "password": {"x"}})
	return errorOf(result)
}

func (env *testEnv) addFolder(t *testing.T, user string, form url.Values) (string, string) {
	t.Helper()
	_, result, body := env.call(t, env.m.HandleFolderAdd, user, form)
	if e := errorOf(result); e != "" {
		return "", e
	}
	var id string
	json.Unmarshal([]byte(body), &id)
	return id, ""
}

func TestToggleIsKeptAcrossRestarts(t *testing.T) {
	env := newEnv(t)
	if env.m.IsEnabled() {
		t.Fatalf("a new manager must start switched off")
	}
	if err := env.m.ServerToggle(true); err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	if !env.m.IsEnabled() || !env.eng.running {
		t.Fatalf("not running after toggle on")
	}
	env.m.Close()

	//Close keeps the choice, so a new manager starts it again
	again, err := NewManager(env.m.opt)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer again.Close()
	if !again.IsEnabled() {
		t.Fatalf("the server did not start again after a restart")
	}
	if err := again.ServerToggle(false); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	if env.m.store.enabled() {
		t.Fatalf("switching off was not saved")
	}
}

func TestFailedStartIsNotSavedAsOn(t *testing.T) {
	env := newEnv(t)
	env.eng.startErr = errors.New("port in use")
	if err := env.m.ServerToggle(true); err == nil {
		t.Fatalf("a failed start reported no error")
	}
	if env.m.IsEnabled() || env.m.store.enabled() {
		t.Fatalf("a failed start left the server marked on")
	}
}

func TestAllowed(t *testing.T) {
	env := newEnv(t)
	tests := []struct {
		groups []string
		user   string
		want   bool
	}{
		{nil, "alice", true}, //Admins always
		{nil, "bob", false},
		{[]string{"family"}, "bob", true},
		{[]string{"family"}, "carol", false},
		{[]string{"family"}, "nobody", false},
	}
	for _, tt := range tests {
		env.setGroups(t, tt.groups...)
		if got := env.m.Allowed(tt.user); got != tt.want {
			t.Errorf("groups %v: Allowed(%s) = %v, want %v", tt.groups, tt.user, got, tt.want)
		}
	}
}

func TestConfigOnlyKeepsKnownGroupsAndValidPorts(t *testing.T) {
	env := newEnv(t)
	env.setGroups(t, "family", "made-up", "family")
	if got := env.m.store.settings().Groups; len(got) != 1 || got[0] != "family" {
		t.Errorf("groups = %v, want [family]", got)
	}
	for _, port := range []string{"0", "70000", "abc"} {
		_, result, _ := env.call(t, env.m.HandleConfig, "alice", url.Values{"port": {port}})
		if errorOf(result) == "" {
			t.Errorf("port %s was accepted", port)
		}
	}
	env.call(t, env.m.HandleConfig, "alice", url.Values{"port": {"22001"}, "relays": {"false"}})
	settings := env.m.store.settings()
	if settings.Port != 22001 || settings.Relays || !settings.GlobalDiscovery {
		t.Errorf("settings = %+v, want port 22001, relays off, discovery untouched", settings)
	}
}

func TestDeviceAdd(t *testing.T) {
	env := newEnv(t)
	env.setGroups(t, "family")
	env.m.ServerToggle(true)

	if e := env.addDevice(t, "carol", devA1); e == "" {
		t.Errorf("a user outside the allowed groups added a device")
	}
	if e := env.addDevice(t, "bob", "not-an-id"); e == "" {
		t.Errorf("a bad device ID was accepted")
	}
	if e := env.addDevice(t, "bob", serverID); e == "" {
		t.Errorf("the server's own ID was accepted")
	}
	env.password = false
	env.addDevice(t, "bob", devB1)
	if _, found := env.m.store.device(devB1); found {
		t.Errorf("a device was added without the login password")
	}
	env.password = true
	if e := env.addDevice(t, "bob", strings.ToLower(devB1)); e != "" {
		t.Fatalf("add: %s", e)
	}
	d, found := env.m.store.device(devB1)
	if !found || d.Owner != "bob" || d.Name != "Phone" {
		t.Fatalf("device = %+v, found %v", d, found)
	}
	if e := env.addDevice(t, "bob", devB1); e == "" {
		t.Errorf("the same device was added twice")
	}
	if e := env.addDevice(t, "alice", devB1); !strings.Contains(e, "another account") {
		t.Errorf("another user took over a linked device: %q", e)
	}
	if _, ok := findDevice(env.eng.lastPlan(), devB1); !ok {
		t.Errorf("the new device was not applied to Syncthing")
	}
}

func TestFolderAdd(t *testing.T) {
	env := newEnv(t)
	env.setGroups(t, "family")
	env.m.ServerToggle(true)
	env.addDevice(t, "alice", devA1)
	env.addDevice(t, "bob", devB1)

	tests := []struct {
		name    string
		user    string
		form    url.Values
		wantErr string
	}{
		{"no path", "bob", url.Values{"mode": {ModeBackup}}, "Pick a folder"},
		{"network drive", "bob", url.Values{"path": {"ftp:/x"}}, "local disk"},
		{"bad mode", "bob", url.Values{"path": {"user:/x"}, "mode": {"weird"}}, "mode"},
		{"too many days", "bob", url.Values{"path": {"user:/x"}, "versiondays": {"99999"}}, "days"},
		{"another user's device", "bob", url.Values{"path": {"user:/x"}, "devices": {`["` + devA1 + `"]`}}, "your own devices"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, e := env.addFolder(t, tt.user, tt.form); !strings.Contains(e, tt.wantErr) {
				t.Errorf("error = %q, want it to mention %q", e, tt.wantErr)
			}
		})
	}

	id, e := env.addFolder(t, "bob", url.Values{"path": {"user:/Phone/Camera"}, "devices": {`["` + devB1 + `"]`}})
	if e != "" {
		t.Fatalf("add: %s", e)
	}
	f, _ := env.m.store.folder(id)
	if f.Owner != "bob" || f.Label != "Camera" || f.Mode != ModeBackup || len(f.Devices) != 1 {
		t.Errorf("folder = %+v, want bob's Camera backup shared with one device", f)
	}
	pf, ok := findFolder(env.eng.lastPlan(), id)
	if !ok || pf.Paused || pf.Path != filepath.Join(env.root, "bob", "Phone", "Camera") {
		t.Errorf("plan folder = %+v (in plan %v)", pf, ok)
	}

	//Inside a folder already synced
	if _, e := env.addFolder(t, "bob", url.Values{"path": {"user:/Phone/Camera/2026"}}); !strings.Contains(e, "already syncs") {
		t.Errorf("an overlapping folder was accepted: %q", e)
	}
	//An offered ID another account holds
	if _, e := env.addFolder(t, "alice", url.Values{"path": {"user:/Elsewhere"}, "id": {id}}); !strings.Contains(e, "already has a folder") {
		t.Errorf("a taken folder ID was accepted: %q", e)
	}
	//An offered ID of its own
	if got, e := env.addFolder(t, "alice", url.Values{"path": {"user:/Notes"}, "id": {"abcde-fghij"}, "label": {"Notes"}}); e != "" || got != "abcde-fghij" {
		t.Errorf("offered folder: id %q, error %q", got, e)
	}
}

func TestStatusShowsOnlyOwnThingsAndFiltersOffers(t *testing.T) {
	env := newEnv(t)
	env.setGroups(t, "family")
	env.m.ServerToggle(true)
	env.addDevice(t, "alice", devA1)
	env.addDevice(t, "alice", devA2)
	env.addDevice(t, "bob", devB1)
	shared, _ := env.addFolder(t, "alice", url.Values{"path": {"user:/Shared"}, "devices": {`["` + devA1 + `"]`}})
	bobs, _ := env.addFolder(t, "bob", url.Values{"path": {"user:/Bob"}})

	now := time.Now()
	env.eng.offers[devA1] = []Offer{{FolderID: shared, Time: now}, {FolderID: "new-one", Label: "New", Time: now}, {FolderID: "nope", Time: now}}
	env.eng.offers[devA2] = []Offer{{FolderID: shared, Time: now}, {FolderID: bobs, Time: now}}
	env.call(t, env.m.HandleOfferIgnore, "alice", url.Values{"id": {devA1}, "folder": {"nope"}})

	_, result, body := env.call(t, env.m.HandleStatus, "alice", nil)
	if e := errorOf(result); e != "" {
		t.Fatalf("status: %s", e)
	}
	var status UserStatus
	if err := json.Unmarshal([]byte(body), &status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !status.Allowed || status.DeviceID != serverID || len(status.Devices) != 2 || len(status.Folders) != 1 {
		t.Fatalf("status = %+v", status)
	}
	got := map[string]string{}
	for _, o := range status.Offers {
		got[o.DeviceID+"/"+o.FolderID] = o.Existing
	}
	want := map[string]string{
		devA1 + "/new-one":   "",     //A new folder
		devA2 + "/" + shared: "mine", //Already synced with the other phone
		devA2 + "/" + bobs:   "taken",
	}
	if len(got) != len(want) {
		t.Errorf("offers = %v, want %v", got, want)
	}
	for k, v := range want {
		if g, ok := got[k]; !ok || g != v {
			t.Errorf("offer %s = %q (shown %v), want %q", k, g, ok, v)
		}
	}

	//carol may not use it and sees nothing
	_, _, body = env.call(t, env.m.HandleStatus, "carol", nil)
	json.Unmarshal([]byte(body), &status)
	if status.Allowed || len(status.Devices) != 0 || status.DeviceID != "" {
		t.Errorf("a user without access sees %+v", status)
	}
}

func TestRemovingADeviceTakesItOutOfFolders(t *testing.T) {
	env := newEnv(t)
	env.m.ServerToggle(true)
	env.addDevice(t, "alice", devA1)
	id, _ := env.addFolder(t, "alice", url.Values{"path": {"user:/A"}, "devices": {`["` + devA1 + `"]`}})
	if _, result, _ := env.call(t, env.m.HandleDeviceRemove, "bob", url.Values{"id": {devA1}}); errorOf(result) == "" {
		t.Errorf("another user removed alice's device")
	}
	env.call(t, env.m.HandleDeviceRemove, "alice", url.Values{"id": {devA1}})
	if _, found := env.m.store.device(devA1); found {
		t.Fatalf("device still recorded")
	}
	f, _ := env.m.store.folder(id)
	if len(f.Devices) != 0 {
		t.Errorf("folder still shared with the removed device: %v", f.Devices)
	}
}

func TestDeletedAccountsAreForgotten(t *testing.T) {
	env := newEnv(t)
	env.m.ServerToggle(true)
	env.m.store.putDevice(Device{ID: devB1, Owner: "dave"})
	env.m.store.putFolder(Folder{ID: "fd", Owner: "dave", Path: "user:/D"})
	env.m.changed()
	if _, found := env.m.store.device(devB1); found {
		t.Errorf("the device of a deleted account is still recorded")
	}
	if _, found := env.m.store.folder("fd"); found {
		t.Errorf("the folder of a deleted account is still recorded")
	}
}

func TestQuotaWatch(t *testing.T) {
	env := newEnv(t)
	env.m.ServerToggle(true)
	m := env.m
	q := &fakeQuota{used: 50, total: 100}
	env.eng.bytes["f"] = 10

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.quotaFullLocked("alice", q, []string{"f"}) {
		t.Fatalf("full at the first look")
	}
	//The folder grew by 60: the estimate is full, but it was measured just now
	env.eng.bytes["f"] = 70
	if !m.quotaFullLocked("alice", q, []string{"f"}) {
		t.Fatalf("growth past the quota was not noticed")
	}
	if q.recounts != 0 {
		t.Fatalf("measured again too soon")
	}
	//Later, a measurement finds space after all (the File Manager deleted files)
	w := m.quotas["alice"]
	w.recounted = time.Now().Add(-quotaRecountFull - time.Second)
	m.quotas["alice"] = w
	q.afterRecount = 60
	if m.quotaFullLocked("alice", q, []string{"f"}) {
		t.Fatalf("still full after a measurement found space")
	}
	if q.recounts != 1 {
		t.Fatalf("recounts = %d, want 1", q.recounts)
	}
	//No limit
	if m.quotaFullLocked("bob", &fakeQuota{used: 500, total: -1}, []string{"f"}) {
		t.Fatalf("an unlimited quota was full")
	}
}

func TestNewFolderIDLooksLikeSyncthings(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		id := newFolderID()
		if len(id) != 11 || id[5] != '-' || !validFolderID(id) {
			t.Fatalf("bad id %q", id)
		}
		if seen[id] {
			t.Fatalf("repeated id %q", id)
		}
		seen[id] = true
	}
	for _, bad := range []string{"", "a/b", "a\\b", "a\nb", strings.Repeat("x", maxIDLength+1)} {
		if validFolderID(bad) {
			t.Errorf("validFolderID(%q) = true", bad)
		}
	}
}
