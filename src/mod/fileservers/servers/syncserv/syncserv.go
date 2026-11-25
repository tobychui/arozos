// Package syncserv is the Sync Server: an HTTP upload endpoint that phone
// automations (an iOS Shortcut that runs every night, a script on Android,
// curl) send photos and files to.
//
// There is one endpoint for every user. A request names its user in the
// Username header and signs in with that user's sync password (or, if the
// user chose so, their login password) as Authorization: Bearer <password>.
// Behind a proxy that removes or replaces Authorization, the X-User-Name and
// X-User-Cred headers carry the same, the password alone.
// Each user picks the folder of their drives uploads go to, whether they are
// sorted into type folders (Photo, Video, ...) and date folders (2026,
// 2026_08 or 2026/08, by the date the file was taken or the upload date),
// and whether a file that is already there is skipped or replaced. Phone
// automations send everything of the last days on every run, so skipping is
// the default and the names received in the last 30 days are remembered.
//
// The admin turns the server on, picks the groups whose members may use it
// (admins always can) and the largest file it accepts.
package syncserv

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
)

const (
	logTitle      = "Sync Server"
	settingsTable = "syncserver"

	//Keys of the settings table
	keyEnabled    = "enabled"
	keyConfig     = "config"
	prefixUser    = "user/"     //user/<name>: UserSettings, there when the user turned it on
	prefixSecret  = "secret/"   //secret/<name>: bcrypt hash of the sync password
	prefixStats   = "activity/" //activity/<name>: Activity
	prefixSeen    = "seen/"     //seen/<name>/<lower case file name>: seenEntry
	UploadPath    = "/api/syncserver/upload"
	UploadPrefix  = "/api/syncserver/"
	DefaultFolder = "user:/Phone Uploads"

	//DefaultMaxFileMB is the largest file accepted unless the admin says otherwise
	DefaultMaxFileMB = 4096
	//How long the names of received files are remembered
	rememberFor = 30 * 24 * time.Hour
)

// Folder is where a user's uploads go. Paths inside it are relative and
// slash separated. The core makes it from the user's drives (syncserver.go
// in the main package), tests from a temporary folder.
type Folder interface {
	//Stat tells whether something is at rel, whether it is a folder and
	//how large it is.
	Stat(rel string) (exists bool, isDir bool, size int64)
	Open(rel string) (io.ReadCloser, error)
	//HaveSpace tells whether the user's storage quota holds size more bytes.
	HaveSpace(size int64) bool
	//Place moves the received file at spool (a path on the host) to rel,
	//replacing a file there and making the folders on the way.
	Place(spool string, rel string) error
	//VirtualPath is the path the user sees for rel.
	VirtualPath(rel string) string
}

// ManagerOption wires the manager to the rest of the system.
type ManagerOption struct {
	Sysdb    *database.Database
	SpoolDir string //Uploads are received here before they are placed

	//CurrentUser returns who made a web request
	CurrentUser func(w http.ResponseWriter, r *http.Request) (string, error)
	//ConfirmPassword checks the login password in the "password" field of
	//the request, and writes the refusal itself when it is wrong
	ConfirmPassword func(w http.ResponseWriter, r *http.Request) bool
	//CheckLoginPassword checks a user's login password
	CheckLoginPassword func(username, password string) bool
	//AllowIP applies the login IP rules (whitelist and blacklist)
	AllowIP func(ip string) error
	//ClientIP is the address of the client of a request
	ClientIP func(r *http.Request) string
	//LogAuth records a sign in attempt in the login history
	LogAuth func(username, remote string, ok bool)

	UserExists func(username string) bool
	IsAdmin    func(username string) bool
	InGroups   func(username string, groups []string) bool
	ListGroups func() []string

	//OpenFolder returns where a user's uploads go. It refuses a folder the
	//user cannot write to.
	OpenFolder func(username, vpath string) (Folder, error)
}

// Config is what the admin picks.
type Config struct {
	Groups    []string //Groups whose members may use the server. Admins always can.
	MaxFileMB int64    //Largest file accepted in MiB, 0 for no limit
}

