package tftpserv

import (
	"encoding/json"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// Start the TFTP Server by request
func (m *Manager) HandleTFTPServerStart(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/tftpserv", "Manager.HandleTFTPServerStart: r=%s", logger.RequestSummary(r))
	}
	err := m.StartTftpServer()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// Stop the TFTP server by request
func (m *Manager) HandleTFTPServerStop(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/tftpserv", "Manager.HandleTFTPServerStop: r=%s", logger.RequestSummary(r))
	}
	m.StopTftpServer()
	utils.SendOK(w)
}

// Get the TFTP server status
func (m *Manager) HandleTFTPServerStatus(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/tftpserv", "Manager.HandleTFTPServerStatus: r=%s", logger.RequestSummary(r))
	}
	status, err := m.GetTftpServerStatus()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(status)
	utils.SendJSONResponse(w, string(js))
}

// Handle TFTP Server Port number change
func (m *Manager) HandleTFTPPort(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/tftpserv", "Manager.HandleTFTPPort: r=%s", logger.RequestSummary(r))
	}
	newport, _ := utils.GetPara(r, "port")
	if newport == "" {
		//Get current port
		port := 69
		if m.option.Sysdb.KeyExists("tftp", "port") {
			m.option.Sysdb.Read("tftp", "port", &port)
		}
		js, _ := json.Marshal(port)
		utils.SendJSONResponse(w, string(js))
	} else {
		//Set new port
		newPortInt, err := strconv.Atoi(newport)
		if err != nil {
			utils.SendErrorResponse(w, "Invalid port number")
			return
		}

		m.option.Sysdb.Write("tftp", "port", newPortInt)

		//Restart the TFTP server if running
		if m.IsTftpServerEnabled() {
			m.StopTftpServer()
			m.StartTftpServer()
		}

		utils.SendOK(w)
	}
}

// Handle setting the default user for TFTP access
func (m *Manager) HandleTFTPDefaultUser(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/tftpserv", "Manager.HandleTFTPDefaultUser: r=%s", logger.RequestSummary(r))
	}
	username, _ := utils.PostPara(r, "username")
	if r.Method == http.MethodGet || username == "" {
		//Get current default user
		defaultUser := ""
		if m.option.Sysdb.KeyExists("tftp", "defaultUser") {
			m.option.Sysdb.Read("tftp", "defaultUser", &defaultUser)
		}
		js, _ := json.Marshal(defaultUser)
		utils.SendJSONResponse(w, string(js))
	} else {
		//Set new default user
		// Validate that the user exists
		_, err := m.option.UserManager.GetUserInfoFromUsername(username)
		if err != nil {
			utils.SendErrorResponse(w, "User not found")
			return
		}

		m.option.Sysdb.Write("tftp", "defaultUser", username)
		m.option.Logger.PrintAndLog("TFTP", "Default user set to: "+username, nil)

		utils.SendOK(w)
	}
}
