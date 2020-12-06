package user

import (
	//"path/filepath"
	//"log"

	fs "imuslab.com/arozos/mod/filesystem"
	//quota "imuslab.com/arozos/mod/quota"
)

/*
	Quota Handler
	author: tobychui

	This module handle the user storage quota and its related functions

*/

//Return the user quota information, returning used / total
func (u *User) HaveSpaceFor(realpath string) bool {
	if u.StorageQuota.HaveSpace(fs.GetFileSize(realpath)) {
		return true
	} else {
		return false
	}
}

func (u *User) SetOwnerOfFile(realpath string) error {

	//Get handler from the path
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil {
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsHandler.Hierarchy == "user" {
		//log.Println("Setting user ownership on: " + realpath)
		u.StorageQuota.AllocateSpace(fs.GetFileSize(realpath))
	}

	//Add to the fshandler database of this file owner
	err = fsHandler.CreateFileRecord(realpath, u.Username)
	return err
}

func (u *User) RemoveOwnershipFromFile(realpath string) error {

	//Get handler from the path
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil {
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsHandler.Hierarchy == "user" {
		//log.Println("Removing user ownership on: " + realpath)
		u.StorageQuota.ReclaimSpace(fs.GetFileSize(realpath))
	}

	err = fsHandler.DeleteFileRecord(realpath)
	return err
}

func (u *User) IsOwnerOfFile(realpath string) bool {
	owner := u.GetFileOwner(realpath)
	if owner == u.Username {
		//This file is owned by this user
		return true
	} else {
		return false
	}
}

func (u *User) GetFileOwner(realpath string) string {
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil {
		return ""
	}

	owner, err := fsHandler.GetFileRecord(realpath)
	if err != nil {
		//Error occured. Either this file is not tracked or this file has no owner
		return ""
	}

	return owner
}
