package ftpserv

import (
	"errors"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	upnp "imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/storage/ftp"
	user "imuslab.com/arozos/mod/user"
)

type ServerStatus struct {
	Enabled        bool
	Port           int
	AllowUpnp      bool
	UPNPEnabled    bool
	FTPUPNPEnabled bool
	PublicAddr     string
	PassiveMode    bool
	UserGroups     []string
}

type ManagerOption struct {
	Hostname    string
	TmpFolder   string
	Logger      *logger.Logger
	UserManager *user.UserHandler
	FtpServer   *ftp.Handler
	Sysdb       *database.Database
	Upnp        *upnp.UPnPClient
	AllowUpnp   bool
}

type Manager struct {
	option ManagerOption
}

// Create a new FTP Manager
func NewFTPManager(option *ManagerOption) *Manager {
	//Create database related tables
	option.Sysdb.NewTable("ftp")
	defaultEnable := false
	if option.Sysdb.KeyExists("ftp", "default") {
		option.Sysdb.Read("ftp", "default", &defaultEnable)
	} else {
		option.Sysdb.Write("ftp", "default", false)
	}

	//Create the Manager object
	manager := Manager{
		option: *option,
	}

	//Enable this service
	if defaultEnable {
		manager.StartFtpServer()
	}

	return &manager
}

func (m *Manager) StartFtpServer() error {
	if m.option.FtpServer != nil {
		//If the previous ftp server is not closed, close it and open a new one
		if m.option.FtpServer.UPNPEnabled && m.option.Upnp != nil {
			m.option.Upnp.ClosePort(m.option.FtpServer.Port)
		}
		m.option.FtpServer.Close()
	}

	//Load new server config from database
	serverPort := int(21)
	if m.option.Sysdb.KeyExists("ftp", "port") {
		m.option.Sysdb.Read("ftp", "port", &serverPort)
	}

	enableUpnp := false
	if m.option.Sysdb.KeyExists("ftp", "Upnp") {
		m.option.Sysdb.Read("ftp", "Upnp", &enableUpnp)
	}

	forcePassiveMode := false
	m.option.Sysdb.Read("ftp", "passive", &forcePassiveMode)

	//Create a new FTP Handler
	passiveModeIP := ""
	if m.option.AllowUpnp && enableUpnp {
		//Using External IP address from the Upnp router reply
		externalIP := m.option.Upnp.ExternalIP
		if externalIP != "" {
			passiveModeIP = externalIP
		}
	} else if forcePassiveMode {
		//Not allowing Upnp but still use passive mode (aka manual port forward)
		externalIP := ""
		if m.option.Sysdb.KeyExists("ftp", "publicip") {
			m.option.Sysdb.Read("ftp", "publicip", &externalIP)
		}
		passiveModeIP = externalIP
	}

	h, err := ftp.NewFTPHandler(m.option.UserManager, m.option.Hostname, serverPort, m.option.TmpFolder, passiveModeIP)
	if err != nil {
		return err
	}
	h.Start()
	m.option.FtpServer = h

	if m.option.AllowUpnp {
		if enableUpnp {
			if m.option.Upnp == nil {
				return errors.New("Upnp did not started correctly on this host. Ignore this option")
			} else {
				//Forward the port
				err := m.option.Upnp.ForwardPort(m.option.FtpServer.Port, m.option.Hostname+" FTP Server")
				if err != nil {
					m.option.Logger.PrintAndLog("FTP", "Failed to start FTP Server Upnp ", err)
					m.option.FtpServer.UPNPEnabled = false
					return err
				} else {
					//Forward other data ports
					m.option.Upnp.ForwardPort(m.option.FtpServer.Port+1, m.option.Hostname+" FTP Data 1")
					m.option.Upnp.ForwardPort(m.option.FtpServer.Port+2, m.option.Hostname+" FTP Data 2")
					m.option.FtpServer.UPNPEnabled = true
				}
				return nil
			}

		} else {
			//Upnp disabled
			if m.option.Upnp == nil {
				return errors.New("Upnp did not started correctly on this host. Ignore this option")
			} else {
				m.option.Upnp.ClosePort(m.option.FtpServer.Port)
				m.option.Upnp.ClosePort(m.option.FtpServer.Port + 1)
				m.option.Upnp.ClosePort(m.option.FtpServer.Port + 2)

				m.option.FtpServer.UPNPEnabled = false
			}
		}
	}

	//Remember the FTP server status
	m.option.Sysdb.Write("ftp", "default", true)

	return nil
}

