package aroz

import (
	"strings"

	"imuslab.com/arozos/mod/filesystem"
)

/*
	timemachine.go

	The TimeMachine share holds the Time Machine backups of a user's Macs, in
	a folder of the drive the user picked: "Time Machine" on their own user
	drive, "Time Machine/<username>" on a drive other users have too. It is a
	share of its own rather than the drive itself, so each user's backups and
	size limit are theirs alone, the rest of the drive stays out of Time
	Machine's way, and Bonjour can announce one share name for everybody.

	smbsrv offers it to macOS with full sync and reports the size limit
	(smbsrv.TimeMachineShare); deleted backups never go to the trash bin.
*/

const (
	//TimeMachineShareName is the share Macs open, and Bonjour announces
	TimeMachineShareName = "TimeMachine"

	//TimeMachineFolder holds the backups on the drive a user picked
	TimeMachineFolder = "Time Machine"
)

// TimeMachineEligible reports whether a drive can hold a user's Time Machine
// backups: a local drive the user may write to. Drives that only move whole
// files (cloud and remote ones) cannot flush a write in place, and tmp:/ is
// emptied at every boot.
func TimeMachineEligible(fsh *filesystem.FileSystemHandler, account Account) bool {
	if fsh == nil || fsh.Closed || fsh.ReadOnly || fsh.RequireBuffer || fsh.IsNetworkDrive() {
		return false
	}
	if fsh.UUID == "tmp" || strings.EqualFold(fsh.UUID, TimeMachineShareName) {
		return false
	}
	return account.CanWrite(fsh.UUID + ":/")
}

// TimeMachinePath is the folder of a user's backups on a drive, relative to
// the drive root.
func TimeMachinePath(fsh *filesystem.FileSystemHandler, username string) string {
	if fsh.Hierarchy == "user" {
		return TimeMachineFolder
	}
	return TimeMachineFolder + "/" + username
}

// timeMachineShare is the user's TimeMachine share, or nil when they picked
// no drive, the drive is gone or no longer eligible, or one of their drives
// already has the share's name.
func (v *view) timeMachineShare() *share {
	if v.opt == nil || v.opt.TimeMachine == nil {
		return nil
	}
	drive, maxSize, ok := v.opt.TimeMachine(v.username)
	if !ok || drive == "" {
		return nil
	}
	var picked *filesystem.FileSystemHandler
	for _, fsh := range v.account.GetAllFileSystemHandler() {
		if strings.EqualFold(fsh.UUID, TimeMachineShareName) {
			return nil
		}
		if fsh.UUID == drive {
			picked = fsh
		}
	}
	if !TimeMachineEligible(picked, v.account) {
		return nil
	}
	s := newShare(picked, v)
	s.sub = TimeMachinePath(picked, v.username)
	s.timeMachine = true
	s.tmMaxSize = maxSize
	return s
}

// TimeMachine implements smbsrv.TimeMachineShare. The limit is asked again
// each time, as Macs ask for the free space, so a change applies at once; a
// share whose user has since picked another drive takes no more backups.
func (s *share) TimeMachine() (bool, uint64) {
	if !s.timeMachine {
		return false, 0
	}
	if s.v.opt == nil || s.v.opt.TimeMachine == nil {
		return true, s.tmMaxSize
	}
	drive, maxSize, ok := s.v.opt.TimeMachine(s.v.username)
	if !ok || drive != s.fsh.UUID {
		return false, 0
	}
	return true, maxSize
}
