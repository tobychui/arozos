package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	db "imuslab.com/arozos/mod/database"
	module "imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/permission"
)

// newSetupWizardTestEnv points the globals the wizard uses at a fresh
// installation: the administrator group boots into the wizard and the
// Desktop, Drive, Setup Wizard and Photo modules are loaded.
func newSetupWizardTestEnv(t *testing.T, withWizard bool) {
	t.Helper()
	oldDB, oldPerm, oldMod := sysdb, permissionHandler, moduleHandler
	t.Cleanup(func() { sysdb, permissionHandler, moduleHandler = oldDB, oldPerm, oldMod })

	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "sys.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(database.Close)
	for _, table := range []string{"module", setupWizardTable} {
		if err := database.NewTable(table); err != nil {
			t.Fatalf("NewTable(%s): %v", table, err)
		}
	}
	sysdb = database

	ph, err := permission.NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	ph.LoadPermissionGroupsFromDatabase()
	ph.NewPermissionGroup("family", false, 0, []string{}, "Desktop")
	permissionHandler = ph

	mh := module.NewModuleHandler(nil, t.TempDir())
	if err := mh.LoadDisabledModules(database); err != nil {
		t.Fatalf("LoadDisabledModules: %v", err)
	}
	mh.InterfaceModuleUsers = groupsBootingInto
	mh.RegisterModule(module.ModuleInfo{Name: "Desktop", Group: interfaceModGroup})
	mh.RegisterModuleFromAGI("web/Drive", `{"Name":"Drive","Group":"Interface Module","StartDir":"Drive/index.html"}`)
	mh.RegisterModuleFromAGI("web/Photo", `{"Name":"Photo","Group":"Media","StartDir":"Photo/index.html"}`)
	if withWizard {
		mh.RegisterModuleFromAGI("web/Setup Wizard", `{"Name":"Setup Wizard","Group":"Interface Module","StartDir":"Setup Wizard/index.html"}`)
	}
	moduleHandler = mh
}

func adminInterface(t *testing.T) string {
	t.Helper()
	return permissionHandler.GetPermissionGroupByName("administrator").DefaultInterfaceModule
}

func TestSetupInterfaces(t *testing.T) {
	newSetupWizardTestEnv(t, true)
	names := []string{}
	for _, iface := range setupInterfaces() {
		names = append(names, iface.Name)
	}
	if got := strings.Join(names, ","); got != "Desktop,Drive" {
		t.Errorf("setupInterfaces = %s, want Desktop,Drive (desktop first, no wizard, no apps)", got)
	}
}

func TestFinishSetupWizard(t *testing.T) {
	tests := []struct {
		name       string
		withWizard bool
		target     string
		wantErr    string
	}{
		{name: "drive", withWizard: true, target: "Drive"},
		{name: "skip goes to the desktop", withWizard: true, target: "Desktop"},
		{name: "an app is not an interface", withWizard: true, target: "Photo", wantErr: "Not an interface module"},
		{name: "the wizard itself", withWizard: true, target: permission.SetupWizardModule, wantErr: "Not an interface module"},
		{name: "wizard folder removed", withWizard: false, target: "Desktop"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			newSetupWizardTestEnv(t, tt.withWizard)
			if !setupWizardActive() {
				t.Fatal("a fresh installation should boot into the wizard")
			}
			sysdb.Write(setupWizardTable, setupProgressKey, `{"step":3}`)

			err := finishSetupWizard(tt.target)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("finishSetupWizard(%q) error = %v, want %q", tt.target, err, tt.wantErr)
				}
				if adminInterface(t) != permission.SetupWizardModule {
					t.Error("a refused finish changed the admin interface")
				}
				return
			}
			if err != nil {
				t.Fatalf("finishSetupWizard(%q): %v", tt.target, err)
			}
			if got := adminInterface(t); got != tt.target {
				t.Errorf("admin interface = %q, want %q", got, tt.target)
			}
			if got := permissionHandler.GetPermissionGroupByName("family").DefaultInterfaceModule; got != "Desktop" {
				t.Errorf("other groups must keep their interface, family = %q", got)
			}
			if setupWizardActive() {
				t.Error("the wizard is still active after finishing")
			}
			if moduleHandler.GetModuleInfoByID(permission.SetupWizardModule) != nil {
				t.Error("the wizard module is still enabled")
			}
			if sysdb.KeyExists(setupWizardTable, setupProgressKey) {
				t.Error("the saved progress was not cleared")
			}
		})
	}
}

