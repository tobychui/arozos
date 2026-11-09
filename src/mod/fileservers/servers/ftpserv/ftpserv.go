package ftpserv

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	upnp "imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/storage/ftp"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

const (
	settingsTable      = "ftp"
	userKeyPrefix      = "user/" //user/<name> holds when that user turned FTP on
	DefaultPort        = 21
	DefaultIdleMinutes = 15
	logTitle           = "FTP"
	//What a client is told for every refused sign in, so that FTP cannot be
	//used to find out whether a password is right
	refusedSignIn = "Invalid username or password"
)

type ManagerOption struct {
	Hostname  string
	Sysdb     *database.Database
	Upnp      *upnp.UPnPClient //Nil when UPnP did not start on this host
	AllowUpnp bool
	//CurrentUser names the signed in user of a web request
	CurrentUser func(w http.ResponseWriter, r *http.Request) (string, error)
	//ConfirmPassword checks the login password sent with a request, and
	//answers the request itself when it is wrong
	ConfirmPassword func(w http.ResponseWriter, r *http.Request) bool
	//CheckPassword checks a sign in from an FTP client: the login IP rules,
	//then the password. remote is the client's IP address.
	CheckPassword func(username, password, remote string) error
	//LogAuth records a sign in attempt in the login history
	LogAuth func(username, remote string, ok bool)
	//LookupUser returns the account of a signed in user
	LookupUser func(username string) (*user.User, error)
	UserExists func(username string) bool
	ListUsers  func() []string
	//InGroups tells whether a user is in one of the groups. Only used to carry
	//the old per group access over to per user access.
	InGroups func(username string, groups []string) bool
}

type Manager struct {
	mu        sync.Mutex
	server    *ftp.Handler
	forwarded int //The control port forwarded by UPnP, 0 for none
	lastError string
	opt       *ManagerOption
}

// AdminConfig is what the settings page shows.
type AdminConfig struct {
	Running       bool
	Port          int
	UpnpAvailable bool
	Upnp          bool
	UpnpActive    bool
	Passive       bool
	PublicIP      string
	AllowPublic   bool
	ReadOnly      bool
	IdleMinutes   int
	LastError     string
}

// UserStatus is what the connect section shows every user.
type UserStatus struct {
	Running   bool
	Port      int
	Username  string
	Activated bool
	ReadOnly  bool
}

// UserRow is one user who turned FTP on.
type UserRow struct {
	Username string
	Enabled  int64 //Unix time
}

// Create a new FTP Manager
func NewFTPManager(option *ManagerOption) *Manager {
	option.Sysdb.NewTable(settingsTable)
	m := &Manager{opt: option}
	m.migrateGroupAccess()

	defaultEnable := false
	if option.Sysdb.KeyExists(settingsTable, "default") {
		option.Sysdb.Read(settingsTable, "default", &defaultEnable)
	} else {
		option.Sysdb.Write(settingsTable, "default", false)
	}
	if defaultEnable {
		m.mu.Lock()
		if err := m.start(); err != nil {
			//Keep the choice: the next boot tries again
			logger.PrintAndLog(logTitle, "The FTP server could not start", err)
		}
		m.mu.Unlock()
	}
	return m
}

// migrateGroupAccess replaces the old list of groups allowed to use FTP: every
// member of those groups gets FTP turned on, so nobody loses access.
func (m *Manager) migrateGroupAccess() {
	if !m.opt.Sysdb.KeyExists(settingsTable, "groups") {
		return
	}
	groups := []string{}
	m.opt.Sysdb.Read(settingsTable, "groups", &groups)
	moved := 0
	if len(groups) > 0 && m.opt.ListUsers != nil && m.opt.InGroups != nil {
		for _, username := range m.opt.ListUsers() {
			if !m.UserEnabled(username) && m.opt.InGroups(username, groups) {
				m.setUser(username, true)
				moved++
			}
		}
	}
	m.opt.Sysdb.Delete(settingsTable, "groups")
	logger.PrintAndLog(logTitle, "FTP access of the groups "+strings.Join(groups, ", ")+" moved to "+strconv.Itoa(moved)+" user accounts", nil)
}

/*
	Settings
*/

func (m *Manager) readBool(key string, fallback bool) bool {
	value := fallback
	if m.opt.Sysdb.KeyExists(settingsTable, key) {
		m.opt.Sysdb.Read(settingsTable, key, &value)
	}
	return value
}

// Port returns the configured control port.
func (m *Manager) Port() int {
	port := DefaultPort
	if m.opt.Sysdb.KeyExists(settingsTable, "port") {
		m.opt.Sysdb.Read(settingsTable, "port", &port)
	}
	return port
}

func (m *Manager) upnpEnabled() bool { return m.readBool("upnp", false) }
func (m *Manager) passive() bool     { return m.readBool("passive", false) }

// Public addresses stay allowed by default, as before this setting existed
func (m *Manager) allowPublic() bool { return m.readBool("public", true) }
func (m *Manager) readOnly() bool    { return m.readBool("readonly", false) }

