package webdavserv

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	awebdav "imuslab.com/arozos/mod/storage/webdav"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
Handler for WebDAV
*/
type ManagerOption struct {
	Sysdb       *database.Database
	Hostname    string
	TmpDir      string
	Port        int
	UseTls      bool
	UserHandler *user.UserHandler
}
type Manager struct {
	WebDavHandler *awebdav.Server
	option        *ManagerOption
}

// Create a new WebDAV Manager for handling related requests
func NewWebDAVManager(option *ManagerOption) (out0 *Manager) {
	defer logger.Out1(logger.In1("fileservers/servers/webdavserv", "NewWebDAVManager", "option", option), &out0)
	m := Manager{
		option: option,
	}
	//Create a database table for webdav service
	m.option.Sysdb.NewTable("webdav")

	//Create a new webdav server
	newserver := awebdav.NewServer(m.option.Hostname, "/webdav", m.option.TmpDir, m.option.UseTls, m.option.UserHandler)
	m.WebDavHandler = newserver

	//Check the webdav default state
	enabled := false
	if m.option.Sysdb.KeyExists("webdav", "enabled") {
		m.option.Sysdb.Read("webdav", "enabled", &enabled)
	}

	m.WebDavHandler.Enabled = enabled

	return &m
}

func (m *Manager) HandleStatusChange(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/webdavserv", "Manager.HandleStatusChange", "m", m, "r", r))
	//Show status for every user, only allow change if admin
	userinfo, _ := m.option.UserHandler.GetUserInfoFromRequest(w, r)
	isAdmin := userinfo.IsAdmin()

	set, _ := utils.GetPara(r, "set")
	if set == "" {
		//Return the current status
		results := []bool{m.WebDavHandler.Enabled, isAdmin}
		js, _ := json.Marshal(results)
		utils.SendJSONResponse(w, string(js))
	} else if isAdmin && set == "disable" {
		m.WebDavHandler.Enabled = false
		m.option.Sysdb.Write("webdav", "enabled", false)
		utils.SendOK(w)
	} else if isAdmin && set == "enable" {
		m.WebDavHandler.Enabled = true
		m.option.Sysdb.Write("webdav", "enabled", true)
		utils.SendOK(w)
	} else {
		utils.SendErrorResponse(w, "Permission Denied")
	}
}

/*
Functions required by new service mounting infrastructure
*/
func (m *Manager) WebDavToogle(enabled bool) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/webdavserv", "Manager.WebDavToogle", "m", m, "enabled", enabled), &out0)
	m.WebDavHandler.Enabled = enabled
	m.option.Sysdb.Write("webdav", "enabled", enabled)
	return nil
}

func (m *Manager) WebDavGetEndpoints(userinfo *user.User) (out0 []*fileservers.Endpoint) {
	defer logger.Out1(logger.In2("fileservers/servers/webdavserv", "Manager.WebDavGetEndpoints", "m", m, "userinfo", userinfo), &out0)
	protocolName := "http://"
	if m.option.UseTls {
		protocolName = "https://"
	}
	//One endpoint for every storage, which shows up as a folder in its root
	return []*fileservers.Endpoint{
		{
			ProtocolName: protocolName,
			Port:         m.option.Port,
			Subpath:      "/webdav/",
		},
	}
}

func (m *Manager) GetWebDavEnabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/webdavserv", "Manager.GetWebDavEnabled", "m", m), &out0)
	return m.WebDavHandler.Enabled
}

// Mapper of the original Connection related features
func (m *Manager) HandleConnectionList(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/webdavserv", "Manager.HandleConnectionList", "m", m, "r", r))
	m.WebDavHandler.HandleConnectionList(w, r)
}

func (m *Manager) HandlePermissionEdit(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/webdavserv", "Manager.HandlePermissionEdit", "m", m, "r", r))
	m.WebDavHandler.HandlePermissionEdit(w, r)
}

func (m *Manager) HandleClearAllPending(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/webdavserv", "Manager.HandleClearAllPending", "m", m, "r", r))
	m.WebDavHandler.HandleClearAllPending(w, r)
}
func (m *Manager) HandleRequest(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("fileservers/servers/webdavserv", "Manager.HandleRequest", "m", m, "r", r))
	m.WebDavHandler.HandleRequest(w, r)
}
