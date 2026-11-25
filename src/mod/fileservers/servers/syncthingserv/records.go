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

func defaultSettings() (out0 Settings) {
	defer logger.Out1(logger.In0("fileservers/servers/syncthingserv", "defaultSettings"), &out0)
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

func validMode(mode string) (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "validMode", "mode", mode), &out0)
	return mode == ModeBackup || mode == ModeMirror || mode == ModeTwoWay
}

// store reads and writes the records.
type store struct {
	db *database.Database
}

func newStore(db *database.Database) (out0 *store, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/syncthingserv", "newStore", "db", db), &out0, &out1)
	if err := db.NewTable(settingsTable); err != nil {
		logger.DebugErr("fileservers/servers/syncthingserv", err)
		return nil, err
	}
	return &store{db: db}, nil
}

func (s *store) settings() (out0 Settings) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "store.settings", "s", s), &out0)
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

func (s *store) setSettings(settings Settings) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.setSettings", "s", s, "&settings", &settings), &out0)
	return s.db.Write(settingsTable, keySettings, settings)
}

func (s *store) enabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "store.enabled", "s", s), &out0)
	enabled := false
	if s.db.KeyExists(settingsTable, keyEnabled) {
		s.db.Read(settingsTable, keyEnabled, &enabled)
	}
	return enabled
}

func (s *store) setEnabled(enabled bool) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.setEnabled", "s", s, "enabled", enabled), &out0)
	return s.db.Write(settingsTable, keyEnabled, enabled)
}

func (s *store) devices() (out0 []Device) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "store.devices", "s", s), &out0)
	rows, err := s.db.ListTableWithPrefix(settingsTable, prefixDevice)
	if err != nil {
		logger.DebugErr("fileservers/servers/syncthingserv", err)
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

func (s *store) device(id string) (out0 Device, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncthingserv", "store.device", "s", s, "id", id), &out0, &out1)
	var d Device
	if !s.db.KeyExists(settingsTable, prefixDevice+id) {
		return d, false
	}
	s.db.Read(settingsTable, prefixDevice+id, &d)
	return d, d.ID == id
}

func (s *store) putDevice(d Device) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.putDevice", "s", s, "&d", &d), &out0)
	return s.db.Write(settingsTable, prefixDevice+d.ID, d)
}

func (s *store) deleteDevice(id string) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.deleteDevice", "s", s, "id", id), &out0)
	return s.db.Delete(settingsTable, prefixDevice+id)
}

func (s *store) folders() (out0 []Folder) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "store.folders", "s", s), &out0)
	rows, err := s.db.ListTableWithPrefix(settingsTable, prefixFolder)
	if err != nil {
		logger.DebugErr("fileservers/servers/syncthingserv", err)
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

func (s *store) folder(id string) (out0 Folder, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncthingserv", "store.folder", "s", s, "id", id), &out0, &out1)
	var f Folder
	if !s.db.KeyExists(settingsTable, prefixFolder+id) {
		return f, false
	}
	s.db.Read(settingsTable, prefixFolder+id, &f)
	return f, f.ID == id
}

func (s *store) putFolder(f Folder) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.putFolder", "s", s, "&f", &f), &out0)
	return s.db.Write(settingsTable, prefixFolder+f.ID, f)
}

func (s *store) deleteFolder(id string) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "store.deleteFolder", "s", s, "id", id), &out0)
	return s.db.Delete(settingsTable, prefixFolder+id)
}

// removeDeviceFromFolders takes a device out of every folder it was shared
// with, so that a device added again later does not get them back unasked.
func (s *store) removeDeviceFromFolders(deviceID string) {
	defer logger.Out0(logger.In2("fileservers/servers/syncthingserv", "store.removeDeviceFromFolders", "s", s, "deviceID", deviceID))
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
