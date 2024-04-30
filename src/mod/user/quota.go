package user

import (
	//"path/filepath"
	//"log"

	fs "imuslab.com/arozos/mod/filesystem"
)

/*
	Quota Handler
	author: tobychui

	This module handle the user storage quota and its related functions

*/

// Return the user quota information, returning used / total
func (u *User) HaveSpaceFor(fsh *fs.FileSystemHandler, vpath string) bool {
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
	owner := u.GetFileOwner(fsh, vpath)
	if owner == u.Username {
		//This file is owned by this user
		return true
	} else {
		return false
	}
}

func (u *User) GetFileOwner(fsh *fs.FileSystemHandler, vpath string) string {
	if fsh.UUID == "user" {
		//This file is inside user's root. It must be this user's file
		return u.Username
	}

	return ""
}
