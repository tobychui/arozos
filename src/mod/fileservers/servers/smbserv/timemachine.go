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
func (m *Manager) appleOn() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.appleOn", "m", m), &out0)
	on := false
	if m.opt.Sysdb.KeyExists(settingsTable, "apple") {
		m.opt.Sysdb.Read(settingsTable, "apple", &on)
	}
	return on
}

// timeMachineLimitGB is the most a user's backups may take, 0 for no limit.
func (m *Manager) timeMachineLimitGB() (out0 int64) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.timeMachineLimitGB", "m", m), &out0)
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
func (m *Manager) timeMachineDrive(username string) (out0 string) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "Manager.timeMachineDrive", "m", m, "username", username), &out0)
	drive := ""
	key := timeMachineKeyPrefix + username
	if m.opt.Sysdb.KeyExists(settingsTable, key) {
		m.opt.Sysdb.Read(settingsTable, key, &drive)
	}
	return drive
}

// anyTimeMachineDrive reports whether any user picked a drive for backups.
func (m *Manager) anyTimeMachineDrive() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.anyTimeMachineDrive", "m", m), &out0)
	entries, err := m.opt.Sysdb.ListTableWithPrefix(settingsTable, timeMachineKeyPrefix)
	return err == nil && len(entries) > 0
}

// timeMachinePick implements aroz.Options.TimeMachine.
func (m *Manager) timeMachinePick(username string) (out0 string, out1 uint64, out2 bool) {
	defer logger.Out3(logger.In2("fileservers/servers/smbserv", "Manager.timeMachinePick", "m", m, "username", username), &out0, &out1, &out2)
	if !m.appleOn() {
		return "", 0, false
	}
	drive := m.timeMachineDrive(username)
	return drive, uint64(m.timeMachineLimitGB()) << 30, drive != ""
}

// timeMachineDrives lists the drives a user can keep backups on.
func (m *Manager) timeMachineDrives(username string) (out0 []*filesystem.FileSystemHandler) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "Manager.timeMachineDrives", "m", m, "username", username), &out0)
	out := []*filesystem.FileSystemHandler{}
	account, _, err := m.opt.LookupUser(username)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
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
	defer logger.Out0(logger.In2("fileservers/servers/smbserv", "Manager.HandleTimeMachine", "m", m, "r", r))
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
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
func parseTimeMachineLimit(text string) (out0 int64, out1 bool) {
	defer logger.Out2(logger.In1("fileservers/servers/smbserv", "parseTimeMachineLimit", "text", text), &out0, &out1)
	gb, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil || gb < 0 || gb > maxTimeMachineLimitGB {
		return 0, false
	}
	return gb, true
}
