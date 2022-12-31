package sftpserv

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/storage/sftpserver"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

type ManagerOption struct {
	Hostname    string
	UserManager *user.UserHandler
	KeyFile     string
	Logger      *logger.Logger
	Sysdb       *database.Database
	Upnp        *upnp.UPnPClient
}

type Manager struct {
	listeningPort int
	instance      *sftpserver.Instance
	option        *ManagerOption
}

func NewSFTPServer(option *ManagerOption) *Manager {
	option.Sysdb.NewTable("sftp")

	i, lp, _ := newSFTPServerInstance(option)

	return &Manager{
		listeningPort: lp,
		instance:      i,
		option:        option,
	}
}

func newSFTPServerInstance(option *ManagerOption) (*sftpserver.Instance, int, error) {
	//Load default port from database
	defaultListeningPort := 2022
	if option.Sysdb.KeyExists("sftp", "port") {
		option.Sysdb.Read("sftp", "port", &defaultListeningPort)
	}

	//Create an SFTP Server
	var currentConfig = sftpserver.SFTPConfig{
		ListeningIP: "0.0.0.0:" + strconv.Itoa(defaultListeningPort),
		KeyFile:     option.KeyFile,
		UserManager: option.UserManager,
	}

	enableUPnP := getUpnPEnabled(option.Sysdb)
	if enableUPnP && option.Upnp != nil {
		option.Upnp.ForwardPort(defaultListeningPort, option.Hostname+" sftp-service")
	}

	enableOnStart := false
	option.Sysdb.Read("sftp", "enabled", &enableOnStart)
	if enableOnStart {
		i, err := sftpserver.NewSFTPServer(&currentConfig)
		return i, defaultListeningPort, err
	} else {
		return nil, defaultListeningPort, nil
	}
}

func (m *Manager) closeInstance() {
	//Close the instance
	m.instance.Close()
	m.instance = nil

	//Remove the UPNP rules if enabled
	enableUPnP := getUpnPEnabled(m.option.Sysdb)

	if enableUPnP && m.option.Upnp != nil {
		m.option.Upnp.ClosePort(m.listeningPort)
	}
}

/*
	Handlers for handling config change
*/

// Get or Set listening port for SFTP
func (m *Manager) HandleListeningPort(w http.ResponseWriter, r *http.Request) {
	newport, _ := utils.PostPara(r, "port")
	if newport == "" {
		//Resp with the current operating port
		js, _ := json.Marshal(m.listeningPort)
		utils.SendJSONResponse(w, string(js))
	} else {
		portInt, err := strconv.Atoi(newport)
		if err != nil {
			utils.SendErrorResponse(w, "invalid port number given")
			return
		}

		err = m.option.Sysdb.Write("sftp", "port", portInt)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Update the temp port buffer
		m.listeningPort = portInt

		if m.IsEnabled() {
			//Restart the services
			m.ServerToggle(false)
			time.Sleep(300 * time.Microsecond)
			m.ServerToggle(true)
		}

		utils.SendOK(w)
	}

}

func getUpnPEnabled(sysdb *database.Database) bool {
	enableUPnP := false
	if sysdb.KeyExists("sftp", "upnp") {
		sysdb.Read("sftp", "upnp", &enableUPnP)
	}

	return enableUPnP
}

func (m *Manager) HandleGetConnectedClients(w http.ResponseWriter, r *http.Request) {
	userCount := 0
	if m.IsEnabled() {
		m.instance.ConnectedClients.Range(func(k, v interface{}) bool {
			userCount++
			return true
		})
	}

	js, _ := json.Marshal(userCount)
	utils.SendJSONResponse(w, string(js))
}

func (m *Manager) HandleToogleUPnP(w http.ResponseWriter, r *http.Request) {
	enableUpnp, _ := utils.PostPara(r, "enabled")
	if enableUpnp == "" {
		//Get the current state of Upnp
		currentEnabled := getUpnPEnabled(m.option.Sysdb)
		js, _ := json.Marshal(currentEnabled)
		utils.SendJSONResponse(w, string(js))
	} else if enableUpnp == "true" {
		//Enable UpnP
		m.option.Sysdb.Write("sftp", "upnp", true)

		if m.IsEnabled() {
			//Restart the services
			m.ServerToggle(false)
			time.Sleep(300 * time.Microsecond)
			m.ServerToggle(true)
		}

		utils.SendOK(w)
	} else if enableUpnp == "false" {
		//Disable UpnP
		m.option.Sysdb.Write("sftp", "upnp", false)

		if m.IsEnabled() {
			//Restart the services
			m.ServerToggle(false)
			time.Sleep(300 * time.Microsecond)
			m.ServerToggle(true)
		}

		//Remove UPnP forwarded port
		m.option.Upnp.ClosePort(m.listeningPort)

		utils.SendOK(w)
	} else {
		utils.SendErrorResponse(w, "unknown operation")
	}
}

/*
Functions requested by the file server service router
*/
func (m *Manager) ServerToggle(enabled bool) error {
	if m.instance != nil && !enabled {
		//Shutdown the running instances
		m.closeInstance()
		m.option.Sysdb.Write("sftp", "enabled", false)
	} else if m.instance == nil && enabled {
		//Startup a new instance
		m.option.Sysdb.Write("sftp", "enabled", true)
		i, lp, err := newSFTPServerInstance(m.option)
		if err != nil {
			m.option.Sysdb.Write("sftp", "enabled", false)
			return err
		}
		m.listeningPort = lp
		m.instance = i
	}
	return nil
}

func (m *Manager) IsEnabled() bool {
	return m.instance != nil && !m.instance.Closed
}

func (m *Manager) GetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	eps := []*fileservers.Endpoint{}
	eps = append(eps, &fileservers.Endpoint{
		ProtocolName: "sftp://",
		Port:         m.listeningPort,
		Subpath:      "",
	})
	return eps
}
