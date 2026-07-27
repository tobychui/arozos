package prefs

import (
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// newTestManager spins up a throwaway database backed preference manager
func newTestManager(t *testing.T) *Manager {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("unable to create test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	manager, err := NewManager(db, "desktop")
	if err != nil {
		t.Fatalf("unable to create preference manager: %v", err)
	}
	return manager
}

func TestNewManagerRejectsNilDatabase(t *testing.T) {
	if _, err := NewManager(nil, "desktop"); err == nil {
		t.Error("NewManager(nil) = nil error, want an error")
	}
}

func TestSetAndGetPreference(t *testing.T) {
	manager := newTestManager(t)

	tests := []struct {
		name           string
		username       string
		preferenceType string
		value          string
	}{
		{"simple value", "alice", "showDesktopIcons", "true"},
		{"json value", "alice", "listview", `{"sort":"name"}`},
		{"value with slashes", "alice", "wallpaper", "user:/Photo/bg.jpg"},
		{"same key other user", "bob", "showDesktopIcons", "false"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := manager.SetPreference(tt.username, tt.preferenceType, tt.value); err != nil {
				t.Fatalf("SetPreference() returned error: %v", err)
			}
			if got := manager.GetPreference(tt.username, tt.preferenceType); got != tt.value {
				t.Errorf("GetPreference() = %q, want %q", got, tt.value)
			}
		})
	}

	//Preferences must be scoped per user
	if got := manager.GetPreference("alice", "showDesktopIcons"); got != "true" {
		t.Errorf("alice's preference = %q, want %q unaffected by bob", got, "true")
	}
}

func TestGetPreferenceUnset(t *testing.T) {
	manager := newTestManager(t)

	if got := manager.GetPreference("alice", "neverSet"); got != "" {
		t.Errorf("GetPreference() = %q for an unset key, want an empty string", got)
	}
}

func TestRemovePreference(t *testing.T) {
	manager := newTestManager(t)

	if err := manager.SetPreference("alice", "showDesktopIcons", "true"); err != nil {
		t.Fatalf("SetPreference() returned error: %v", err)
	}
	if err := manager.RemovePreference("alice", "showDesktopIcons"); err != nil {
		t.Fatalf("RemovePreference() returned error: %v", err)
	}
	if got := manager.GetPreference("alice", "showDesktopIcons"); got != "" {
		t.Errorf("GetPreference() = %q after removal, want an empty string", got)
	}
}

func TestTheme(t *testing.T) {
	manager := newTestManager(t)

	tests := []struct {
		name     string
		username string
		set      string
		want     string
	}{
		{"never set falls back to default", "alice", "", DefaultTheme},
		{"set theme is returned", "bob", "winxp", "winxp"},
		{"theme with spaces", "carol", "my custom theme", "my custom theme"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.set != "" {
				if err := manager.SetTheme(tt.username, tt.set); err != nil {
					t.Fatalf("SetTheme() returned error: %v", err)
				}
			}
			if got := manager.GetTheme(tt.username); got != tt.want {
				t.Errorf("GetTheme() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestThemeOverwrites(t *testing.T) {
	manager := newTestManager(t)

	if err := manager.SetTheme("alice", "winxp"); err != nil {
		t.Fatalf("SetTheme() returned error: %v", err)
	}
	if err := manager.SetTheme("alice", "macos"); err != nil {
		t.Fatalf("SetTheme() returned error: %v", err)
	}
	if got := manager.GetTheme("alice"); got != "macos" {
		t.Errorf("GetTheme() = %q, want the overwritten %q", got, "macos")
	}
}

// A preference and a theme must not collide even though they share a table
func TestThemeAndPreferenceAreIndependent(t *testing.T) {
	manager := newTestManager(t)

	if err := manager.SetTheme("alice", "winxp"); err != nil {
		t.Fatalf("SetTheme() returned error: %v", err)
	}
	if err := manager.SetPreference("alice", "theme", "not-a-theme"); err != nil {
		t.Fatalf("SetPreference() returned error: %v", err)
	}

	if got := manager.GetTheme("alice"); got != "winxp" {
		t.Errorf("GetTheme() = %q, want %q", got, "winxp")
	}
	if got := manager.GetPreference("alice", "theme"); got != "not-a-theme" {
		t.Errorf("GetPreference() = %q, want %q", got, "not-a-theme")
	}
}