func (m *Manager) StopFtpServer() {
	if m.option.FtpServer != nil {
		m.option.FtpServer.Close()
	}

	m.option.Sysdb.Write("ftp", "default", false)
	m.option.Logger.PrintAndLog("FTP", "FTP Server Stopped", nil)
}

func (m *Manager) GetFtpServerStatus() (*ServerStatus, error) {
	enabled := false
	if m.option.FtpServer != nil && m.option.FtpServer.ServerRunning {
		enabled = true
	}

	serverPort := 21
	if m.option.Sysdb.KeyExists("ftp", "port") {
		m.option.Sysdb.Read("ftp", "port", &serverPort)
	}

	enableUpnp := false
	if m.option.Sysdb.KeyExists("ftp", "Upnp") {
		m.option.Sysdb.Read("ftp", "Upnp", &enableUpnp)
	}

	userGroups := []string{}
	if m.option.Sysdb.KeyExists("ftp", "groups") {
		m.option.Sysdb.Read("ftp", "groups", &userGroups)
	}

	ftpUpnp := false
	if m.option.FtpServer != nil && m.option.FtpServer.UPNPEnabled {
		ftpUpnp = true
	}

	publicAddr := ""
	if m.option.Upnp != nil && m.option.Upnp.ExternalIP != "" && ftpUpnp == true {
		publicAddr = m.option.Upnp.ExternalIP
	} else {
		manualPublicIpEntry := ""
		if m.option.Sysdb.KeyExists("ftp", "publicip") {
			m.option.Sysdb.Read("ftp", "publicip", &manualPublicIpEntry)
		}

		publicAddr = manualPublicIpEntry
	}

	forcePassiveMode := false
	if ftpUpnp == true {
		forcePassiveMode = true
	} else {
		if m.option.Sysdb.KeyExists("ftp", "passive") {
			m.option.Sysdb.Read("ftp", "passive", &forcePassiveMode)
		}

		if forcePassiveMode {
			//Read the ip setting from database
			manualPublicIpEntry := ""
			if m.option.Sysdb.KeyExists("ftp", "publicip") {
				m.option.Sysdb.Read("ftp", "publicip", &manualPublicIpEntry)
			}

			publicAddr = manualPublicIpEntry
		}
	}

	currnetStatus := ServerStatus{
		Enabled:        enabled,
		Port:           serverPort,
		AllowUpnp:      m.option.AllowUpnp,
		UPNPEnabled:    enableUpnp,
		FTPUPNPEnabled: ftpUpnp,
		PublicAddr:     publicAddr,
		UserGroups:     userGroups,
		PassiveMode:    forcePassiveMode,
	}
	return &currnetStatus, nil
}

func (m *Manager) IsFtpServerEnabled() bool {
	return m.option.FtpServer != nil && m.option.FtpServer.ServerRunning
}

func (m *Manager) FTPServerToggle(enabled bool) error {
	if m.option.FtpServer != nil && m.option.FtpServer.ServerRunning {
		//Enabled
		if !enabled {
			//Shut it down
			m.StopFtpServer()
		}
	} else if enabled {
		//Startup FTP Server
		return m.StartFtpServer()
	}
	return nil
}

func (m *Manager) FTPGetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	ftpEndpoints := []*fileservers.Endpoint{}
	port := 21
	if m.option.FtpServer != nil {
		port = m.option.FtpServer.Port
	}
	ftpEndpoints = append(ftpEndpoints, &fileservers.Endpoint{
		ProtocolName: "ftp://",
		Port:         port,
		Subpath:      "",
	})
	return ftpEndpoints
}
