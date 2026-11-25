// Package smbserv connects the built in SMB server to the file server list:
// settings, starting and stopping, and the per user activation.
package smbserv

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"imuslab.com/arozos/mod/filesystem"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tobychui/smbsrv"
	"imuslab.com/arozos/mod/auth/explogin"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/aroz"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

const (
	logTitle      = "SMB"
	settingsTable = "smbserv"

	//The only port Windows Explorer can dial
	DefaultPort = 445

	minPasswordLength = 8
	maxPasswordLength = 127
)

// ManagerOption wires the manager to the rest of the system.
type ManagerOption struct {
	ServerName string
	DNSName    string
	DeviceID   string //Keeps the server's identity stable across restarts
	Sysdb      *database.Database
	SecretDir  string //Where the credential key file lives
	CaptureDir string //Debug capture, off when empty

	//DisplayName is shown in the macOS Finder sidebar. AllowMDNS follows the
	//-allow_mdns flag, and NoWSD keeps the Windows Network view out (tests)
	DisplayName string
	AllowMDNS   bool
	NoWSD       bool

	//Trash moves a deleted file into the trash bin, as aroz.Options.Trash
	Trash    func(fsh *filesystem.FileSystemHandler, subpath, rpath, username string) error
	StageDir string //Local copies of files on cloud and remote drives
	KeepDir  string //Copies whose upload failed, kept across restarts

	//CurrentUser returns who made a web request
	CurrentUser func(w http.ResponseWriter, r *http.Request) (string, error)

	//ConfirmPassword checks the login password in the request, and writes the
	//refusal itself when it is wrong
	ConfirmPassword func(w http.ResponseWriter, r *http.Request) bool

	//LookupUser, Capacity, AllowIP and LogAuth are as in aroz.Options
	LookupUser func(username string) (aroz.Account, aroz.Quota, error)
	Capacity   aroz.CapacityFunc
	AllowIP    func(ip string) bool
	LogAuth    func(username, remote string, ok bool)

	//UserExists reports an ArozOS account
	UserExists func(username string) bool

	//PortConflict names another service on the default port, if one is running
	PortConflict func() string

	//SambaHashes is optional, and offers an import when Samba is here
	SambaHashes func() (map[string][]byte, error)
}

// Manager runs the server.
type Manager struct {
	opt    *ManagerOption
	creds  *aroz.CredentialDB
	delays *explogin.ExpLoginHandler

	mu           sync.Mutex
	server       *smbsrv.Server
	announcer    *announcer
	lastError    string
	lastErrorKey string
}

// NewManager prepares the manager and starts the server if it was left on.
func NewManager(opt *ManagerOption) (out0 *Manager, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/smbserv", "NewManager", "opt", opt), &out0, &out1)
	if err := opt.Sysdb.NewTable(settingsTable); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		return nil, err
	}
	creds, err := aroz.OpenCredentialDB(opt.Sysdb, opt.SecretDir)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		return nil, err
	}
	m := &Manager{
		opt:    opt,
		creds:  creds,
		delays: explogin.NewExponentialLoginHandler(2, 30),
	}
	if m.savedEnabled() {
		if err := m.ServerToggle(true); err != nil {
			logger.DebugErr("fileservers/servers/smbserv", err)
			//The choice is kept: the port may be free again at the next boot
			logger.PrintAndLog(logTitle, "The SMB server could not start", err)
			m.opt.Sysdb.Write(settingsTable, "enabled", true)
		}
	}
	return m, nil
}

func (m *Manager) savedEnabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.savedEnabled", "m", m), &out0)
	enabled := false
	if m.opt.Sysdb.KeyExists(settingsTable, "enabled") {
		m.opt.Sysdb.Read(settingsTable, "enabled", &enabled)
	}
	return enabled
}

