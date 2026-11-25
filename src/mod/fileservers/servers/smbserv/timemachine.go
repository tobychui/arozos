package smbserv

import (
	"net/http"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/aroz"
	"imuslab.com/arozos/mod/utils"
)

/*
	timemachine.go

	macOS support and Time Machine. An admin turns on the Apple extensions
	("apple", off by default), which macOS needs before it backs up over SMB,
	and sets the most each user's backups may take ("tmlimit", in GB, 0 for
	no limit). Each user then picks one of their writable local drives
	("tm/<username>"), served to them as the TimeMachine share
	(aroz/timemachine.go). Bonjour announces that share while anyone has
	picked a drive (discovery.go).
*/

const (
	timeMachineKeyPrefix = "tm/"

	//maxTimeMachineLimitGB keeps the limit in bytes far from overflowing
	maxTimeMachineLimitGB = 1 << 30
)

// appleOn reports whether the Apple extensions are on.
func (m *Manager) appleOn() bool {
	logger.Debug("fileservers/servers/smbserv", "Manager.appleOn")
	on := false
	if m.opt.Sysdb.KeyExists(settingsTable, "apple") {
		m.opt.Sysdb.Read(settingsTable, "apple", &on)
	}
	return on
}

// timeMachineLimitGB is the most a user's backups may take, 0 for no limit.
func (m *Manager) timeMachineLimitGB() int64 {
	logger.Debug("fileservers/servers/smbserv", "Manager.timeMachineLimitGB")
	var gb int64
	if m.opt.Sysdb.KeyExists(settingsTable, "tmlimit") {
		m.opt.Sysdb.Read(settingsTable, "tmlimit", &gb)
	}
	if gb < 0 || gb > maxTimeMachineLimitGB {
		return 0
	}
	return gb
}

// timeMachineDrive is the drive a user picked for backups, "" for none.
func (m *Manager) timeMachineDrive(username string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/smbserv", "Manager.timeMachineDrive: username=%.120q", username)
	}
	drive := ""
	key := timeMachineKeyPrefix + username
	if m.opt.Sysdb.KeyExists(settingsTable, key) {
		m.opt.Sysdb.Read(settingsTable, key, &drive)
	}
	return drive
}

// anyTimeMachineDrive reports whether any user picked a drive for backups.
func (m *Manager) anyTimeMachineDrive() bool {
	logger.Debug("fileservers/servers/smbserv", "Manager.anyTimeMachineDrive")
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, timeMachineKeyPrefix)
	return err == nil && len(entries) > 0
}

// timeMachinePick implements aroz.Options.TimeMachine.
func (m *Manager) timeMachinePick(username string) (string, uint64, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/smbserv", "Manager.timeMachinePick: username=%.120q", username)
	}
	if !m.appleOn() {
		return "", 0, false
	}
	drive := m.timeMachineDrive(username)
	return drive, uint64(m.timeMachineLimitGB()) << 30, drive != ""
}

// timeMachineDrives lists the drives a user can keep backups on.
func (m *Manager) timeMachineDrives(username string) []*filesystem.FileSystemHandler {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/smbserv", "Manager.timeMachineDrives: username=%.120q", username)
	}
	out := []*filesystem.FileSystemHandler{}
	account, _, err := m.opt.LookupUser(username)
	if err != nil {
		return out
	}
	for _, fsh := range account.GetAllFileSystemHandler() {
		if aroz.TimeMachineEligible(fsh, account) {
			out = append(out, fsh)
		}
	}
	return out
}

// TimeMachineStatus is the Time Machine part of the connect page.
type TimeMachineStatus struct {
	Enabled   bool       //An admin turned macOS support on
	Drive     string     //The drive picked, "" for none
	Folder    string     //Where the backups go, as a virtual path
	Drives    []ShareRow //Drives that can hold backups
	LimitGB   int64      //Zero is no limit
	ShareName string
}

// HandleTimeMachine shows or changes the drive the signed in user keeps
// Time Machine backups on. POST drive picks one, an empty drive none.
func (m *Manager) HandleTimeMachine(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/smbserv", "Manager.HandleTimeMachine: r=%s", logger.RequestSummary(r))
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	drives := m.timeMachineDrives(username)
	if r.Method == http.MethodPost {
		if !m.appleOn() {
			utils.SendErrorResponse(w, "Time Machine is turned off on this server")
			return
		}
		drive := strings.TrimSpace(postOnly(r, "drive"))
		if drive == "" {
			m.opt.Sysdb.Delete(settingsTable, timeMachineKeyPrefix+username)
		} else {
			found := false
			for _, fsh := range drives {
				found = found || fsh.UUID == drive
			}
			if !found {
				utils.SendErrorResponse(w, "This drive cannot hold Time Machine backups")
				return
			}
			m.opt.Sysdb.Write(settingsTable, timeMachineKeyPrefix+username, drive)
		}
		m.refreshTimeMachineAnnouncement()
	}

	status := TimeMachineStatus{
		Enabled:   m.appleOn(),
		Drives:    []ShareRow{},
		LimitGB:   m.timeMachineLimitGB(),
		ShareName: aroz.TimeMachineShareName,
	}
	picked := m.timeMachineDrive(username)
	for _, fsh := range drives {
		status.Drives = append(status.Drives, ShareRow{Name: fsh.UUID, Comment: fsh.Name})
		if fsh.UUID == picked {
			status.Drive = picked
			status.Folder = fsh.UUID + ":/" + aroz.TimeMachinePath(fsh, username)
		}
	}
	sendJSON(w, status)
}

// parseTimeMachineLimit reads the size limit field of the settings form.
func parseTimeMachineLimit(text string) (int64, bool) {
	logger.Debug("fileservers/servers/smbserv", "parseTimeMachineLimit")
	gb, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil || gb < 0 || gb > maxTimeMachineLimitGB {
		return 0, false
	}
	return gb, true
}
