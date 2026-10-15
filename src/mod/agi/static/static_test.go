package static

import "testing"

// RunCleanup is the guarded entry point libraries use to register a teardown
// closure. It must forward to RegisterCleanup when one is present and stay
// silent — never panic — in every configuration where one is not, because
// payloads built outside a script execution context (init.agi injection, tests)
// legitimately carry no cleanup registry.
func TestRunCleanup(t *testing.T) {
	tests := []struct {
		name        string
		nilPayload  bool
		hasRegistry bool
		nilCleanup  bool
		wantCalls   int
	}{
		{name: "forwards to registry", hasRegistry: true, wantCalls: 1},
		{name: "no registry is a no-op", hasRegistry: false, wantCalls: 0},
		{name: "nil cleanup is not registered", hasRegistry: true, nilCleanup: true, wantCalls: 0},
		{name: "nil payload is a no-op", nilPayload: true, wantCalls: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			registered := 0

			var payload *AgiLibInjectionPayload
			if !tt.nilPayload {
				payload = &AgiLibInjectionPayload{}
				if tt.hasRegistry {
					payload.RegisterCleanup = func(func()) { registered++ }
				}
			}

			cleanup := func() {}
			if tt.nilCleanup {
				cleanup = nil
			}

			defer func() {
				if caught := recover(); caught != nil {
					t.Fatalf("RunCleanup panicked: %v", caught)
				}
			}()
			payload.RunCleanup(cleanup)

			if registered != tt.wantCalls {
				t.Errorf("expected %d registration(s), got %d", tt.wantCalls, registered)
			}
		})
	}
}

// The closure handed to RunCleanup must reach the registry unchanged, so the
// runtime executes exactly the teardown the library intended.
func TestRunCleanup_PassesClosureThrough(t *testing.T) {
	var captured func()
	payload := &AgiLibInjectionPayload{
		RegisterCleanup: func(cleanup func()) { captured = cleanup },
	}

	ran := false
	payload.RunCleanup(func() { ran = true })

	if captured == nil {
		t.Fatal("expected the cleanup closure to reach the registry")
	}
	captured()
	if !ran {
		t.Error("the registered closure was not the one passed to RunCleanup")
	}
}

// A script is reachable through the module named after its folder or through
// any module registered from that folder, so apps whose module names differ from
// their folder (Office -> Docs / Sheets / Slides) still reach their own backend.
func TestCanAccessScriptFolder(t *testing.T) {
	officeModules := func(folder string) []string {
		if folder == "web/Office" {
			return []string{"Docs", "Sheets", "Slides"}
		}
		return nil
	}

	tests := []struct {
		name            string
		allowed         []string
		scriptFile      string
		scriptScope     string
		modulesInFolder func(string) []string
		want            bool
	}{
		{name: "module registered from the folder", allowed: []string{"Slides"}, scriptFile: "web/Office/common/backend/document.agi", scriptScope: "web", modulesInFolder: officeModules, want: true},
		{name: "scope with leading dot and trailing slash", allowed: []string{"Docs"}, scriptFile: "./web/Office/common/backend/document.agi", scriptScope: "./web/", modulesInFolder: officeModules, want: true},
		{name: "module named after the folder", allowed: []string{"Photo"}, scriptFile: "web/Photo/backend/list.agi", scriptScope: "web", modulesInFolder: officeModules, want: true},
		{name: "no module of the folder allowed", allowed: []string{"Photo"}, scriptFile: "web/Office/common/backend/document.agi", scriptScope: "web", modulesInFolder: officeModules, want: false},
		{name: "modules of another folder do not count", allowed: []string{"Slides"}, scriptFile: "web/Mail/backend/send.agi", scriptScope: "web", modulesInFolder: officeModules, want: false},
		{name: "same folder name in another scope", allowed: []string{"Slides"}, scriptFile: "subservice/Office/run.agi", scriptScope: "subservice", modulesInFolder: officeModules, want: false},
		{name: "nil resolver falls back to folder name", allowed: []string{"Slides"}, scriptFile: "web/Office/common/backend/document.agi", scriptScope: "web", modulesInFolder: nil, want: false},
		{name: "script outside the scope", allowed: []string{""}, scriptFile: "system/ao.agi", scriptScope: "web", modulesInFolder: officeModules, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hasModuleAccess := func(moduleName string) bool {
				for _, allowed := range tt.allowed {
					if allowed == moduleName {
						return true
					}
				}
				return false
			}

			got := canAccessScriptFolder(hasModuleAccess, tt.scriptFile, tt.scriptScope, tt.modulesInFolder)
			if got != tt.want {
				t.Errorf("canAccessScriptFolder(%q, %q) = %v, want %v", tt.scriptFile, tt.scriptScope, got, tt.want)
			}
		})
	}
}

func TestScriptSourceFolder(t *testing.T) {
	tests := []struct {
		scriptFile  string
		scriptScope string
		want        string
	}{
		{scriptFile: "web/Office/init.agi", scriptScope: "./web/", want: "web/Office"},
		{scriptFile: "./web/Label Maker/backend/print.agi", scriptScope: "web", want: "web/Label Maker"},
		{scriptFile: "subservice/demo/run.agi", scriptScope: "subservice", want: "subservice/demo"},
		{scriptFile: "system/ao.agi", scriptScope: "web", want: ""},
	}

	for _, tt := range tests {
		if got := ScriptSourceFolder(tt.scriptFile, tt.scriptScope); got != tt.want {
			t.Errorf("ScriptSourceFolder(%q, %q) = %q, want %q", tt.scriptFile, tt.scriptScope, got, tt.want)
		}
	}
}