// Port returns the configured port.
func (m *Manager) Port() (out0 int) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.Port", "m", m), &out0)
	port := DefaultPort
	if m.opt.Sysdb.KeyExists(settingsTable, "port") {
		m.opt.Sysdb.Read(settingsTable, "port", &port)
	}
	return port
}

// allowShortPasswords lifts the 8 character minimum of SMB passwords. Off by
// default: SMB keeps the password as an NT hash, which a short password does
// not survive if it is ever taken. Passwords already set are not touched when
// the minimum comes back.
func (m *Manager) allowShortPasswords() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.allowShortPasswords", "m", m), &out0)
	allow := false
	if m.opt.Sysdb.KeyExists(settingsTable, "shortpw") {
		m.opt.Sysdb.Read(settingsTable, "shortpw", &allow)
	}
	return allow
}

// minPasswordLength is the shortest SMB password a user may set now.
func (m *Manager) minPasswordLength() (out0 int) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.minPasswordLength", "m", m), &out0)
	if m.allowShortPasswords() {
		return 1
	}
	return minPasswordLength
}

func (m *Manager) allowPublic() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.allowPublic", "m", m), &out0)
	allow := false
	if m.opt.Sysdb.KeyExists(settingsTable, "public") {
		m.opt.Sysdb.Read(settingsTable, "public", &allow)
	}
	return allow
}

// requireEncryption refuses clients that cannot encrypt. On by default, the
// setting Windows 10 and 11 connect with out of the box; turning it off lets
// SMB 2.1 clients in at the cost of sending files in the clear.
func (m *Manager) requireEncryption() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.requireEncryption", "m", m), &out0)
	on := true
	if m.opt.Sysdb.KeyExists(settingsTable, "encrypt") {
		m.opt.Sysdb.Read(settingsTable, "encrypt", &on)
	}
	return on
}

// useTrash sends deletes to the trash bin. On by default, so a delete from
// Explorer can be undone from the web desktop, even though Explorer warns
// that a delete on a network drive is permanent.
func (m *Manager) useTrash() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.useTrash", "m", m), &out0)
	if m.opt.Trash == nil {
		return false
	}
	on := true
	if m.opt.Sysdb.KeyExists(settingsTable, "trash") {
		m.opt.Sysdb.Read(settingsTable, "trash", &on)
	}
	return on
}

// DefaultStageLimitMB is the largest file of a cloud or remote drive served
// until an admin changes it.
const DefaultStageLimitMB = aroz.DefaultStageLimit >> 20

// stageLimitMB is the setting as the page shows it. Zero means no limit.
func (m *Manager) stageLimitMB() (out0 int64) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.stageLimitMB", "m", m), &out0)
	mb := int64(DefaultStageLimitMB)
	if m.opt.Sysdb.KeyExists(settingsTable, "stagelimit") {
		m.opt.Sysdb.Read(settingsTable, "stagelimit", &mb)
	}
	return mb
}

func (m *Manager) stageLimit() (out0 int64) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.stageLimit", "m", m), &out0)
	mb := m.stageLimitMB()
	if mb <= 0 {
		return -1
	}
	return mb << 20
}

func (m *Manager) backend() (out0 *aroz.Backend, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/smbserv", "Manager.backend", "m", m), &out0, &out1)
	return aroz.New(aroz.Options{
		Credentials:          m.creds,
		LookupUser:           m.opt.LookupUser,
		Capacity:             m.opt.Capacity,
		AllowIP:              m.opt.AllowIP,
		LogAuth:              m.opt.LogAuth,
		FailureDelay:         m.failureDelay,
		AllowPublicAddresses: m.allowPublic(),
		StageDir:             m.opt.StageDir,
		KeepDir:              m.opt.KeepDir,
		StageLimit:           m.stageLimit,
		UseTrash:             m.useTrash,
		Trash:                m.opt.Trash,
		TimeMachine:          m.timeMachinePick,
	})
}