func (m *Manager) publicIP() string {
	ip := ""
	m.opt.Sysdb.Read(settingsTable, "publicip", &ip)
	return ip
}

func (m *Manager) idleMinutes() int {
	minutes := DefaultIdleMinutes
	if m.opt.Sysdb.KeyExists(settingsTable, "idle") {
		m.opt.Sysdb.Read(settingsTable, "idle", &minutes)
	}
	return minutes
}

/*
	Per user access
*/

// UserEnabled tells whether a user turned FTP on for their account.
func (m *Manager) UserEnabled(username string) bool {
	return username != "" && m.opt.Sysdb.KeyExists(settingsTable, userKeyPrefix+username)
}

func (m *Manager) setUser(username string, enabled bool) error {
	if enabled {
		return m.opt.Sysdb.Write(settingsTable, userKeyPrefix+username, time.Now().Unix())
	}
	return m.opt.Sysdb.Delete(settingsTable, userKeyPrefix+username)
}

// Users lists who turned FTP on. Accounts deleted since are left out and
// forgotten, so that a new account of the same name starts with FTP off.
func (m *Manager) Users() []UserRow {
	rows := []UserRow{}
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, userKeyPrefix)
	if err != nil {
		return rows
	}
	for _, entry := range entries {
		username := strings.TrimPrefix(string(entry[0]), userKeyPrefix)
		if m.opt.UserExists != nil && !m.opt.UserExists(username) {
			m.setUser(username, false)
			continue
		}
		row := UserRow{Username: username}
		json.Unmarshal(entry[1], &row.Enabled)
		rows = append(rows, row)
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].Username < rows[b].Username })
	return rows
}

func (m *Manager) dropUser(username string) {
	m.mu.Lock()
	server := m.server
	m.mu.Unlock()
	if server != nil {
		server.DropUser(username)
	}
}

// authenticate decides a sign in from an FTP client. Whether FTP is on for the
// account is asked first, so that the password of an account without FTP is
// never checked over FTP.
func (m *Manager) authenticate(username, password, remote string) error {
	err := errors.New(refusedSignIn)
	if m.UserEnabled(username) {
		err = m.opt.CheckPassword(username, password, remote)
	}
	if m.opt.LogAuth != nil {
		m.opt.LogAuth(username, remote, err == nil)
	}
	if err != nil {
		return errors.New(refusedSignIn)
	}
	return nil
}

/*
	Server
*/

// start runs a new server with the saved settings. m.mu must be held.
func (m *Manager) start() error {
	m.stop()
	port := m.Port()
	useUpnp := m.opt.AllowUpnp && m.opt.Upnp != nil && m.upnpEnabled()

	//Passive transfers announce the public address: the router's when UPnP
	//forwards the ports, the one entered by the admin otherwise
	passiveIP := ""
	if useUpnp && m.opt.Upnp.ExternalIP != "" {
		passiveIP = m.opt.Upnp.ExternalIP
	} else if m.passive() {
		passiveIP = m.publicIP()
	}

	h, err := ftp.NewFTPHandler(ftp.Options{
		ServerName:    m.opt.Hostname,
		Port:          port,
		PassiveModeIP: passiveIP,
		IdleTimeout:   m.idleMinutes() * 60,
		AllowPublic:   m.allowPublic(),
		ReadOnly:      m.readOnly(),
		Authenticate:  m.authenticate,
		LookupUser:    m.opt.LookupUser,
	})
	if err == nil {
		err = h.Start()
	}
	if err != nil {
		m.lastError = err.Error()
		return err
	}
	m.server = h
	m.lastError = ""

	if useUpnp {
		if err := m.opt.Upnp.ForwardPort(port, m.opt.Hostname+" FTP Server"); err != nil {
			logger.PrintAndLog(logTitle, "Failed to forward the FTP port with UPnP", err)
			m.lastError = "UPnP could not forward port " + strconv.Itoa(port) + ": " + err.Error()
		} else {
			//Forward the passive transfer ports
			m.opt.Upnp.ForwardPort(port+1, m.opt.Hostname+" FTP Data 1")
			m.opt.Upnp.ForwardPort(port+2, m.opt.Hostname+" FTP Data 2")
			m.forwarded = port
			h.UPNPEnabled = true
		}
	}
	return nil
}

// stop closes the running server, if any. m.mu must be held.
func (m *Manager) stop() {
	if m.server != nil {
		m.server.Close()
		m.server = nil
	}
	if m.forwarded != 0 && m.opt.Upnp != nil {
		m.opt.Upnp.ClosePort(m.forwarded)
		m.opt.Upnp.ClosePort(m.forwarded + 1)
		m.opt.Upnp.ClosePort(m.forwarded + 2)
	}
	m.forwarded = 0
}

func (m *Manager) IsFtpServerEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.server != nil && m.server.ServerRunning
}

func (m *Manager) FTPServerToggle(enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !enabled {
		m.stop()
		m.lastError = ""
		logger.PrintAndLog(logTitle, "FTP Server Stopped", nil)
		return m.opt.Sysdb.Write(settingsTable, "default", false)
	}
	if m.server != nil {
		return nil
	}
	if err := m.start(); err != nil {
		return err
	}
	return m.opt.Sysdb.Write(settingsTable, "default", true)
}

