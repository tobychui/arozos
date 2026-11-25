package syncthingserv

import (
	"encoding/json"
	"sort"
	"strings"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Records

	ArozOS keeps who owns each Syncthing device and folder in the system
	database. They are the source of truth: the Syncthing configuration is
	rebuilt from them (see plan.go), so a device or folder that was not added
	through ArozOS never stays in it.
*/

const (
	settingsTable = "syncthing"
	keySettings   = "settings"
	keyEnabled    = "enabled"
	prefixDevice  = "device/"
	prefixFolder  = "folder/"
)

// Folder modes, as the user picks them for a folder
const (
	//ModeBackup keeps everything the device sends, deletions are not applied
	ModeBackup = "backup"
	//ModeMirror follows the device, deletions included, never sends back
	ModeMirror = "mirror"
	//ModeTwoWay is a normal Syncthing folder
	ModeTwoWay = "twoway"
)

// MaxVersionDays caps how long replaced and deleted files are kept
const MaxVersionDays = 3650

// Settings are the admin's choices.
type Settings struct {
	Port            int
	GlobalDiscovery bool
	LocalDiscovery  bool
	Relays          bool
	NAT             bool
	//Groups may use Syncthing besides admins, who always can
	Groups []string
}

func defaultSettings() Settings {
	logger.DebugTrace("fileservers/servers/syncthingserv", "defaultSettings")
	return Settings{
		Port:            DefaultPort,
		GlobalDiscovery: true,
		LocalDiscovery:  true,
		Relays:          true,
		NAT:             true,
		Groups:          []string{},
	}
}

// Device is a phone or computer a user linked to the server.
type Device struct {
	ID     string
	Owner  string
	Name   string
	Paused bool
	Added  int64
	//Ignored lists folders this device offered that the owner turned down
	Ignored []string
}

// Folder is a folder of a user's drive that Syncthing keeps in sync.
type Folder struct {
	ID          string
	Owner       string
	Label       string
	Path        string //Virtual path, like user:/Phone
	Mode        string
	VersionDays int //Days to keep replaced and deleted files, 0 is off
	Devices     []string
	Paused      bool
	Added       int64
}

func validMode(mode string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "validMode: mode=%.120q", mode)
	}
	return mode == ModeBackup || mode == ModeMirror || mode == ModeTwoWay
}

// store reads and writes the records.
type store struct {
	db *database.Database
}

func newStore(db *database.Database) (*store, error) {
	logger.Debug("fileservers/servers/syncthingserv", "newStore")
	if err := db.NewTable(settingsTable); err != nil {
		return nil, err
	}
	return &store{db: db}, nil
}

func (s *store) settings() Settings {
	logger.Debug("fileservers/servers/syncthingserv", "store.settings")
	settings := defaultSettings()
	if s.db.KeyExists(settingsTable, keySettings) {
		s.db.Read(settingsTable, keySettings, &settings)
	}
	if settings.Port < 1 || settings.Port > 65535 {
		settings.Port = DefaultPort
	}
	if settings.Groups == nil {
		settings.Groups = []string{}
	}
	return settings
}

func (s *store) setSettings(settings Settings) error {
	logger.DebugTrace("fileservers/servers/syncthingserv", "store.setSettings")
	return s.db.Write(settingsTable, keySettings, settings)
}

func (s *store) enabled() bool {
	logger.Debug("fileservers/servers/syncthingserv", "store.enabled")
	enabled := false
	if s.db.KeyExists(settingsTable, keyEnabled) {
		s.db.Read(settingsTable, keyEnabled, &enabled)
	}
	return enabled
}

func (s *store) setEnabled(enabled bool) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "store.setEnabled: enabled=%t", enabled)
	}
	return s.db.Write(settingsTable, keyEnabled, enabled)
}

func (s *store) devices() []Device {
	logger.Debug("fileservers/servers/syncthingserv", "store.devices")
	rows, err := s.db.ListTableWithPrefix(settingsTable, prefixDevice)
	if err != nil {
		return []Device{}
	}
	devices := []Device{}
	for _, row := range rows {
		var d Device
		if json.Unmarshal(row[1], &d) == nil && d.ID != "" {
			devices = append(devices, d)
		}
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Owner != devices[j].Owner {
			return devices[i].Owner < devices[j].Owner
		}
		return devices[i].Added < devices[j].Added
	})
	return devices
}

func (s *store) device(id string) (Device, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "store.device: id=%.120q", id)
	}
	var d Device
	if !s.db.KeyExists(settingsTable, prefixDevice+id) {
		return d, false
	}
	s.db.Read(settingsTable, prefixDevice+id, &d)
	return d, d.ID == id
}

func (s *store) putDevice(d Device) error {
	logger.DebugTrace("fileservers/servers/syncthingserv", "store.putDevice")
	return s.db.Write(settingsTable, prefixDevice+d.ID, d)
}

func (s *store) deleteDevice(id string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "store.deleteDevice: id=%.120q", id)
	}
	return s.db.Delete(settingsTable, prefixDevice+id)
}

func (s *store) folders() []Folder {
	logger.Debug("fileservers/servers/syncthingserv", "store.folders")
	rows, err := s.db.ListTableWithPrefix(settingsTable, prefixFolder)
	if err != nil {
		return []Folder{}
	}
	folders := []Folder{}
	for _, row := range rows {
		var f Folder
		if json.Unmarshal(row[1], &f) == nil && f.ID != "" {
			folders = append(folders, f)
		}
	}
	sort.Slice(folders, func(i, j int) bool {
		if folders[i].Owner != folders[j].Owner {
			return folders[i].Owner < folders[j].Owner
		}
		return strings.ToLower(folders[i].Label) < strings.ToLower(folders[j].Label)
	})
	return folders
}

func (s *store) folder(id string) (Folder, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "store.folder: id=%.120q", id)
	}
	var f Folder
	if !s.db.KeyExists(settingsTable, prefixFolder+id) {
		return f, false
	}
	s.db.Read(settingsTable, prefixFolder+id, &f)
	return f, f.ID == id
}

func (s *store) putFolder(f Folder) error {
	logger.DebugTrace("fileservers/servers/syncthingserv", "store.putFolder")
	return s.db.Write(settingsTable, prefixFolder+f.ID, f)
}

func (s *store) deleteFolder(id string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "store.deleteFolder: id=%.120q", id)
	}
	return s.db.Delete(settingsTable, prefixFolder+id)
}

// removeDeviceFromFolders takes a device out of every folder it was shared
// with, so that a device added again later does not get them back unasked.
func (s *store) removeDeviceFromFolders(deviceID string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "store.removeDeviceFromFolders: deviceID=%.120q", deviceID)
	}
	for _, f := range s.folders() {
		kept := f.Devices[:0]
		changed := false
		for _, id := range f.Devices {
			if id == deviceID {
				changed = true
				continue
			}
			kept = append(kept, id)
		}
		if changed {
			f.Devices = kept
			s.putFolder(f)
		}
	}
}