// failureDelay grows the wait for wrong passwords on a real account. A name
// with no SMB password is left at the flat delay: Windows tries the signed in
// user on every new connection before anything else, and that must not make
// connecting slower and slower.
func (m *Manager) failureDelay(username, remote string, ok bool) (out0 time.Duration) {
	defer logger.Out1(logger.In4("fileservers/servers/smbserv", "Manager.failureDelay", "m", m, "username", username, "remote", remote, "ok", ok), &out0)
	request := &http.Request{RemoteAddr: remote, Header: http.Header{}}
	if ok {
		m.delays.ResetUserRetryCount(username, request)
		return 0
	}
	if username == "" || !m.creds.Has(username) {
		return 0
	}
	m.delays.AddUserRetrycount(username, request)
	_, wait := m.delays.AllowImmediateAccess(username, request)
	return time.Duration(wait) * time.Second
}

// startError is a failure the settings page can put in the user's language.
type startError struct {
	key  string
	text string
}

func (e *startError) Error() string {
	logger.DebugTrace("fileservers/servers/smbserv", "startError.Error")
	return e.text
}

// bindError turns a failure to listen into something an admin can act on.
func bindError(port int, err error) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "bindError", "port", port, "err", err), &out0)
	text := strings.ToLower(err.Error())
	switch {
	case runtime.GOOS == "windows" && port == DefaultPort:
		return &startError{"windows", "Windows keeps port 445 for itself. Use another port, which only Windows 11 24H2 and newer clients can reach"}
	case strings.Contains(text, "address already in use"), strings.Contains(text, "only one usage"):
		return &startError{"port_in_use", fmt.Sprintf("Port %d is already in use by another program. On Linux that is usually Samba, and on macOS File Sharing", port)}
	case strings.Contains(text, "permission denied"), strings.Contains(text, "access permissions"):
		return &startError{"no_permission", fmt.Sprintf("ArozOS has no permission to use port %d. Run it as root, or give it the cap_net_bind_service capability", port)}
	}
	return err
}

// recordError keeps a failure for the settings page. The caller holds m.mu.
func (m *Manager) recordError(err error) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.recordError", "m", m, "err", err))
	m.lastError, m.lastErrorKey = "", ""
	if err == nil {
		return
	}
	m.lastError = err.Error()
	var known *startError
	if errors.As(err, &known) {
		m.lastErrorKey = known.key
	}
}

// start brings the server up. The caller holds m.mu.
func (m *Manager) start() (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.start", "m", m), &out0)
	port := m.Port()
	if port == DefaultPort && m.opt.PortConflict != nil {
		if other := m.opt.PortConflict(); other != "" {
			return &startError{"conflict", fmt.Sprintf("%s is running and holds port %d. Only one of them can run at a time", other, port)}
		}
	}
	backend, err := m.backend()
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		return err
	}
	var guid [16]byte
	sum := sha256.Sum256([]byte("arozos-smb-" + m.opt.DeviceID))
	copy(guid[:], sum[:])

	server, err := smbsrv.New(smbsrv.Config{
		Address:    ":" + strconv.Itoa(port),
		ServerName: m.opt.ServerName,
		DNSName:    m.opt.DNSName,
		GUID:       guid,
		Backend:    backend,
		Logger:     logger.NewSlog(logTitle),
		CaptureDir: m.opt.CaptureDir,

		RequireEncryption: m.requireEncryption(),
		Apple:             m.appleOn(),
	})
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		return err
	}
	if err := server.Start(); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		server.Close()
		return bindError(port, err)
	}
	m.server = server
	m.announcer = m.announce(port)
	return nil
}

// stopServer ends the server and its announcements. The caller holds m.mu.
func (m *Manager) stopServer() (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.stopServer", "m", m), &out0)
	m.announcer.stop()
	m.announcer = nil
	if m.server == nil {
		return nil
	}
	err := m.server.Close()
	m.server = nil
	return err
}

