package prefs

import (
	"errors"

	"imuslab.com/arozos/mod/database"
)

/*
	prefs.go

	Per-user desktop preferences and wallpaper theme selection, stored in the
	system database so they follow the account across devices.

	Author: tobychui
*/

// DefaultTheme is the wallpaper theme served to a user who has never picked one
const DefaultTheme = "default"

// Manager reads and writes desktop preferences for all users
type Manager struct {
	db    *database.Database
	table string
}

// NewManager creates a preference manager storing values in the given database
// table. The table is created if it does not exist yet.
func NewManager(db *database.Database, tableName string) (*Manager, error) {
	if db == nil {
		return nil, errors.New("no database given")
	}

	err := db.NewTable(tableName)
	if err != nil {
		return nil, err
	}

	return &Manager{db: db, table: tableName}, nil
}

// GetPreference returns a stored preference value, or an empty string when the
// user has never set it.
func (m *Manager) GetPreference(username string, preferenceType string) string {
	storedValue := ""
	m.db.Read(m.table, m.preferenceKey(username, preferenceType), &storedValue)
	return storedValue
}

// SetPreference stores a preference value for a user
func (m *Manager) SetPreference(username string, preferenceType string, value string) error {
	return m.db.Write(m.table, m.preferenceKey(username, preferenceType), value)
}

// RemovePreference forgets a stored preference, reverting the user to default
func (m *Manager) RemovePreference(username string, preferenceType string) error {
	return m.db.Delete(m.table, m.preferenceKey(username, preferenceType))
}

// GetTheme returns the wallpaper theme picked by a user, falling back to
// DefaultTheme when none has been set.
func (m *Manager) GetTheme(username string) string {
	selectedTheme := ""
	m.db.Read(m.table, m.themeKey(username), &selectedTheme)
	if selectedTheme == "" {
		return DefaultTheme
	}
	return selectedTheme
}

// SetTheme stores the wallpaper theme picked by a user
func (m *Manager) SetTheme(username string, theme string) error {
	return m.db.Write(m.table, m.themeKey(username), theme)
}

// preferenceKey builds the database key holding one user's preference value
func (m *Manager) preferenceKey(username string, preferenceType string) string {
	return username + "/preference/" + preferenceType
}

// themeKey builds the database key holding one user's wallpaper theme
func (m *Manager) themeKey(username string) string {
	return username + "/theme"
}
