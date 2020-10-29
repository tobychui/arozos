package user

import (
	//"path/filepath"
	//"log"

	fs "imuslab.com/aroz_online/mod/filesystem"
	//quota "imuslab.com/aroz_online/mod/quota"
)

/*
	Quota Handler
	author: tobychui

	This module handle the user storage quota and its related functions

*/

//Return the user quota information, returning used / total
func (u *User)HaveSpaceFor(realpath string) bool{
	if u.StorageQuota.HaveSpace(fs.GetFileSize(realpath)){
		return true
	}else{
		return false
	}
}

func (u *User)SetOwnerOfFile(realpath string) error{
	//Get handler from the path
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil{
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsHandler.Hierarchy == "user"{
		u.StorageQuota.AllocateSpace(fs.GetFileSize(realpath))
	}
	
	
	//Moved function to FileSystemHandler
	/*
	rpabs, _ := filepath.Abs(realpath)
	fsrabs, _ := filepath.Abs(fsHandler.Path)
	reldir, err := filepath.Rel(fsrabs, rpabs)
	if err != nil{
		log.Println("Failed to write owner record to aofs.db: " + err.Error())
		return err

	}
	fsHandler.FilesystemDatabase.NewTable("owner")
	fsHandler.FilesystemDatabase.Write("owner","owner/" + reldir, u.Username)
	*/

	//Add to the fshandler database of this file owner
	err = fsHandler.CreateFileRecord(realpath, u.Username)
	return err
}

func (u *User)RemoveOwnershipFromFile(realpath string) error{
	//Get handler from the path
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil{
		return err
	}

	//Check if it is user structured. If yes, add the filesize to user's quota
	if fsHandler.Hierarchy == "user"{
		u.StorageQuota.ReclaimSpace(fs.GetFileSize(realpath))
	}

	//Remove file owner from fsdb
	/*
	rpabs, _ := filepath.Abs(realpath)
	fsrabs, _ := filepath.Abs(fsHandler.Path)
	reldir, err := filepath.Rel(fsrabs, rpabs)
	if err != nil{
		log.Println("Failed to remove owner record to aofs.db: " + err.Error())
		return err

	}

	fsHandler.FilesystemDatabase.Delete("owner","owner/" + reldir)
	*/
	err = fsHandler.DeleteFileRecord(realpath)
	return err
}

func (u *User)IsOwnerOfFile(realpath string) bool{
	fsHandler, err := u.GetFileSystemHandlerFromRealPath(realpath)
	if err != nil{
		return false
	}

	owner, err := fsHandler.GetFileRecord(realpath)
	if err != nil{
		//Error occured. Either this file is not tracked or this file has no owner
		return false
	}
	if owner == u.Username{
		//This file is owned by this user
		return true
	}else{
		return false
	}
}