// ServerToggle implements fileservers.Server.
func (m *Manager) ServerToggle(enabled bool) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "Manager.ServerToggle", "m", m, "enabled", enabled), &out0)
	m.mu.Lock()
	defer m.mu.Unlock()
	if enabled == (m.server != nil) {
		return nil
	}
	if !enabled {
		err := m.stopServer()
		m.recordError(nil)
		m.opt.Sysdb.Write(settingsTable, "enabled", false)
		return err
	}
	if err := m.start(); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		m.recordError(err)
		m.opt.Sysdb.Write(settingsTable, "enabled", false)
		return err
	}
	m.recordError(nil)
	return m.opt.Sysdb.Write(settingsTable, "enabled", true)
}

// IsEnabled implements fileservers.Server.
func (m *Manager) IsEnabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.IsEnabled", "m", m), &out0)
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.server != nil
}

// HoldsDefaultPort reports whether this server stands in the way of Samba.
func (m *Manager) HoldsDefaultPort() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.HoldsDefaultPort", "m", m), &out0)
	return m.IsEnabled() && m.Port() == DefaultPort
}

// GetEndpoints implements fileservers.Server.
func (m *Manager) GetEndpoints(userinfo *user.User) (out0 []*fileservers.Endpoint) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "Manager.GetEndpoints", "m", m, "userinfo", userinfo), &out0)
	port := m.Port()
	if port == DefaultPort {
		port = 0 //Every client assumes it, and an address with it may not parse
	}
	return []*fileservers.Endpoint{{ProtocolName: "smb://", Port: port}}
}

// Close stops the server without changing the setting.
func (m *Manager) Close() {
	defer logger.Out0(logger.In1("fileservers/servers/smbserv", "Manager.Close", "m", m))
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopServer()
}

func (m *Manager) dropUser(username string) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.dropUser", "m", m, "username", username))
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.server != nil {
		m.server.DropUser(username)
	}
}

func sendJSON(w http.ResponseWriter, value any) {
	defer logger.Out0(logger.In1("fileservers/servers/smbserv", "sendJSON", "value", value))
	js, err := json.Marshal(value)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(js))
}

// postOnly reads a form value from the body alone. A password must never be
// taken from a URL, where it would end up in logs and history.
func postOnly(r *http.Request, key string) (out0 string) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "postOnly", "r", r, "!key", key), &out0)
	if r.Method != http.MethodPost {
		return ""
	}
	r.ParseForm()
	return r.PostForm.Get(key)
}

// ShareRow is one drive a user can reach.
type ShareRow struct {
	Name    string
	Comment string
}

// UserStatus is what a user sees of the service.
type UserStatus struct {
	Running   bool
	Port      int
	Username  string
	Activated bool
	Shares    []ShareRow

	MinPasswordLength int //What the page checks before sending a password
}

// HandleStatus reports the service as the signed in user sees it.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleStatus", "m", m, "r", r))
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	status := UserStatus{
		Running:   m.IsEnabled(),
		Port:      m.Port(),
		Username:  username,
		Activated: m.creds.Has(username),
		Shares:    []ShareRow{},

		MinPasswordLength: m.minPasswordLength(),
	}
	if backend, err := m.backend(); err == nil {
		if view, err := backend.Login(username); err == nil {
			for _, s := range view.Shares() {
				status.Shares = append(status.Shares, ShareRow{Name: s.Name(), Comment: s.Comment()})
			}
		}
	}
	sendJSON(w, status)
}

// validPassword checks a new SMB password against the shortest length allowed.
// Even with the minimum lifted, a password cannot be empty.
func validPassword(password string, minLength int) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "validPassword", "minLength", minLength, "!password", password), &out0)
	if minLength < 1 {
		minLength = 1
	}
	switch {
	case password == "":
		return errors.New("The SMB password cannot be empty")
	case len(password) < minLength:
		return fmt.Errorf("The SMB password must be at least %d characters", minLength)
	case len(password) > maxPasswordLength:
		return fmt.Errorf("The SMB password must be at most %d characters", maxPasswordLength)
	}
	return nil
}

