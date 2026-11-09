package sftpserv

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/storage/sftpserver"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

const (
	settingsTable = "sftp"
	DefaultPort   = 2022
	logTitle      = "SFTP"
)

type ManagerOption struct {
	Hostname string
	KeyFile  string //The host key, created on first use
	Sysdb    *database.Database
	Upnp     *upnp.UPnPClient //Nil when UPnP is off on this host
	//CurrentUser names the signed in user of a web request
	CurrentUser func(w http.ResponseWriter, r *http.Request) (string, error)
	//CheckPassword checks a sign in from an SFTP client: the login IP rules,
	//then the password. remote is the client's IP address.
	CheckPassword func(username, password, remote string) error
	//LogAuth records a sign in attempt in the login history
	LogAuth func(username, remote string, ok bool)
	//LookupUser returns what a signed in user may reach
	LookupUser func(username string) (sftpserver.Access, error)
}

type Manager struct {
	mu        sync.Mutex
	instance  *sftpserver.Instance
	forwarded int //The port forwarded by UPnP, 0 for none
	lastError string
	opt       *ManagerOption
}

// AdminConfig is what the settings page shows.
type AdminConfig struct {
	Running       bool
	Port          int
	UpnpAvailable bool
	Upnp          bool
	AllowPublic   bool
	ReadOnly      bool
	Fingerprint   string
	LastError     string
}

// UserStatus is what the connect section shows every user.
type UserStatus struct {
	Running     bool
	Port        int
	Username    string
	Fingerprint string
	ReadOnly    bool
}

func NewSFTPServer(option *ManagerOption) *Manager {
	option.Sysdb.NewTable(settingsTable)
	m := &Manager{opt: option}

	enableOnStart := false
	option.Sysdb.Read(settingsTable, "enabled", &enableOnStart)
	if enableOnStart {
		m.mu.Lock()
		if err := m.start(); err != nil {
			//Keep the choice: the next boot tries again
			logger.PrintAndLog(logTitle, "The SFTP server could not start", err)
		}
		m.mu.Unlock()
	}
	return m
}

func (m *Manager) readBool(key string, fallback bool) bool {
	value := fallback
	if m.opt.Sysdb.KeyExists(settingsTable, key) {
		m.opt.Sysdb.Read(settingsTable, key, &value)
	}
	return value
}

// Port returns the configured port.
func (m *Manager) Port() int {
	port := DefaultPort
	if m.opt.Sysdb.KeyExists(settingsTable, "port") {
		m.opt.Sysdb.Read(settingsTable, "port", &port)
	}
	return port
}

func (m *Manager) upnpEnabled() bool { return m.readBool("upnp", false) }

// Public addresses stay allowed by default, as before this setting existed
func (m *Manager) allowPublic() bool { return m.readBool("public", true) }
func (m *Manager) readOnly() bool    { return m.readBool("readonly", false) }

func (m *Manager) hostKeyFingerprint() string {
	key, err := sftpserver.LoadOrCreateHostKey(m.opt.KeyFile)
	if err != nil {
		return ""
	}
	return sftpserver.Fingerprint(key)
}

func (m *Manager) authenticate(username, password, remote string) error {
	err := m.opt.CheckPassword(username, password, remote)
	if m.opt.LogAuth != nil {
		m.opt.LogAuth(username, remote, err == nil)
	}
	if err != nil {
		return errors.New("Invalid username or password")
	}
	return nil
}

// start runs a new instance with the saved settings. m.mu must be held.
func (m *Manager) start() error {
	m.stop()
	key, err := sftpserver.LoadOrCreateHostKey(m.opt.KeyFile)
	if err != nil {
		m.lastError = "The host key could not be read or created: " + err.Error()
		return err
	}
	port := m.Port()
	instance, err := sftpserver.NewSFTPServer(&sftpserver.SFTPConfig{
		ListeningIP:  ":" + strconv.Itoa(port),
		HostKey:      key,
		AllowPublic:  m.allowPublic(),
		ReadOnly:     m.readOnly(),
		Authenticate: m.authenticate,
		LookupUser:   m.opt.LookupUser,
	})
	if err != nil {
		m.lastError = err.Error()
		return err
	}
	m.instance = instance
	m.lastError = ""
	if m.upnpEnabled() && m.opt.Upnp != nil {
		if err := m.opt.Upnp.ForwardPort(port, m.opt.Hostname+" sftp-service"); err != nil {
			m.lastError = "UPnP could not forward port " + strconv.Itoa(port) + ": " + err.Error()
		} else {
			m.forwarded = port
		}
	}
	return nil
}

// stop closes the running instance, if any. m.mu must be held.
func (m *Manager) stop() {
	if m.instance != nil {
		m.instance.Close()
		m.instance = nil
	}
	if m.forwarded != 0 && m.opt.Upnp != nil {
		m.opt.Upnp.ClosePort(m.forwarded)
	}
	m.forwarded = 0
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

// HandleStatus tells a signed in user how to connect.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, UserStatus{
		Running:     m.IsEnabled(),
		Port:        m.Port(),
		Username:    username,
		Fingerprint: m.hostKeyFingerprint(),
		ReadOnly:    m.readOnly(),
	})
}

// HandleConfig reads or changes the settings, and is for admins.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		m.mu.Lock()
		config := AdminConfig{
			Running:       m.instance != nil,
			Port:          m.Port(),
			UpnpAvailable: m.opt.Upnp != nil,
			Upnp:          m.upnpEnabled(),
			AllowPublic:   m.allowPublic(),
			ReadOnly:      m.readOnly(),
			LastError:     m.lastError,
		}
		m.mu.Unlock()
		config.Fingerprint = m.hostKeyFingerprint()
		sendJSON(w, config)
		return
	}

	port, err := strconv.Atoi(postOnly(r, "port"))
	if err != nil || port < 1 || port > 65535 {
		utils.SendErrorResponse(w, "The port must be a number from 1 to 65535")
		return
	}
	upnpOn := postOnly(r, "upnp") == "true"
	public := postOnly(r, "public") != "false"
	readOnly := postOnly(r, "readonly") == "true"

	m.mu.Lock()
	defer m.mu.Unlock()
	m.opt.Sysdb.Write(settingsTable, "port", port)
	m.opt.Sysdb.Write(settingsTable, "upnp", upnpOn)
	m.opt.Sysdb.Write(settingsTable, "public", public)
	m.opt.Sysdb.Write(settingsTable, "readonly", readOnly)
	logger.PrintAndLog(logTitle, "SFTP settings changed", nil)

	restarted := false
	if m.instance != nil {
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
	instance := m.instance
	m.mu.Unlock()
	clients := []sftpserver.ClientInfo{}
	if instance != nil {
		clients = instance.Clients()
	}
	sendJSON(w, clients)
}

/*
Functions requested by the file server service router
*/
func (m *Manager) ServerToggle(enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !enabled {
		m.stop()
		m.lastError = ""
		return m.opt.Sysdb.Write(settingsTable, "enabled", false)
	}
	if m.instance != nil {
		return nil
	}
	if err := m.start(); err != nil {
		return err
	}
	return m.opt.Sysdb.Write(settingsTable, "enabled", true)
}

func (m *Manager) IsEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.instance != nil && !m.instance.IsClosed()
}

// Close stops the server without changing whether it starts on boot.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stop()
}

func (m *Manager) GetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	return []*fileservers.Endpoint{{
		ProtocolName: "sftp://",
		Port:         m.Port(),
		Subpath:      "",
	}}
}
