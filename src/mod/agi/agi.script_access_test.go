package agi

import (
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/permission"
	user "imuslab.com/arozos/mod/user"
)

// A WebApp whose modules an admin switched off runs no backend script, not
// even for an admin, who may otherwise use every module.
func TestUserCanRunScript(t *testing.T) {
	admin := &user.User{Username: "root", PermissionGroup: []*permission.PermissionGroup{{Name: "administrator", IsAdmin: true}}}
	disabled := func(folder string) bool { return folder == "web/Setup Wizard" }

	tests := []struct {
		name     string
		disabled func(string) bool
		script   string
		want     bool
	}{
		{name: "enabled app", disabled: disabled, script: "Photo/backend/list.agi", want: true},
		{name: "disabled app", disabled: disabled, script: "Setup Wizard/backend/state.agi", want: false},
		{name: "no disabled check wired", disabled: nil, script: "Setup Wizard/backend/state.agi", want: true},
		{name: "other folder of the same name prefix", disabled: disabled, script: "Setup Wizard Extra/x.agi", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := &Gateway{Option: &AgiSysInfo{ScriptFolderDisabled: tt.disabled}}
			got := g.userCanRunScript(admin, filepath.Join("./web", tt.script), "./web")
			if got != tt.want {
				t.Errorf("userCanRunScript(%q) = %v, want %v", tt.script, got, tt.want)
			}
		})
	}
}
