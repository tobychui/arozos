package prefs

import (
	"errors"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
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
func NewManager(db *database.Database, tableName string) (out0 *Manager, out1 error) {
	defer logger.Out2(logger.In2("desktop/prefs", "NewManager", "db", db, "tableName", tableName), &out0, &out1)
	if db == nil {
		return nil, errors.New("no database given")
	}

	err := db.NewTable(tableName)
	if err != nil {
		logger.DebugErr("desktop/prefs", err)
		return nil, err
	}

	return &Manager{db: db, table: tableName}, nil
}

// GetPreference returns a stored preference value, or an empty string when the
// user has never set it.
func (m *Manager) GetPreference(username string, preferenceType string) (out0 string) {
	defer logger.Out1(logger.In3("desktop/prefs", "Manager.GetPreference", "m", m, "username", username, "preferenceType", preferenceType), &out0)
	storedValue := ""
	m.db.Read(m.table, m.preferenceKey(username, preferenceType), &storedValue)
	return storedValue
}

// SetPreference stores a preference value for a user
func (m *Manager) SetPreference(username string, preferenceType string, value string) error {
	logger.DebugTrace("desktop/prefs", "Manager.SetPreference")
	return m.db.Write(m.table, m.preferenceKey(username, preferenceType), value)
}

// RemovePreference forgets a stored preference, reverting the user to default
func (m *Manager) RemovePreference(username string, preferenceType string) error {
	logger.DebugTrace("desktop/prefs", "Manager.RemovePreference")
	return m.db.Delete(m.table, m.preferenceKey(username, preferenceType))
}

// GetTheme returns the wallpaper theme picked by a user, falling back to
// DefaultTheme when none has been set.
func (m *Manager) GetTheme(username string) (out0 string) {
	defer logger.Out1(logger.In2("desktop/prefs", "Manager.GetTheme", "m", m, "username", username), &out0)
	selectedTheme := ""
	m.db.Read(m.table, m.themeKey(username), &selectedTheme)
	if selectedTheme == "" {
		return DefaultTheme
	}
	return selectedTheme
}

// SetTheme stores the wallpaper theme picked by a user
func (m *Manager) SetTheme(username string, theme string) error {
	logger.DebugTrace("desktop/prefs", "Manager.SetTheme")
	return m.db.Write(m.table, m.themeKey(username), theme)
}

// preferenceKey builds the database key holding one user's preference value
func (m *Manager) preferenceKey(username string, preferenceType string) string {
	logger.DebugTrace("desktop/prefs", "Manager.preferenceKey")
	return username + "/preference/" + preferenceType
}

// themeKey builds the database key holding one user's wallpaper theme
func (m *Manager) themeKey(username string) string {
	logger.DebugTrace("desktop/prefs", "Manager.themeKey")
	return username + "/theme"
}
