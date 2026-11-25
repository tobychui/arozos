package layout

import (
	"encoding/json"
	"errors"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	layout.go

	Persistence of where each icon sits on a user's desktop grid. Positions are
	stored in the system database keyed by user so they follow the account
	across devices.

	Author: tobychui
*/

// IconLocation is the grid position of a single desktop icon
type IconLocation struct {
	X int
	Y int
}

// Manager reads and writes desktop icon positions for all users
type Manager struct {
	db    *database.Database
	table string
}

// NewManager creates a layout manager storing positions in the given database
// table. The table is created if it does not exist yet.
func NewManager(db *database.Database, tableName string) (*Manager, error) {
	if logger.IsDebug() {
		logger.Debugf("desktop/layout", "NewManager: tableName=%.120q", tableName)
	}
	if db == nil {
		return nil, errors.New("no database given")
	}

	err := db.NewTable(tableName)
	if err != nil {
		return nil, err
	}

	return &Manager{db: db, table: tableName}, nil
}

// GetIconLocation returns the stored grid position of a desktop file. An error
// is returned when the file has never been positioned by the user.
func (m *Manager) GetIconLocation(username string, filename string) (int, int, error) {
	if logger.IsDebug() {
		logger.Debugf("desktop/layout", "Manager.GetIconLocation: username=%.120q filename=%.120q", username, filename)
	}
	storedLocation := ""
	err := m.db.Read(m.table, m.locationKey(username, filename), &storedLocation)
	if err != nil || storedLocation == "" {
		//The file location is not set
		return -1, -1, errors.New("this file do not have a location registry")
	}

	iconLocation := IconLocation{X: -1, Y: -1}
	err = json.Unmarshal([]byte(storedLocation), &iconLocation)
	if err != nil {
		return -1, -1, err
	}

	return iconLocation.X, iconLocation.Y, nil
}

// SetIconLocation stores the grid position of a desktop file
func (m *Manager) SetIconLocation(username string, filename string, x int, y int) error {
	if logger.IsDebug() {
		logger.Debugf("desktop/layout", "Manager.SetIconLocation: username=%.120q filename=%.120q x=%d y=%d", username, filename, x, y)
	}
	newLocation, err := json.Marshal(IconLocation{X: x, Y: y})
	if err != nil {
		return err
	}

	return m.db.Write(m.table, m.locationKey(username, filename), string(newLocation))
}

// RemoveIconLocation forgets the stored position of a desktop file
func (m *Manager) RemoveIconLocation(username string, filename string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("desktop/layout", "Manager.RemoveIconLocation: username=%.120q filename=%.120q", username, filename)
	}
	return m.db.Delete(m.table, m.locationKey(username, filename))
}

// locationKey builds the database key holding one user's icon position. As the
// key already includes the username, positions of different users never collide.
func (m *Manager) locationKey(username string, filename string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("desktop/layout", "Manager.locationKey: username=%.120q filename=%.120q", username, filename)
	}
	return username + "/filelocation/" + filename
}
