package modules

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"testing"
)

// memStore is a StateStore kept in memory
type memStore struct {
	rows      map[string][]byte
	failWrite bool
}

func newMemStore() *memStore {
	return &memStore{rows: map[string][]byte{}}
}

func (s *memStore) Write(table string, key string, value interface{}) error {
	if s.failWrite {
		return errors.New("disk full")
	}
	js, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s.rows[table+"|"+key] = js
	return nil
}

func (s *memStore) Delete(table string, key string) error {
	delete(s.rows, table+"|"+key)
	return nil
}

func (s *memStore) ListTable(table string) ([][][]byte, error) {
	keys := []string{}
	for k := range s.rows {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	result := [][][]byte{}
	for _, k := range keys {
		if strings.HasPrefix(k, table+"|") {
			result = append(result, [][]byte{[]byte(strings.TrimPrefix(k, table+"|")), s.rows[k]})
		}
	}
	return result, nil
}

func newDisableTestHandler(t *testing.T, store *memStore) *ModuleHandler {
	t.Helper()
	mh := &ModuleHandler{LoadedModule: []*ModuleInfo{}}
	if store != nil {
		if err := mh.LoadDisabledModules(store); err != nil {
			t.Fatalf("LoadDisabledModules: %v", err)
		}
	}
	for _, reg := range []struct{ folder, js string }{
		{"web/Photo", `{"Name":"Photo","Group":"Media","StartDir":"Photo/index.html"}`},
		{"web/Office", `{"Name":"Docs","Group":"Office"}`},
		{"web/Office", `{"Name":"Sheets","Group":"Office"}`},
		{"web/Setup Wizard", `{"Name":"Setup Wizard","Group":"Interface Module"}`},
		{"web/SystemAO", `{"Name":"System Setting","Group":"System Settings"}`},
		{"web/Tools", `{"Name":"Task Manager","Group":"System Tools"}`},
	} {
		if err := mh.RegisterModuleFromAGI(reg.folder, reg.js); err != nil {
			t.Fatalf("RegisterModuleFromAGI: %v", err)
		}
	}
	mh.RegisterModule(ModuleInfo{Name: "Desktop", Group: "Interface Module"})
	return mh
}

func moduleNames(list []*ModuleInfo) string {
	names := []string{}
	for _, m := range list {
		names = append(names, m.Name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func TestSetModuleEnabled(t *testing.T) {
	tests := []struct {
		name         string
		module       string
		enabled      bool
		usedBy       []string
		wantErr      string
		wantDisabled string
	}{
		{name: "disable a normal app", module: "Photo", wantDisabled: "Photo"},
		{name: "disable an interface module nobody boots into", module: "Setup Wizard", wantDisabled: "Setup Wizard"},
		{name: "system settings stay on", module: "System Setting", wantErr: "System modules"},
		{name: "system tools stay on", module: "Task Manager", wantErr: "System modules"},
		{name: "desktop stays on", module: "Desktop", wantErr: "System modules"},
		{name: "interface module still in use", module: "Setup Wizard", usedBy: []string{"administrator"}, wantErr: "administrator group opens this module"},
		{name: "unknown module", module: "Nope", wantErr: "not exists"},
		{name: "enabling an enabled module is a no-op", module: "Photo", enabled: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mh := newDisableTestHandler(t, newMemStore())
			mh.InterfaceModuleUsers = func(name string) []string {
				if name == tt.module {
					return tt.usedBy
				}
				return nil
			}
			err := mh.SetModuleEnabled(tt.module, tt.enabled)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("SetModuleEnabled(%q) error = %v, want %q", tt.module, err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("SetModuleEnabled(%q) unexpected error: %v", tt.module, err)
			}
			if got := moduleNames(mh.DisabledModule); got != tt.wantDisabled {
				t.Errorf("DisabledModule = %q, want %q", got, tt.wantDisabled)
			}
			if tt.wantDisabled != "" && mh.GetModuleInfoByID(tt.module) != nil {
				t.Errorf("GetModuleInfoByID(%q) still finds a disabled module", tt.module)
			}
		})
	}
}

func TestDisabledModuleSurvivesRestart(t *testing.T) {
	store := newMemStore()
	mh := newDisableTestHandler(t, store)
	if err := mh.SetModuleEnabled("Photo", false); err != nil {
		t.Fatalf("disable Photo: %v", err)
	}

	//A fresh handler reading the same store registers Photo as disabled at boot
	restarted := newDisableTestHandler(t, store)
	if restarted.GetModuleInfoByID("Photo") != nil {
		t.Fatal("Photo is loaded again after a restart")
	}
	if !restarted.IsModuleDisabled("photo") {
		t.Error("IsModuleDisabled should ignore case")
	}
	if got := moduleNames(restarted.DisabledModule); got != "Photo" {
		t.Errorf("DisabledModule after restart = %q, want Photo", got)
	}

	if err := restarted.SetModuleEnabled("Photo", true); err != nil {
		t.Fatalf("enable Photo: %v", err)
	}
	if restarted.GetModuleInfoByID("Photo") == nil {
		t.Fatal("Photo is not loaded after enabling it")
	}
	if len(store.rows) != 0 {
		t.Errorf("store still holds %d rows after enabling", len(store.rows))
	}

	//A protected module never registers as disabled, even with a stale row
	store.rows["module|disabled/System Setting"] = []byte("true")
	again := newDisableTestHandler(t, store)
	if again.GetModuleInfoByID("System Setting") == nil {
		t.Error("System Setting was kept off by a stale row")
	}
}

func TestSetModuleEnabledStoreFailure(t *testing.T) {
	store := newMemStore()
	mh := newDisableTestHandler(t, store)
	store.failWrite = true
	if err := mh.SetModuleEnabled("Photo", false); err == nil {
		t.Fatal("expected the store error to be returned")
	}
	if mh.GetModuleInfoByID("Photo") == nil || mh.IsModuleDisabled("Photo") {
		t.Error("a module that could not be saved as disabled must stay on")
	}
}

func TestIsSourceFolderDisabled(t *testing.T) {
	mh := newDisableTestHandler(t, newMemStore())
	steps := []struct {
		module  string
		enabled bool
		folder  string
		want    bool
	}{
		{module: "Docs", folder: "web/Office", want: false},  //Sheets is still on
		{module: "Sheets", folder: "web/Office", want: true}, //now all off
		{module: "Sheets", enabled: true, folder: "web/office", want: false},
		{module: "Setup Wizard", folder: "./web/Setup Wizard/", want: true},
		{module: "Photo", folder: "web/SystemAO", want: false}, //folder without disabled modules
	}
	for _, step := range steps {
		if err := mh.SetModuleEnabled(step.module, step.enabled); err != nil {
			t.Fatalf("SetModuleEnabled(%q, %v): %v", step.module, step.enabled, err)
		}
		if got := mh.IsSourceFolderDisabled(step.folder); got != step.want {
			t.Errorf("after SetModuleEnabled(%q, %v): IsSourceFolderDisabled(%q) = %v, want %v",
				step.module, step.enabled, step.folder, got, step.want)
		}
	}
	if mh.IsSourceFolderDisabled("") {
		t.Error("an empty folder is never disabled")
	}
}

func TestUninstallForgetsDisabledModule(t *testing.T) {
	store := newMemStore()
	mh := newDisableTestHandler(t, store)
	if err := mh.SetModuleEnabled("Photo", false); err != nil {
		t.Fatalf("disable Photo: %v", err)
	}
	mh.forgetDisabled("Photo")
	if mh.IsModuleDisabled("Photo") || len(mh.DisabledModule) != 0 || len(store.rows) != 0 {
		t.Errorf("forgetDisabled left state behind: disabled=%v list=%q rows=%d",
			mh.IsModuleDisabled("Photo"), moduleNames(mh.DisabledModule), len(store.rows))
	}
	if err := mh.UninstallModule("NoSuchModule"); err == nil {
		t.Error("UninstallModule of an unknown module should fail instead of panicking")
	}
}

func TestHandleSetModuleEnabled(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		form     url.Values
		wantBody string
	}{
		{name: "GET refused", method: http.MethodGet, wantBody: "must be a POST"},
		{name: "missing module", method: http.MethodPost, form: url.Values{"enabled": {"false"}}, wantBody: "Invalid module name"},
		{name: "missing state", method: http.MethodPost, form: url.Values{"module": {"Photo"}}, wantBody: "Invalid enabled state"},
		{name: "protected module", method: http.MethodPost, form: url.Values{"module": {"Desktop"}, "enabled": {"false"}}, wantBody: "cannot be disabled"},
		{name: "disable", method: http.MethodPost, form: url.Values{"module": {"Photo"}, "enabled": {"false"}}, wantBody: "OK"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mh := newDisableTestHandler(t, newMemStore())
			req := httptest.NewRequest(tt.method, "/system/modules/setEnabled", strings.NewReader(tt.form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			rec := httptest.NewRecorder()
			mh.HandleSetModuleEnabled(rec, req)
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("body = %q, want it to contain %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}
