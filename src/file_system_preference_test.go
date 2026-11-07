package main

import "testing"

/*
A user who never picked a theme must get the backend's default. Pages read
the preference as "dark unless whiteTheme", so an empty reply turns them dark
while the desktop itself stays light.
*/
func TestUserPreferenceOrDefault(t *testing.T) {
	tests := []struct {
		name   string
		key    string
		stored string
		want   string
	}{
		{"unset theme gets the light default", "file_explorer/theme", "", "whiteTheme"},
		{"stored dark theme is kept", "file_explorer/theme", "darkTheme", "darkTheme"},
		{"stored white theme is kept", "file_explorer/theme", "whiteTheme", "whiteTheme"},
		{"unset key without a default stays empty", "file_explorer/oprbar", "", ""},
		{"stored key without a default is kept", "file_explorer/oprbar", "false", "false"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := system_fs_userPreferenceOrDefault(tt.key, tt.stored); got != tt.want {
				t.Errorf("system_fs_userPreferenceOrDefault(%q, %q) = %q, want %q", tt.key, tt.stored, got, tt.want)
			}
		})
	}
}
