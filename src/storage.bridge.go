package main

import (
	"errors"
	"log"

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
		log.Println("[ERROR] Fail to read File System Handler bridge config")
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
			log.Println("Failed to bridge "+fsh.UUID+":/ to "+basePool.Owner, err.Error())
		}
		log.Println(fsh.UUID + ":/ bridged to " + basePool.Owner + " Storage Pool")
	}
}

func BridgeStoragePoolForGroup(group string) {
	bridgeRecords, err := bridgeManager.ReadConfig()
	if err != nil {
		log.Println("Failed to bridge FSH for group " + group)
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
				log.Println("Failed to bridge "+fsh.UUID+":/ to "+basePool.Owner, err.Error())
			}
			log.Println(fsh.UUID + ":/ bridged to " + basePool.Owner + " Storage Pool")
		}
	}
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
