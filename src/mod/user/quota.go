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
func (u *User) HaveSpaceFor(fsh *fs.FileSystemHandler, vpath string) (out0 bool) {
	defer logger.Out1(logger.In3("user", "User.HaveSpaceFor", "u", u, "fsh", fsh, "vpath", vpath), &out0)
	realpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		logger.DebugErr("user", err)
		return false
	}
	if u.StorageQuota.HaveSpace(fsh.FileSystemAbstraction.GetFileSize(realpath)) {
		return true
	} else {
		return false
	}
}

func (u *User) SetOwnerOfFile(fsh *fs.FileSystemHandler, vpath string) (out0 error) {
	defer logger.Out1(logger.In3("user", "User.SetOwnerOfFile", "u", u, "fsh", fsh, "vpath", vpath), &out0)
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		logger.DebugErr("user", err)
		return err
	}
	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsh.Hierarchy == "user" {
		u.StorageQuota.AllocateSpace(fsh.FileSystemAbstraction.GetFileSize(rpath))
	}

	return err
}

func (u *User) RemoveOwnershipFromFile(fsh *fs.FileSystemHandler, vpath string) (out0 error) {
	defer logger.Out1(logger.In3("user", "User.RemoveOwnershipFromFile", "u", u, "fsh", fsh, "vpath", vpath), &out0)
	realpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		logger.DebugErr("user", err)
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsh.Hierarchy == "user" {
		u.StorageQuota.ReclaimSpace(fsh.FileSystemAbstraction.GetFileSize(realpath))
	}
	return err
}

func (u *User) IsOwnerOfFile(fsh *fs.FileSystemHandler, vpath string) (out0 bool) {
	defer logger.Out1(logger.In3("user", "User.IsOwnerOfFile", "u", u, "fsh", fsh, "vpath", vpath), &out0)
	owner := u.GetFileOwner(fsh, vpath)
	if owner == u.Username {
		//This file is owned by this user
		return true
	} else {
		return false
	}
}

func (u *User) GetFileOwner(fsh *fs.FileSystemHandler, vpath string) (out0 string) {
	defer logger.Out1(logger.In3("user", "User.GetFileOwner", "u", u, "fsh", fsh, "vpath", vpath), &out0)
	if fsh.UUID == "user" {
		//This file is inside user's root. It must be this user's file
		return u.Username
	}

	return ""
}
