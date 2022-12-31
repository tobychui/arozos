package webdavserv

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
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

//Create a new WebDAV Manager for handling related requests
func NewWebDAVManager(option *ManagerOption) *Manager {
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
func (m *Manager) WebDavToogle(enabled bool) error {
	m.WebDavHandler.Enabled = enabled
	m.option.Sysdb.Write("webdav", "enabled", enabled)
	return nil
}

func (m *Manager) WebDavGetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	eps := []*fileservers.Endpoint{}
	protocolName := "http://"
	if m.option.UseTls {
		protocolName = "https://"
	}
	for _, fsh := range userinfo.GetAllAccessibleFileSystemHandler() {
		eps = append(eps, &fileservers.Endpoint{
			ProtocolName: protocolName,
			Port:         m.option.Port,
			Subpath:      "/webdav/" + fsh.UUID,
		})
	}
	return eps
}

func (m *Manager) GetWebDavEnabled() bool {
	return m.WebDavHandler.Enabled
}

//Mapper of the original Connection related features
func (m *Manager) HandleConnectionList(w http.ResponseWriter, r *http.Request) {
	m.WebDavHandler.HandleConnectionList(w, r)
}

func (m *Manager) HandlePermissionEdit(w http.ResponseWriter, r *http.Request) {
	m.WebDavHandler.HandlePermissionEdit(w, r)
}

func (m *Manager) HandleClearAllPending(w http.ResponseWriter, r *http.Request) {
	m.WebDavHandler.HandleClearAllPending(w, r)
}
func (m *Manager) HandleRequest(w http.ResponseWriter, r *http.Request) {
	m.WebDavHandler.HandleRequest(w, r)
}