// An admin who switches the wizard on again and runs it gets the new choice
func TestFinishSetupWizardRerun(t *testing.T) {
	newSetupWizardTestEnv(t, true)
	if err := finishSetupWizard("Drive"); err != nil {
		t.Fatalf("first finish: %v", err)
	}
	if err := moduleHandler.SetModuleEnabled(permission.SetupWizardModule, true); err != nil {
		t.Fatalf("enable the wizard again: %v", err)
	}
	if err := finishSetupWizard("Desktop"); err != nil {
		t.Fatalf("second finish: %v", err)
	}
	if got := adminInterface(t); got != "Desktop" {
		t.Errorf("admin interface = %q, want Desktop", got)
	}
	if !moduleHandler.IsModuleDisabled(permission.SetupWizardModule) {
		t.Error("the wizard should be disabled again")
	}
}

// The wizard cannot be switched off while a group still boots into it
func TestSetupWizardCannotBeDisabledWhileInUse(t *testing.T) {
	newSetupWizardTestEnv(t, true)
	err := moduleHandler.SetModuleEnabled(permission.SetupWizardModule, false)
	if err == nil || !strings.Contains(err.Error(), "administrator") {
		t.Fatalf("SetModuleEnabled error = %v, want it to name the administrator group", err)
	}
}

func TestServeDisabledModuleFolder(t *testing.T) {
	newSetupWizardTestEnv(t, true)
	if err := finishSetupWizard("Desktop"); err != nil {
		t.Fatalf("finishSetupWizard: %v", err)
	}
	if err := moduleHandler.SetModuleEnabled("Photo", false); err != nil {
		t.Fatalf("disable Photo: %v", err)
	}

	tests := []struct {
		path       string
		wantServed bool
		wantStatus int
		wantLoc    string
	}{
		{path: "/Setup%20Wizard/index.html", wantServed: true, wantStatus: http.StatusTemporaryRedirect, wantLoc: "/"},
		{path: "/Photo/index.html", wantServed: true, wantStatus: http.StatusNotFound},
		{path: "/Photo/img/icon.png", wantServed: false}, //icons stay visible in the module manager
		{path: "/Setup%20Wizard/img/module_icon.svg", wantServed: false},
		{path: "/Drive/index.html", wantServed: false},
		{path: "/desktop.html", wantServed: false},
		{path: "/", wantServed: false},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			u, _ := url.Parse(tt.path)
			req := httptest.NewRequest(http.MethodGet, u.String(), nil)
			rec := httptest.NewRecorder()
			served := serveDisabledModuleFolder(rec, req)
			if served != tt.wantServed {
				t.Fatalf("served = %v, want %v", served, tt.wantServed)
			}
			if !served {
				return
			}
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantLoc != "" && rec.Header().Get("Location") != tt.wantLoc {
				t.Errorf("Location = %q, want %q", rec.Header().Get("Location"), tt.wantLoc)
			}
		})
	}
}

func TestHandleSetupProgress(t *testing.T) {
	newSetupWizardTestEnv(t, true)
	tests := []struct {
		name     string
		form     url.Values
		wantBody string
		wantSave string
	}{
		{name: "not json", form: url.Values{"progress": {"{step:"}}, wantBody: "Invalid progress"},
		{name: "too large", form: url.Values{"progress": {`"` + strings.Repeat("a", setupProgressLimit) + `"`}}, wantBody: "Invalid progress"},
		{name: "saved", form: url.Values{"progress": {`{"step":2,"interface":"Drive"}`}}, wantBody: "OK", wantSave: `{"step":2,"interface":"Drive"}`},
		{name: "cleared", form: url.Values{"clear": {"true"}}, wantBody: "OK"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/system/setup/progress", strings.NewReader(tt.form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			rec := httptest.NewRecorder()
			handleSetupProgress(rec, req)
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
			saved := ""
			sysdb.Read(setupWizardTable, setupProgressKey, &saved)
			if tt.wantSave != "" && saved != tt.wantSave {
				t.Errorf("saved = %q, want %q", saved, tt.wantSave)
			}
			if tt.name == "cleared" && sysdb.KeyExists(setupWizardTable, setupProgressKey) {
				t.Error("progress still saved after clear")
			}
		})
	}
}
