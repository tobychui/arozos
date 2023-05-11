package ftpserv

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/storage/ftp"
	"imuslab.com/arozos/mod/utils"
)

//Start the FTP Server by request
func (m *Manager) HandleFTPServerStart(w http.ResponseWriter, r *http.Request) {
	err := m.StartFtpServer()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
	}
	utils.SendOK(w)
}

//Stop the FTP server by request
func (m *Manager) HandleFTPServerStop(w http.ResponseWriter, r *http.Request) {
	m.StopFtpServer()
	utils.SendOK(w)
}

//Get the FTP server status
func (m *Manager) HandleFTPServerStatus(w http.ResponseWriter, r *http.Request) {
	status, err := m.GetFtpServerStatus()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(status)
	utils.SendJSONResponse(w, string(js))
}

//Update UPnP setting on FTP server
func (m *Manager) HandleFTPUPnP(w http.ResponseWriter, r *http.Request) {
	enable, _ := utils.GetPara(r, "enable")
	if enable == "true" {
		m.option.Logger.PrintAndLog("FTP", "Enabling UPnP on FTP Server Port", nil)
		m.option.Sysdb.Write("ftp", "upnp", true)
	} else {
		m.option.Logger.PrintAndLog("FTP", "Disabling UPnP on FTP Server Port", nil)
		m.option.Sysdb.Write("ftp", "upnp", false)
	}

	//Restart FTP Server if server is running
	if m.option.FtpServer != nil && m.option.FtpServer.ServerRunning {
		m.StartFtpServer()
	}
	utils.SendOK(w)
}

//Update access permission on FTP server
func (m *Manager) HandleFTPAccessUpdate(w http.ResponseWriter, r *http.Request) {
	//Get groups paramter from post req
	groupString, err := utils.PostPara(r, "groups")
	if err != nil {
		utils.SendErrorResponse(w, "groups not defined")
		return
	}

	//Prase it
	groups := []string{}
	err = json.Unmarshal([]byte(groupString), &groups)
	if err != nil {
		utils.SendErrorResponse(w, "Unable to parse groups")
		return
	}

	m.option.Logger.PrintAndLog("FTP", "Updating FTP Access group to: "+strings.Join(groups, ","), nil)
	//Set the accessable group
	ftp.UpdateAccessableGroups(m.option.Sysdb, groups)

	utils.SendOK(w)
}

//Handle FTP Set access port
func (m *Manager) HandleFTPSetPort(w http.ResponseWriter, r *http.Request) {
	port, err := utils.PostPara(r, "port")
	if err != nil {
		utils.SendErrorResponse(w, "Port not defined")
		return
	}

	//Try parse the port into int
	portInt, err := strconv.Atoi(port)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid port number")
		return
	}

	//Update the database port configuration
	m.option.Sysdb.Write("ftp", "port", portInt)

	//Restart the FTP server
	m.StartFtpServer()

	utils.SendOK(w)
}

/*
	Handle the settings for passive mode related files

	Example set commands
	set=ip&ip=123.456.789.1
	set=mode&passive=true
*/
func (m *Manager) HandleFTPPassiveModeSettings(w http.ResponseWriter, r *http.Request) {
	set, err := utils.PostPara(r, "set")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid set type")
		return
	}

	if set == "ip" {
		//Update the public up addr
		ip, err := utils.PostPara(r, "ip")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid ip given")
			return
		}

		m.option.Sysdb.Write("ftp", "publicip", ip)

	} else if set == "mode" {
		//Update the passive mode setting
		passive, err := utils.PostPara(r, "passive")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid passive option (true/false)")
			return
		}

		m.option.Logger.PrintAndLog("FTP", "Updating FTP Server PassiveMode to "+passive, nil)
		if passive == "true" {
			m.option.Sysdb.Write("ftp", "passive", true)
		} else {
			m.option.Sysdb.Write("ftp", "passive", false)
		}
	} else {
		utils.SendErrorResponse(w, "Unknown setting filed")
		return
	}

	//Restart the FTP server if it is running now
	if m.option.FtpServer != nil && m.option.FtpServer.ServerRunning {
		m.StartFtpServer()
	}

}
