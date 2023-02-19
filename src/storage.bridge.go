package main

import (
	"errors"

	fs "imuslab.com/arozos/mod/filesystem"
	storage "imuslab.com/arozos/mod/storage"
)

/*
	Storage functions related to bridged FSH
*/

//Initiate bridged storage pool configs
func BridgeStoragePoolInit() {
	bridgeRecords, err := bridgeManager.ReadConfig()
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Fail to read File System Handler bridge config", err)
		return
	}

	for _, bridgeConf := range bridgeRecords {
		fsh, err := GetFsHandlerByUUID(bridgeConf.FSHUUID)
		if err != nil {
			//This fsh is not found. Skip this
			continue
		}

		basePool, err := GetStoragePoolByOwner(bridgeConf.SPOwner)
		if err != nil {
			//This fsh is not found. Skip this
			continue
		}

		err = BridgeFSHandlerToGroup(fsh, basePool)
		if err != nil {
			systemWideLogger.PrintAndLog("Storage", "Failed to bridge "+fsh.UUID+":/ to "+basePool.Owner+err.Error(), err)
		}
		systemWideLogger.PrintAndLog("Storage", fsh.UUID+":/ bridged to "+basePool.Owner+" Storage Pool", nil)
	}
}

func BridgeStoragePoolForGroup(group string) {
	bridgeRecords, err := bridgeManager.ReadConfig()
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Failed to bridge FSH for group "+group, err)
		return
	}

	for _, bridgeConf := range bridgeRecords {
		if bridgeConf.SPOwner == group {
			fsh, err := GetFsHandlerByUUID(bridgeConf.FSHUUID)
			if err != nil {
				//This fsh is not found. Skip this
				continue
			}

			basePool, err := GetStoragePoolByOwner(bridgeConf.SPOwner)
			if err != nil {
				//This fsh is not found. Skip this
				continue
			}

			err = BridgeFSHandlerToGroup(fsh, basePool)
			if err != nil {
				systemWideLogger.PrintAndLog("Storage", "Failed to bridge "+fsh.UUID+":/ to "+basePool.Owner+err.Error(), err)
			}
			systemWideLogger.PrintAndLog("Storage", fsh.UUID+":/ bridged to "+basePool.Owner+" Storage Pool", nil)
		}
	}
}

//Debridge all bridged FSH from this group, origin (i.e. not bridged) fsh will be skipped
func DebridgeAllFSHandlerFromGroup(group string) error {
	targetSp, err := GetStoragePoolByOwner(group)
	if err != nil {
		return err
	}

	originFsh := []*fs.FileSystemHandler{}
	for _, fsh := range targetSp.Storages {
		isBridged, err := bridgeManager.IsBridgedFSH(fsh.UUID, group)
		if err != nil {
			return err
		}

		if !isBridged {
			//Append the fsh that is not bridged into the origin list
			originFsh = append(originFsh, fsh)
		} else {
			systemWideLogger.PrintAndLog("Storage", fsh.UUID+":/ de-bridged from "+group+" Storage Pool", nil)
		}
	}

	targetPg := permissionHandler.GetPermissionGroupByName(group)
	if targetPg == nil {
		return errors.New("permission group not exists")
	}

	newSp, err := storage.NewStoragePool(originFsh, group)
	if err != nil {
		return err
	}

	targetPg.StoragePool = newSp
	return nil
}

//Bridge a FSH to a given Storage Pool
func BridgeFSHandlerToGroup(fsh *fs.FileSystemHandler, sp *storage.StoragePool) error {
	//Check if the fsh already exists in the basepool
	for _, thisFSH := range sp.Storages {
		if thisFSH.UUID == fsh.UUID {
			return errors.New("Target File System Handler already bridged to this pool")
		}
	}
	sp.Storages = append(sp.Storages, fsh)
	return nil
}

//Debridge a fsh from a given group by fsh ID
func DebridgeFSHandlerFromGroup(fshUUID string, sp *storage.StoragePool) error {
	isBridged, err := bridgeManager.IsBridgedFSH(fshUUID, sp.Owner)
	if err != nil || !isBridged {
		return errors.New("FSH not bridged")
	}

	newStorageList := []*fs.FileSystemHandler{}
	fshExists := false
	for _, fsh := range sp.Storages {
		if fsh.UUID != fshUUID {
			newStorageList = append(newStorageList, fsh)
		} else {
			fshExists = true
		}
	}

	if fshExists {
		sp.Storages = newStorageList
		return nil
	} else {
		return errors.New("Target File System Handler not found")
	}
}
