package syncserv

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	handlers.go

	The settings endpoints: every user's own (status, turning it on, the
	folder and sorting, the password) and the admin's (groups, largest
	file, who uses it).
*/

// UserStatus is what the connect page shows a user.
type UserStatus struct {
	Running         bool
	Allowed         bool
	Activated       bool
	Username        string
	Settings        UserSettings
	HasSyncPassword bool
	Activity        Activity
	Remembered      int //File names remembered from the last 30 days
	MaxFileMB       int64
	Path            string //Of the upload endpoint
}

// AdminConfig is what the settings page shows an admin.
type AdminConfig struct {
	Running   bool
	Config    Config
	AllGroups []string
	Path      string
}

func sendJSON(w http.ResponseWriter, value interface{}) {
	js, _ := json.Marshal(value)
	utils.SendJSONResponse(w, string(js))
}

// postValue reads a field of the body of a POST request, never the URL.
func postValue(r *http.Request, key string) string {
	if r.Method != http.MethodPost {
		return ""
	}
	r.ParseForm()
	return r.PostForm.Get(key)
}

func (m *Manager) currentUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return "", false
	}
	return username, true
}

func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return false
	}
	return true
}

// settingsFromForm reads the folder and sorting choices of a request over
// base, and checks them.
func (m *Manager) settingsFromForm(r *http.Request, username string, base UserSettings) (UserSettings, error) {
	s := base
	s.Folder = postValue(r, "folder")
	s.ByType = postValue(r, "bytype") == "true"
	s.DateFolders = postValue(r, "datefolders")
	s.DateSource = postValue(r, "datesource")
	s.Duplicates = postValue(r, "duplicates")
	s, err := ValidateSettings(s)
	if err != nil {
		return s, err
	}
	if _, err := m.opt.OpenFolder(username, s.Folder); err != nil {
		return s, err
	}
	return s, nil
}

// HandleStatus tells a signed in user how the server is set up for them.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	settings, active := m.Settings(username)
	sendJSON(w, UserStatus{
		Running:         m.IsEnabled(),
		Allowed:         m.Allowed(username),
		Activated:       active,
		Username:        username,
		Settings:        settings,
		HasSyncPassword: m.hasSyncPassword(username),
		Activity:        m.activity(username),
		Remembered:      m.countSeen(username, time.Now()),
		MaxFileMB:       m.Config().MaxFileMB,
		Path:            UploadPath,
	})
}

// setPasswordFromForm applies the password choice of a request: the login
// password, or a new sync password.
func (m *Manager) setPasswordFromForm(r *http.Request, username string, settings *UserSettings) error {
	settings.LoginPassword = postValue(r, "loginpassword") == "true"
	if settings.LoginPassword {
		m.cache.forget(username)
		return m.opt.Sysdb.Delete(settingsTable, prefixSecret+username)
	}
	return m.setSyncPassword(username, postValue(r, "syncpassword"))
}

// HandleActivate turns the server on for the signed in user. The login
// password has to come with it, so that a browser left open cannot be used
// to open the account to uploads.
func (m *Manager) HandleActivate(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	if !m.Allowed(username) {
		utils.SendErrorResponse(w, "Your account may not use the sync server")
		return
	}
	settings, err := m.settingsFromForm(r, username, DefaultSettings())
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if postValue(r, "loginpassword") != "true" {
		if err := ValidateSyncPassword(postValue(r, "syncpassword")); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}
	if !m.opt.ConfirmPassword(w, r) {
		return
	}
	if err := m.setPasswordFromForm(r, username, &settings); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	settings.Activated = time.Now().Unix()
	if err := m.setSettings(username, settings); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	logger.PrintAndLog(logTitle, "Sync Server turned on for "+username, nil)
	utils.SendOK(w)
}

// HandleSettings changes the folder and the sorting of the signed in user.
func (m *Manager) HandleSettings(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	current, active := m.Settings(username)
	if !active {
		utils.SendErrorResponse(w, "The sync server is not on for your account")
		return
	}
	settings, err := m.settingsFromForm(r, username, current)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if err := m.setSettings(username, settings); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandlePassword changes how the signed in user's uploads sign in. Like
// turning the server on, it needs the login password.
func (m *Manager) HandlePassword(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	settings, active := m.Settings(username)
	if !active {
		utils.SendErrorResponse(w, "The sync server is not on for your account")
		return
	}
	if postValue(r, "loginpassword") != "true" {
		if err := ValidateSyncPassword(postValue(r, "syncpassword")); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}
	if !m.opt.ConfirmPassword(w, r) {
		return
	}
	if err := m.setPasswordFromForm(r, username, &settings); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if err := m.setSettings(username, settings); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	logger.PrintAndLog(logTitle, "Sync Server password changed for "+username, nil)
	utils.SendOK(w)
}

// HandleDeactivate turns the server off for the signed in user. The files
// already received stay where they are.
func (m *Manager) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	m.forgetUser(username)
	logger.PrintAndLog(logTitle, "Sync Server turned off for "+username, nil)
	utils.SendOK(w)
}

// HandleForget forgets the file names the signed in user's uploads sent
// lately, so files deleted or moved on the server are received again.
func (m *Manager) HandleForget(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentUser(w, r)
	if !ok {
		return
	}
	sendJSON(w, map[string]int{"Forgotten": m.forgetSeen(username)})
}

// HandleConfig reads or changes the admin settings.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		groups := []string{}
		if m.opt.ListGroups != nil {
			groups = m.opt.ListGroups()
		}
		sendJSON(w, AdminConfig{
			Running:   m.IsEnabled(),
			Config:    m.Config(),
			AllGroups: groups,
			Path:      UploadPath,
		})
		return
	}

	config := m.Config()
	maxMB, err := strconv.ParseInt(strings.TrimSpace(postValue(r, "maxsize")), 10, 64)
	if err != nil || maxMB < 0 || maxMB > 1<<20 {
		utils.SendErrorResponse(w, "The largest file must be a number of MB from 0 (no limit) to 1048576")
		return
	}
	config.MaxFileMB = maxMB
	groups := []string{}
	if err := json.Unmarshal([]byte(postValue(r, "groups")), &groups); err != nil {
		utils.SendErrorResponse(w, "The groups could not be read")
		return
	}
	known := map[string]bool{}
	if m.opt.ListGroups != nil {
		for _, name := range m.opt.ListGroups() {
			known[name] = true
		}
	}
	config.Groups = []string{}
	for _, name := range groups {
		if known[name] {
			config.Groups = append(config.Groups, name)
		}
	}
	if err := m.setConfig(config); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	logger.PrintAndLog(logTitle, "Sync Server settings changed", nil)
	utils.SendOK(w)
}

// HandleUsers lists who turned the server on, and is for admins.
func (m *Manager) HandleUsers(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, m.Users())
}

// HandleRevoke turns the server off for a user, and is for admins.
func (m *Manager) HandleRevoke(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	username := postValue(r, "username")
	if username == "" {
		utils.SendErrorResponse(w, "No user given")
		return
	}
	m.forgetUser(username)
	logger.PrintAndLog(logTitle, "Sync Server turned off for "+username+" by an administrator", nil)
	utils.SendOK(w)
}