// UserSettings is what each user picks.
type UserSettings struct {
	Folder        string //Virtual path uploads go to
	ByType        bool   //Sort into Photo, Video, Audio, Document and Other
	DateFolders   string //DateNone, DateYear, DateMonth or DateNested
	DateSource    string //SourceCreated or SourceUpload
	Duplicates    string //DuplicateSkip or DuplicateOverwrite
	LoginPassword bool   //Sign in with the login password instead of a sync password
	Activated     int64  //When the user turned the server on, Unix time
}

// Activity is what a user's uploads did lately.
type Activity struct {
	Last      int64  //Last upload request, Unix time
	Address   string //Where it came from
	LastFile  string //Virtual path of the last file saved
	LastSaved int64  //When it was saved, Unix time
	Saved     int64
	Skipped   int64
	Failed    int64
	LastError string
}

// seenEntry is a file name received lately and where it went.
type seenEntry struct {
	T int64  //When, Unix time
	P string //Relative path in the sync folder
}

// DefaultSettings is what a user starts with.
func DefaultSettings() (out0 UserSettings) {
	defer logger.Out1(logger.In0("fileservers/servers/syncserv", "DefaultSettings"), &out0)
	return UserSettings{
		Folder:      DefaultFolder,
		ByType:      true,
		DateFolders: DateMonth,
		DateSource:  SourceCreated,
		Duplicates:  DuplicateSkip,
	}
}

// Manager runs the Sync Server.
type Manager struct {
	opt *ManagerOption

	mu        sync.Mutex
	userLocks map[string]*sync.Mutex
	lastPrune map[string]time.Time
	cache     *passwordCache
	limits    *limiter
}

// NewManager prepares the manager.
func NewManager(opt *ManagerOption) (out0 *Manager, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "NewManager", "opt", opt), &out0, &out1)
	if opt.Sysdb == nil || opt.OpenFolder == nil {
		return nil, errors.New("the sync server is missing its database or folders")
	}
	if err := opt.Sysdb.NewTable(settingsTable); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return nil, err
	}
	return &Manager{
		opt:       opt,
		userLocks: map[string]*sync.Mutex{},
		lastPrune: map[string]time.Time{},
		cache:     newPasswordCache(key),
		limits:    newLimiter(),
	}, nil
}

/*
	Settings
*/

// IsEnabled implements fileservers.Server.
func (m *Manager) IsEnabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "Manager.IsEnabled", "m", m), &out0)
	enabled := false
	if m.opt.Sysdb.KeyExists(settingsTable, keyEnabled) {
		m.opt.Sysdb.Read(settingsTable, keyEnabled, &enabled)
	}
	return enabled
}

// ServerToggle implements fileservers.Server. The endpoint is served by the
// web server, so turning it on or off only changes whether it answers.
func (m *Manager) ServerToggle(enabled bool) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.ServerToggle", "m", m, "enabled", enabled), &out0)
	if err := m.opt.Sysdb.Write(settingsTable, keyEnabled, enabled); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return err
	}
	if enabled {
		logger.PrintAndLog(logTitle, "Sync Server turned on", nil)
	} else {
		logger.PrintAndLog(logTitle, "Sync Server turned off", nil)
	}
	return nil
}

// GetEndpoints implements fileservers.Server. The connect page shows the
// address through the one the browser used, which is right behind a
// reverse proxy as well, so none is listed here.
func (m *Manager) GetEndpoints(userinfo *user.User) (out0 []*fileservers.Endpoint) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.GetEndpoints", "m", m, "userinfo", userinfo), &out0)
	return []*fileservers.Endpoint{}
}

// Config returns what the admin picked.
func (m *Manager) Config() (out0 Config) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "Manager.Config", "m", m), &out0)
	config := Config{Groups: []string{}, MaxFileMB: DefaultMaxFileMB}
	if m.opt.Sysdb.KeyExists(settingsTable, keyConfig) {
		m.opt.Sysdb.Read(settingsTable, keyConfig, &config)
	}
	if config.Groups == nil {
		config.Groups = []string{}
	}
	if config.MaxFileMB < 0 {
		config.MaxFileMB = 0
	}
	return config
}

func (m *Manager) setConfig(config Config) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.setConfig", "m", m, "&config", &config), &out0)
	return m.opt.Sysdb.Write(settingsTable, keyConfig, config)
}