// Close stops the server without changing whether it starts on boot.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stop()
}

func (m *Manager) FTPGetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	return []*fileservers.Endpoint{{
		ProtocolName: "ftp://",
		Port:         m.Port(),
		Subpath:      "",
	}}
}

/*
	Handlers
*/

func sendJSON(w http.ResponseWriter, value interface{}) {
	js, _ := json.Marshal(value)
	utils.SendJSONResponse(w, string(js))
}

func postOnly(r *http.Request, key string) string {
	if r.Method != http.MethodPost {
		return ""
	}
	r.ParseForm()
	return r.PostForm.Get(key)
}

// HandleStatus tells a signed in user whether FTP is on for them.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, UserStatus{
		Running:   m.IsFtpServerEnabled(),
		Port:      m.Port(),
		Username:  username,
		Activated: m.UserEnabled(username),
		ReadOnly:  m.readOnly(),
	})
}

// HandleActivate turns FTP on for the signed in user. The login password has
// to come with it, so that a browser left open cannot be used to open the
// account to the network.
func (m *Manager) HandleActivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if !m.opt.ConfirmPassword(w, r) {
		return
	}
	if err := m.setUser(username, true); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	logger.PrintAndLog(logTitle, "FTP turned on for "+username, nil)
	utils.SendOK(w)
}

// HandleDeactivate turns FTP off for the signed in user.
func (m *Manager) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.revoke(w, username)
}

func (m *Manager) revoke(w http.ResponseWriter, username string) {
	if err := m.setUser(username, false); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.dropUser(username)
	logger.PrintAndLog(logTitle, "FTP turned off for "+username, nil)
	utils.SendOK(w)
}

// HandleConfig reads or changes the settings, and is for admins.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		m.mu.Lock()
		config := AdminConfig{
			Running:       m.server != nil && m.server.ServerRunning,
			UpnpActive:    m.forwarded != 0,
			LastError:     m.lastError,
			UpnpAvailable: m.opt.AllowUpnp && m.opt.Upnp != nil,
		}
		m.mu.Unlock()
		config.Port = m.Port()
		config.Upnp = m.upnpEnabled()
		config.Passive = m.passive()
		config.PublicIP = m.publicIP()
		config.AllowPublic = m.allowPublic()
		config.ReadOnly = m.readOnly()
		config.IdleMinutes = m.idleMinutes()
		sendJSON(w, config)
		return
	}

	port, err := strconv.Atoi(postOnly(r, "port"))
	if err != nil || port < 1 || port > 65533 {
		//Passive transfers use the two ports after it
		utils.SendErrorResponse(w, "The port must be a number from 1 to 65533")
		return
	}
	idle, err := strconv.Atoi(postOnly(r, "idle"))
	if err != nil || idle < 1 || idle > 1440 {
		utils.SendErrorResponse(w, "The idle time must be a number of minutes from 1 to 1440")
		return
	}
	publicIP := strings.TrimSpace(postOnly(r, "publicip"))
	if publicIP != "" && net.ParseIP(publicIP) == nil {
		utils.SendErrorResponse(w, "The public address must be an IP address")
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.opt.Sysdb.Write(settingsTable, "port", port)
	m.opt.Sysdb.Write(settingsTable, "idle", idle)
	m.opt.Sysdb.Write(settingsTable, "upnp", postOnly(r, "upnp") == "true")
	m.opt.Sysdb.Write(settingsTable, "passive", postOnly(r, "passive") == "true")
	m.opt.Sysdb.Write(settingsTable, "publicip", publicIP)
	m.opt.Sysdb.Write(settingsTable, "public", postOnly(r, "public") != "false")
	m.opt.Sysdb.Write(settingsTable, "readonly", postOnly(r, "readonly") == "true")
	logger.PrintAndLog(logTitle, "FTP settings changed", nil)

	restarted := false
	if m.server != nil {
		//Every client is disconnected, and their programs reconnect
		if err := m.start(); err != nil {
			utils.SendErrorResponse(w, "The settings are saved, but the server could not restart: "+err.Error())
			return
		}
		restarted = true
	}
	sendJSON(w, map[string]bool{"Restarted": restarted})
}

// HandleClients lists who is connected, and is for admins.
func (m *Manager) HandleClients(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	server := m.server
	m.mu.Unlock()
	clients := []ftp.ClientInfo{}
	if server != nil {
		clients = server.Clients()
	}
	sendJSON(w, clients)
}

// HandleUsers lists who turned FTP on, and is for admins.
func (m *Manager) HandleUsers(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, m.Users())
}

// HandleRevoke turns FTP off for a user, and is for admins.
func (m *Manager) HandleRevoke(w http.ResponseWriter, r *http.Request) {
	username := postOnly(r, "username")
	if username == "" {
		utils.SendErrorResponse(w, "No user given")
		return
	}
	m.revoke(w, username)
}
