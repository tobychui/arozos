package tftpserv

import (
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/tftp"
	user "imuslab.com/arozos/mod/user"
)

type ServerStatus struct {
	Enabled     bool
	Port        int
	DefaultUser string
	UserGroups  []string
}

type ManagerOption struct {
	Hostname    string
	TmpFolder   string
	Logger      *logger.Logger
	UserManager *user.UserHandler
	TftpServer  *tftp.Handler
	Sysdb       *database.Database
}

type Manager struct {
	option ManagerOption
}

// Create a new TFTP Manager
func NewTFTPManager(option *ManagerOption) *Manager {
	//Create database related tables
	option.Sysdb.NewTable("tftp")
	defaultEnable := false
	if option.Sysdb.KeyExists("tftp", "default") {
		option.Sysdb.Read("tftp", "default", &defaultEnable)
	} else {
		option.Sysdb.Write("tftp", "default", false)
	}

	//Create the Manager object
	manager := Manager{
		option: *option,
	}

	//Enable this service
	if defaultEnable {
		manager.StartTftpServer()
	}

	return &manager
}

func (m *Manager) StartTftpServer() error {
	if m.option.TftpServer != nil {
		//If the previous tftp server is not closed, close it and open a new one
		m.option.TftpServer.Close()
	}

	//Load new server config from database
	serverPort := int(69)
	if m.option.Sysdb.KeyExists("tftp", "port") {
		m.option.Sysdb.Read("tftp", "port", &serverPort)
	}

	//Create a new TFTP Handler
	h, err := tftp.NewTFTPHandler(m.option.UserManager, m.option.Hostname, serverPort, m.option.TmpFolder)
	if err != nil {
		return err
	}
	h.Start()
	m.option.TftpServer = h

	//Remember the TFTP server status
	m.option.Sysdb.Write("tftp", "default", true)

	return nil
}

func (m *Manager) StopTftpServer() {
	if m.option.TftpServer != nil {
		m.option.TftpServer.Close()
	}

	m.option.Sysdb.Write("tftp", "default", false)
	m.option.Logger.PrintAndLog("TFTP", "TFTP Server Stopped", nil)
}

func (m *Manager) GetTftpServerStatus() (*ServerStatus, error) {
	enabled := false
	if m.option.TftpServer != nil && m.option.TftpServer.ServerRunning {
		enabled = true
	}

	serverPort := 69
	if m.option.Sysdb.KeyExists("tftp", "port") {
		m.option.Sysdb.Read("tftp", "port", &serverPort)
	}

	userGroups := []string{}
	if m.option.Sysdb.KeyExists("tftp", "groups") {
		m.option.Sysdb.Read("tftp", "groups", &userGroups)
	}

	defaultUser := ""
	if m.option.Sysdb.KeyExists("tftp", "defaultUser") {
		m.option.Sysdb.Read("tftp", "defaultUser", &defaultUser)
	}

	currentStatus := ServerStatus{
		Enabled:     enabled,
		Port:        serverPort,
		DefaultUser: defaultUser,
		UserGroups:  userGroups,
	}
	return &currentStatus, nil
}

func (m *Manager) IsTftpServerEnabled() bool {
	return m.option.TftpServer != nil && m.option.TftpServer.ServerRunning
}

func (m *Manager) TFTPServerToggle(enabled bool) error {
	if m.option.TftpServer != nil && m.option.TftpServer.ServerRunning {
		//Enabled
		if !enabled {
			//Shut it down
			m.StopTftpServer()
		}
	} else if enabled {
		//Startup TFTP Server
		return m.StartTftpServer()
	}
	return nil
}

func (m *Manager) TFTPGetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	tftpEndpoints := []*fileservers.Endpoint{}
	port := 69
	if m.option.TftpServer != nil {
		port = m.option.TftpServer.Port
	}
	tftpEndpoints = append(tftpEndpoints, &fileservers.Endpoint{
		ProtocolName: "tftp://",
		Port:         port,
		Subpath:      "",
	})
	return tftpEndpoints
}