// HandleActivate sets the SMB password of the signed in user. The login
// password has to come with it, so that a browser left open cannot be used to
// open the account to the network.
func (m *Manager) HandleActivate(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleActivate", "m", m, "r", r))
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	password := postOnly(r, "smbpassword")
	if err := validPassword(password, m.minPasswordLength()); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if !m.opt.ConfirmPassword(w, r) {
		return
	}
	if err := m.creds.Set(username, password); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		logger.PrintAndLog(logTitle, "Could not store the SMB password of "+username, err)
		utils.SendErrorResponse(w, "The password could not be stored")
		return
	}
	//A session keeps working on the old password otherwise
	m.dropUser(username)
	logger.PrintAndLog(logTitle, "SMB password set for "+username, nil)
	utils.SendOK(w)
}

// HandleDeactivate removes the signed in user's SMB access.
func (m *Manager) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleDeactivate", "m", m, "r", r))
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.revoke(w, username)
}

func (m *Manager) revoke(w http.ResponseWriter, username string) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.revoke", "m", m, "username", username))
	if err := m.creds.Remove(username); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.dropUser(username)
	logger.PrintAndLog(logTitle, "SMB access removed for "+username, nil)
	utils.SendOK(w)
}

// AdminConfig is what the settings page shows.
type AdminConfig struct {
	Running        bool
	Port           int
	AllowPublic    bool
	Encrypt        bool
	Discover       bool
	Trash          bool
	ShortPasswords bool  //Users may set SMB passwords under 8 characters
	StageLimitMB   int64 //Zero is no limit
	Apple          bool  //macOS extensions and Time Machine
	TimeMachineGB  int64 //Most each user's backups may take, zero for no limit
	LastError      string
	LastErrorKey   string //Names the translation, empty for anything unexpected
	CanImport      bool
}

