package layout

import (
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// newTestManager spins up a throwaway database backed layout manager
func newTestManager(t *testing.T) *Manager {
	t.Helper()
	db, err := database.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("unable to create test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	manager, err := NewManager(db, "desktop")
	if err != nil {
		t.Fatalf("unable to create layout manager: %v", err)
	}
	return manager
}

func TestNewManagerRejectsNilDatabase(t *testing.T) {
	if _, err := NewManager(nil, "desktop"); err == nil {
		t.Error("NewManager(nil) = nil error, want an error")
	}
}

func TestSetAndGetIconLocation(t *testing.T) {
	manager := newTestManager(t)

	tests := []struct {
		name     string
		username string
		filename string
		x        int
		y        int
	}{
		{"plain position", "alice", "Photo.shortcut", 3, 5},
		{"origin", "alice", "Music.shortcut", 0, 0},
		{"negative position", "alice", "Video.shortcut", -1, -1},
		{"filename with spaces", "alice", "My Documents.shortcut", 7, 2},
		{"other user same filename", "bob", "Photo.shortcut", 9, 9},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := manager.SetIconLocation(tt.username, tt.filename, tt.x, tt.y); err != nil {
				t.Fatalf("SetIconLocation() returned error: %v", err)
			}

			gotX, gotY, err := manager.GetIconLocation(tt.username, tt.filename)
			if err != nil {
				t.Fatalf("GetIconLocation() returned error: %v", err)
			}
			if gotX != tt.x || gotY != tt.y {
				t.Errorf("GetIconLocation() = (%d, %d), want (%d, %d)", gotX, gotY, tt.x, tt.y)
			}
		})
	}

	//Positions must be scoped per user, so alice's Photo must not have moved
	gotX, gotY, err := manager.GetIconLocation("alice", "Photo.shortcut")
	if err != nil {
		t.Fatalf("GetIconLocation() returned error: %v", err)
	}
	if gotX != 3 || gotY != 5 {
		t.Errorf("alice's position = (%d, %d), want (3, 5) unaffected by bob", gotX, gotY)
	}
}

func TestGetIconLocationUnset(t *testing.T) {
	manager := newTestManager(t)

	x, y, err := manager.GetIconLocation("alice", "NeverPlaced.shortcut")
	if err == nil {
		t.Error("GetIconLocation() = nil error for an unplaced file, want an error")
	}
	if x != -1 || y != -1 {
		t.Errorf("GetIconLocation() = (%d, %d) for an unplaced file, want (-1, -1)", x, y)
	}
}

func TestSetIconLocationOverwrites(t *testing.T) {
	manager := newTestManager(t)

	if err := manager.SetIconLocation("alice", "Photo.shortcut", 1, 1); err != nil {
		t.Fatalf("SetIconLocation() returned error: %v", err)
	}
	if err := manager.SetIconLocation("alice", "Photo.shortcut", 4, 8); err != nil {
		t.Fatalf("SetIconLocation() returned error: %v", err)
	}

	x, y, err := manager.GetIconLocation("alice", "Photo.shortcut")
	if err != nil {
		t.Fatalf("GetIconLocation() returned error: %v", err)
	}
	if x != 4 || y != 8 {
		t.Errorf("GetIconLocation() = (%d, %d), want the overwritten (4, 8)", x, y)
	}
}

func TestRemoveIconLocation(t *testing.T) {
	manager := newTestManager(t)

	if err := manager.SetIconLocation("alice", "Photo.shortcut", 2, 2); err != nil {
		t.Fatalf("SetIconLocation() returned error: %v", err)
	}
	if err := manager.RemoveIconLocation("alice", "Photo.shortcut"); err != nil {
		t.Fatalf("RemoveIconLocation() returned error: %v", err)
	}

	if _, _, err := manager.GetIconLocation("alice", "Photo.shortcut"); err == nil {
		t.Error("GetIconLocation() = nil error after removal, want an error")
	}
}