// Allowed reports whether a user may use the server: admins always, others
// when they are in one of the groups the admin picked.
func (m *Manager) Allowed(username string) (out0 bool) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.Allowed", "m", m, "username", username), &out0)
	if username == "" || (m.opt.UserExists != nil && !m.opt.UserExists(username)) {
		return false
	}
	if m.opt.IsAdmin != nil && m.opt.IsAdmin(username) {
		return true
	}
	groups := m.Config().Groups
	return len(groups) > 0 && m.opt.InGroups != nil && m.opt.InGroups(username, groups)
}

// Settings returns what a user picked, and whether they turned it on.
func (m *Manager) Settings(username string) (out0 UserSettings, out1 bool) {
	defer logger.Out2(logger.In2("fileservers/servers/syncserv", "Manager.Settings", "m", m, "username", username), &out0, &out1)
	settings := DefaultSettings()
	if username == "" || !m.opt.Sysdb.KeyExists(settingsTable, prefixUser+username) {
		return settings, false
	}
	if err := m.opt.Sysdb.Read(settingsTable, prefixUser+username, &settings); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return DefaultSettings(), false
	}
	return settings, true
}

func (m *Manager) setSettings(username string, settings UserSettings) (out0 error) {
	defer logger.Out1(logger.In3("fileservers/servers/syncserv", "Manager.setSettings", "m", m, "username", username, "&settings", &settings), &out0)
	return m.opt.Sysdb.Write(settingsTable, prefixUser+username, settings)
}

// ValidateSettings checks the choices of a user and fills in the defaults
// of empty ones.
func ValidateSettings(s UserSettings) (out0 UserSettings, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/syncserv", "ValidateSettings", "&s", &s), &out0, &out1)
	s.Folder = strings.TrimSpace(s.Folder)
	if s.Folder == "" || !strings.Contains(s.Folder, ":/") {
		return s, errors.New("Pick a folder of your drives, as user:/Phone Uploads")
	}
	switch s.DateFolders {
	case DateNone, DateYear, DateMonth, DateNested:
	default:
		return s, errors.New("Unknown date folder layout")
	}
	switch s.DateSource {
	case "":
		s.DateSource = SourceCreated
	case SourceCreated, SourceUpload:
	default:
		return s, errors.New("Unknown date source")
	}
	switch s.Duplicates {
	case "":
		s.Duplicates = DuplicateSkip
	case DuplicateSkip, DuplicateOverwrite:
	default:
		return s, errors.New("Unknown way to handle files that are already there")
	}
	return s, nil
}

func (m *Manager) hasSyncPassword(username string) (out0 bool) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.hasSyncPassword", "m", m, "username", username), &out0)
	return m.opt.Sysdb.KeyExists(settingsTable, prefixSecret+username)
}

func (m *Manager) activity(username string) (out0 Activity) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.activity", "m", m, "username", username), &out0)
	activity := Activity{}
	m.opt.Sysdb.Read(settingsTable, prefixStats+username, &activity)
	return activity
}

// userLock serialises the uploads of one user, so two requests with the
// same file name never write it at the same time.
func (m *Manager) userLock(username string) (out0 *sync.Mutex) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.userLock", "m", m, "username", username), &out0)
	m.mu.Lock()
	defer m.mu.Unlock()
	lock, ok := m.userLocks[username]
	if !ok {
		lock = &sync.Mutex{}
		m.userLocks[username] = lock
	}
	return lock
}

// forgetUser removes everything kept for a user.
func (m *Manager) forgetUser(username string) {
	defer logger.Out0(logger.In2("fileservers/servers/syncserv", "Manager.forgetUser", "m", m, "username", username))
	m.opt.Sysdb.Delete(settingsTable, prefixUser+username)
	m.opt.Sysdb.Delete(settingsTable, prefixSecret+username)
	m.opt.Sysdb.Delete(settingsTable, prefixStats+username)
	m.forgetSeen(username)
	m.cache.forget(username)
}

/*
	Names received lately
*/

func seenKey(username, name string) (out0 string) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "seenKey", "username", username, "name", name), &out0)
	return prefixSeen + username + "/" + strings.ToLower(name)
}