// HandleConfig reads or changes the settings.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleConfig", "m", m, "r", r))
	if r.Method != http.MethodPost {
		m.mu.Lock()
		config := AdminConfig{Running: m.server != nil, LastError: m.lastError, LastErrorKey: m.lastErrorKey}
		m.mu.Unlock()
		config.Port = m.Port()
		config.AllowPublic = m.allowPublic()
		config.StageLimitMB = m.stageLimitMB()
		config.Encrypt = m.requireEncryption()
		config.Discover = m.discoverable()
		config.Trash = m.useTrash()
		config.ShortPasswords = m.allowShortPasswords()
		config.Apple = m.appleOn()
		config.TimeMachineGB = m.timeMachineLimitGB()
		config.CanImport = m.opt.SambaHashes != nil
		sendJSON(w, config)
		return
	}

	port, err := strconv.Atoi(postOnly(r, "port"))
	if err != nil || port < 1 || port > 65535 {
		utils.SendErrorResponse(w, "The port must be a number from 1 to 65535")
		return
	}
	public := postOnly(r, "public") == "true"
	//Off unless the box is ticked, like public addresses
	shortPasswords := postOnly(r, "shortpw") == "true"
	//A form without a field keeps that setting's default (on)
	encrypt := postOnly(r, "encrypt") != "false"
	discover := postOnly(r, "discover") != "false"
	trash := postOnly(r, "trash") != "false"
	//Off unless ticked: macOS works without it, and it changes listings
	apple := postOnly(r, "apple") == "true"
	tmLimit := m.timeMachineLimitGB()
	if v := postOnly(r, "tmlimit"); v != "" {
		var ok bool
		if tmLimit, ok = parseTimeMachineLimit(v); !ok {
			utils.SendErrorResponse(w, "The Time Machine size limit must be a number of GB, or 0 for no limit")
			return
		}
	}
	stageLimit := m.stageLimitMB()
	if v := postOnly(r, "stagelimit"); v != "" {
		stageLimit, err = strconv.ParseInt(v, 10, 64)
		if err != nil || stageLimit < 0 || stageLimit > 1<<30 {
			utils.SendErrorResponse(w, "The file size limit must be a number of MB, or 0 for no limit")
			return
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	oldPort, oldPublic, oldEncrypt, oldApple := m.Port(), m.allowPublic(), m.requireEncryption(), m.appleOn()
	m.opt.Sysdb.Write(settingsTable, "port", port)
	m.opt.Sysdb.Write(settingsTable, "public", public)
	m.opt.Sysdb.Write(settingsTable, "encrypt", encrypt)
	m.opt.Sysdb.Write(settingsTable, "apple", apple)
	//Asked when a Mac asks for the free space, so it applies at once
	m.opt.Sysdb.Write(settingsTable, "tmlimit", tmLimit)
	//Asked on every open, so it applies without listening again
	m.opt.Sysdb.Write(settingsTable, "stagelimit", stageLimit)
	oldDiscover := m.discoverable()
	m.opt.Sysdb.Write(settingsTable, "discover", discover)
	//Asked on every delete, like the size limit
	m.opt.Sysdb.Write(settingsTable, "trash", trash)
	//Only asked when a password is set
	m.opt.Sysdb.Write(settingsTable, "shortpw", shortPasswords)
	if m.server == nil || (port == oldPort && public == oldPublic && encrypt == oldEncrypt && apple == oldApple) {
		if m.server != nil && discover != oldDiscover {
			m.announcer.stop()
			m.announcer = m.announce(port)
		}
		sendJSON(w, ConfigResult{Restarted: false})
		return
	}

	//Listening again is the only way to apply these. A port that fails puts
	//the old settings back, so one typo cannot take the service away.
	m.stopServer()
	if err := m.start(); err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		m.opt.Sysdb.Write(settingsTable, "port", oldPort)
		m.opt.Sysdb.Write(settingsTable, "public", oldPublic)
		m.opt.Sysdb.Write(settingsTable, "encrypt", oldEncrypt)
		m.opt.Sysdb.Write(settingsTable, "apple", oldApple)
		m.recordError(m.start())
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.recordError(nil)
	sendJSON(w, ConfigResult{Restarted: true})
}

// ConfigResult says whether saving had to disconnect the clients.
type ConfigResult struct {
	Restarted bool
}

// HandleClients lists who is connected.
func (m *Manager) HandleClients(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleClients", "m", m, "r", r))
	m.mu.Lock()
	server := m.server
	m.mu.Unlock()
	clients := []smbsrv.Client{}
	if server != nil {
		clients = server.Clients()
	}
	sendJSON(w, clients)
}

// HandleUsers lists who has enabled SMB.
func (m *Manager) HandleUsers(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleUsers", "m", m, "r", r))
	list, err := m.creds.List()
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, list)
}

// HandleRevoke removes a user's SMB access, and is for admins.
func (m *Manager) HandleRevoke(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleRevoke", "m", m, "r", r))
	username := postOnly(r, "username")
	if username == "" {
		utils.SendErrorResponse(w, "No user given")
		return
	}
	m.revoke(w, username)
}

// HandleImport takes over the passwords of Samba users, so that they need not
// set one again. A user who already has an SMB password keeps it.
func (m *Manager) HandleImport(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleImport", "m", m, "r", r))
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	if m.opt.SambaHashes == nil {
		utils.SendErrorResponse(w, "Samba is not installed on this host")
		return
	}
	hashes, err := m.opt.SambaHashes()
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	imported := 0
	for username, hash := range hashes {
		if !m.opt.UserExists(username) || m.creds.Has(username) {
			continue
		}
		if err := m.creds.SetHash(username, hash); err != nil {
			logger.DebugErr("fileservers/servers/smbserv", err)
			logger.PrintAndLog(logTitle, "Could not import "+username, err)
			continue
		}
		imported++
	}
	sendJSON(w, imported)
}
