package user

import (
	//"path/filepath"
	//"log"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Quota Handler
	author: tobychui

	This module handle the user storage quota and its related functions

*/

// Return the user quota information, returning used / total
func (u *User) HaveSpaceFor(fsh *fs.FileSystemHandler, vpath string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.HaveSpaceFor: vpath=%.120q", vpath)
	}
	realpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		return false
	}
	if u.StorageQuota.HaveSpace(fsh.FileSystemAbstraction.GetFileSize(realpath)) {
		return true
	} else {
		return false
	}
}

func (u *User) SetOwnerOfFile(fsh *fs.FileSystemHandler, vpath string) error {
	if logger.IsDebug() {
		logger.Debugf("user", "User.SetOwnerOfFile: vpath=%.120q", vpath)
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		return err
	}
	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsh.Hierarchy == "user" {
		//log.Println("Setting user ownership on: " + realpath)
		u.StorageQuota.AllocateSpace(fsh.FileSystemAbstraction.GetFileSize(rpath))
	}

	return err
}

func (u *User) RemoveOwnershipFromFile(fsh *fs.FileSystemHandler, vpath string) error {
	if logger.IsDebug() {
		logger.Debugf("user", "User.RemoveOwnershipFromFile: vpath=%.120q", vpath)
	}
	realpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsh.Hierarchy == "user" {
		//log.Println("Removing user ownership on: " + realpath)
		u.StorageQuota.ReclaimSpace(fsh.FileSystemAbstraction.GetFileSize(realpath))
	}
	return err
}

func (u *User) IsOwnerOfFile(fsh *fs.FileSystemHandler, vpath string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.IsOwnerOfFile: vpath=%.120q", vpath)
	}
	owner := u.GetFileOwner(fsh, vpath)
	if owner == u.Username {
		//This file is owned by this user
		return true
	} else {
		return false
	}
}

func (u *User) GetFileOwner(fsh *fs.FileSystemHandler, vpath string) string {
	if logger.IsDebug() {
		logger.Debugf("user", "User.GetFileOwner: vpath=%.120q", vpath)
	}
	if fsh.UUID == "user" {
		//This file is inside user's root. It must be this user's file
		return u.Username
	}

	return ""
}