// seen tells whether a file of this name was received in the last 30 days,
// and where it went.
func (m *Manager) seen(username, name string, now time.Time) (out0 seenEntry, out1 bool) {
	defer logger.Out2(logger.In4("fileservers/servers/syncserv", "Manager.seen", "m", m, "username", username, "name", name, "&now", &now), &out0, &out1)
	entry := seenEntry{}
	key := seenKey(username, name)
	if !m.opt.Sysdb.KeyExists(settingsTable, key) {
		return entry, false
	}
	if err := m.opt.Sysdb.Read(settingsTable, key, &entry); err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return entry, false
	}
	if now.Sub(time.Unix(entry.T, 0)) > rememberFor {
		return entry, false
	}
	return entry, true
}

func (m *Manager) remember(username, name, rel string, now time.Time) {
	defer logger.Out0(logger.In5("fileservers/servers/syncserv", "Manager.remember", "m", m, "username", username, "name", name, "rel", rel, "&now", &now))
	m.opt.Sysdb.Write(settingsTable, seenKey(username, name), seenEntry{T: now.Unix(), P: rel})
}

// pruneSeen drops the names older than 30 days, at most once an hour.
func (m *Manager) pruneSeen(username string, now time.Time) {
	defer logger.Out0(logger.In3("fileservers/servers/syncserv", "Manager.pruneSeen", "m", m, "username", username, "&now", &now))
	m.mu.Lock()
	last := m.lastPrune[username]
	if now.Sub(last) < time.Hour {
		m.mu.Unlock()
		return
	}
	m.lastPrune[username] = now
	m.mu.Unlock()

	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, prefixSeen+username+"/")
	if err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return
	}
	for _, entry := range entries {
		seen := seenEntry{}
		if json.Unmarshal(entry[1], &seen) != nil || now.Sub(time.Unix(seen.T, 0)) > rememberFor {
			m.opt.Sysdb.Delete(settingsTable, string(entry[0]))
		}
	}
}

func (m *Manager) forgetSeen(username string) (out0 int) {
	defer logger.Out1(logger.In2("fileservers/servers/syncserv", "Manager.forgetSeen", "m", m, "username", username), &out0)
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, prefixSeen+username+"/")
	if err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return 0
	}
	for _, entry := range entries {
		m.opt.Sysdb.Delete(settingsTable, string(entry[0]))
	}
	return len(entries)
}

func (m *Manager) countSeen(username string, now time.Time) (out0 int) {
	defer logger.Out1(logger.In3("fileservers/servers/syncserv", "Manager.countSeen", "m", m, "username", username, "&now", &now), &out0)
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, prefixSeen+username+"/")
	if err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return 0
	}
	count := 0
	for _, entry := range entries {
		seen := seenEntry{}
		if json.Unmarshal(entry[1], &seen) == nil && now.Sub(time.Unix(seen.T, 0)) <= rememberFor {
			count++
		}
	}
	return count
}

/*
	Users who turned it on
*/

// UserRow is one user who turned the server on, as the admin sees it.
type UserRow struct {
	Username string
	Folder   string
	Allowed  bool
	Settings UserSettings
	Activity Activity
}

// Users lists who turned the server on. Accounts deleted since are left out
// and forgotten, so that a new account of the same name starts with it off.
func (m *Manager) Users() (out0 []UserRow) {
	defer logger.Out1(logger.In1("fileservers/servers/syncserv", "Manager.Users", "m", m), &out0)
	rows := []UserRow{}
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, prefixUser)
	if err != nil {
		logger.DebugErr("fileservers/servers/syncserv", err)
		return rows
	}
	for _, entry := range entries {
		username := strings.TrimPrefix(string(entry[0]), prefixUser)
		if m.opt.UserExists != nil && !m.opt.UserExists(username) {
			m.forgetUser(username)
			continue
		}
		settings := DefaultSettings()
		json.Unmarshal(entry[1], &settings)
		rows = append(rows, UserRow{
			Username: username,
			Folder:   settings.Folder,
			Allowed:  m.Allowed(username),
			Settings: settings,
			Activity: m.activity(username),
		})
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].Username < rows[b].Username })
	return rows
}
