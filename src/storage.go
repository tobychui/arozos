package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/permission"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	storage "imuslab.com/arozos/mod/storage"
)

var (
	baseStoragePool *storage.StoragePool //base storage pool, all user can access these virtual roots
	//fsHandlers      []*fs.FileSystemHandler //All File system handlers. All opened handles must be registered in here
	//storagePools    []*storage.StoragePool  //All Storage pool opened
	storageHeartbeatTickerChan chan bool //Channel to stop the storage heartbeat ticker
)

func StorageInit() {
	defer logger.Out0(logger.In0("Core", "StorageInit"))
	//Load the default handler for the user storage root
	if !fs.FileExists(filepath.Clean(*root_directory) + "/") {
		os.MkdirAll(filepath.Clean(*root_directory)+"/", 0755)
	}

	//Start loading the base storage pool
	err := LoadBaseStoragePool()
	if err != nil {
		logger.DebugErr("Core", err)
		panic(err)
	}
}

func LoadBaseStoragePool() (out0 error) {
	defer logger.Out1(logger.In0("Core", "LoadBaseStoragePool"), &out0)
	//All fsh for the base pool
	fsHandlers := []*fs.FileSystemHandler{}
	//Use for Debian buster local file system
	localFileSystem := "ext4"
	if runtime.GOOS == "windows" {
		localFileSystem = "ntfs"
	}

	baseHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name:       "User",
		Uuid:       "user",
		Path:       filepath.ToSlash(filepath.Clean(*root_directory)) + "/",
		Hierarchy:  "user",
		Automount:  false,
		Filesystem: localFileSystem,
	}, fs.RuntimePersistenceConfig{
		LocalBufferPath: *tmp_directory,
	})

	if err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Storage", "Failed to initiate user root storage directory: "+*root_directory+err.Error(), err)
		return err
	}
	fsHandlers = append(fsHandlers, baseHandler)

	//Load the tmp folder as storage unit
	tmpHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name:       "tmp",
		Uuid:       "tmp",
		Path:       filepath.ToSlash(filepath.Clean(*tmp_directory)) + "/",
		Hierarchy:  "user",
		Automount:  false,
		Filesystem: localFileSystem,
	}, fs.RuntimePersistenceConfig{
		LocalBufferPath: *tmp_directory,
	})

	if err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Storage", "Failed to initiate tmp storage directory: "+*tmp_directory+err.Error(), err)
		return err
	}
	fsHandlers = append(fsHandlers, tmpHandler)

	//Load all the storage config from file
	rawConfig, err := os.ReadFile(*storage_config_file)
	if err != nil {
		logger.DebugErr("Core", err)
		//File not found. Use internal storage only
		systemWideLogger.PrintAndLog("Storage", "Storage configuration file not found. Using internal storage only.", err)
	} else {
		//Configuration loaded. Initializing handler
		externalHandlers, err := fs.NewFileSystemHandlersFromJSON(rawConfig, fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		})
		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Failed to load storage configuration: "+err.Error()+" -- Skipping", err)
		} else {
			for _, thisHandler := range externalHandlers {
				fsHandlers = append(fsHandlers, thisHandler)
				systemWideLogger.PrintAndLog("Storage", thisHandler.Name+" Mounted as "+thisHandler.UUID+":/", err)
			}

		}
	}

	//Files other users shared with each user, see file_system.share.go
	fsHandlers = sharedDriveAttach(fsHandlers)

	//Create a base storage pool for all users
	sp, err := storage.NewStoragePool(fsHandlers, "system")
	if err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Storage", "Failed to create base Storaeg Pool", err)
		return err
	}

	baseStoragePool = sp

	//A reload lands here too and cluster:/ is not in any config, so put it
	//back. During boot the cluster is not up yet and this changes nothing.
	clusterSyncDrive()

	return nil
}

// Initialize the storage connection health check for all fsh.
func storageHeartbeatTickerInit() {
	defer logger.Out0(logger.In0("Core", "storageHeartbeatTickerInit"))
	ticker := time.NewTicker(60 * time.Second)
	done := make(chan bool)
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				StoragePerformFileSystemAbstractionConnectionHeartbeat()
			}
		}
	}()
	storageHeartbeatTickerChan = done
}

// Perform heartbeat to all connected file system abstraction.
// Blocking function, use with go routine if needed
func StoragePerformFileSystemAbstractionConnectionHeartbeat() {
	defer logger.Out0(logger.In0("Core", "StoragePerformFileSystemAbstractionConnectionHeartbeat"))
	allFsh := GetAllLoadedFsh()
	for _, thisFsh := range allFsh {
		if isClusterOrShareDrive(thisFsh) {
			//Built by code and followed by its own subsystem. There are no
			//start options to reconnect it from
			continue
		}
		err := thisFsh.FileSystemAbstraction.Heartbeat()
		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("System", "[Storage] File System Abstraction from "+thisFsh.Name+" report an error: "+err.Error(), nil)
			//Retreive the old startup config and close the pool
			originalStartOption := filesystem.FileSystemOption{}
			js, _ := json.Marshal(thisFsh.StartOptions)
			json.Unmarshal(js, &originalStartOption)

			//Create a new fsh from original start options
			newfsh, err := filesystem.NewFileSystemHandler(originalStartOption, fs.RuntimePersistenceConfig{
				LocalBufferPath: *tmp_directory,
			})
			if err != nil {
				logger.DebugErr("Core", err)
				systemWideLogger.PrintAndLog("System", "[Storage] Unable to reconnect "+thisFsh.Name+": "+err.Error(), nil)
				continue
			} else {
				//New fsh created. Close the old one
				thisFsh.Close()
			}

			//Pop this fsh from all storage pool that mounted this
			sp := GetAllStoragePools()
			parentsp := []*storage.StoragePool{}
			for _, thissp := range sp {
				if thissp.ContainDiskID(originalStartOption.Uuid) {
					parentsp = append(parentsp, thissp)
					thissp.DetachFsHandler(originalStartOption.Uuid)
				}
			}

			//Add the new fsh to all the storage pools that have it originally
			for _, pool := range parentsp {
				err := pool.AttachFsHandler(newfsh)
				if err != nil {
					logger.DebugErr("Core", err)
					systemWideLogger.PrintAndLog("System", "[Storage] Attach fsh to pool failed: "+err.Error(), nil)
				}
			}
		}
	}
}

// Initialize group storage pool
func GroupStoragePoolInit() {
	defer logger.Out0(logger.In0("Core", "GroupStoragePoolInit"))
	//Mount permission groups
	for _, pg := range permissionHandler.PermissionGroups {
		//For each group, check does this group has a config file
		err := LoadStoragePoolForGroup(pg)
		if err != nil {
			logger.DebugErr("Core", err)
			continue
		}

		//Do something else, WIP
	}

	//Start editing interface for Storage Pool Editor
	StoragePoolEditorInit()
}

func LoadStoragePoolForGroup(pg *permission.PermissionGroup) (out0 error) {
	defer logger.Out1(logger.In1("Core", "LoadStoragePoolForGroup", "pg", pg), &out0)
	expectedConfigPath := "./system/storage/" + pg.Name + ".json"
	if fs.FileExists(expectedConfigPath) {
		//Read the config file
		pgStorageConfig, err := os.ReadFile(expectedConfigPath)
		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Failed to read config for "+pg.Name+": "+err.Error(), err)
			return errors.New("Failed to read config for " + pg.Name + ": " + err.Error())
		}

		//Generate fsHandler form json
		thisGroupFsHandlers, err := fs.NewFileSystemHandlersFromJSON(pgStorageConfig, fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		})

		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Failed to load storage configuration: "+err.Error(), err)
			return errors.New("Failed to load storage configuration: " + err.Error())
		}

		//Show debug message
		for _, thisHandler := range thisGroupFsHandlers {
			systemWideLogger.PrintAndLog("Storage", thisHandler.Name+" Mounted as "+thisHandler.UUID+":/ for group "+pg.Name, err)
		}

		//Create a storage pool from these handlers
		sp, err := storage.NewStoragePool(thisGroupFsHandlers, pg.Name)
		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Failed to create storage pool for "+pg.Name, err)
			return errors.New("Failed to create storage pool for " + pg.Name)
		}

		//Assign storage pool to group
		pg.StoragePool = sp

	} else {
		//Storage configuration not exists. Fill in the basic information and move to next storage pool

		//Create a new empty storage pool for this group
		sp, err := storage.NewStoragePool([]*fs.FileSystemHandler{}, pg.Name)
		if err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Failed to create empty storage pool for group: "+pg.Name, err)
		}
		pg.StoragePool = sp
	}

	return nil
}

// Check if a storage pool exists by its group owner name
func StoragePoolExists(poolOwner string) (out0 bool) {
	defer logger.Out1(logger.In1("Core", "StoragePoolExists", "poolOwner", poolOwner), &out0)
	_, err := GetStoragePoolByOwner(poolOwner)
	return err == nil
}

func GetAllStoragePools() (out0 []*storage.StoragePool) {
	defer logger.Out1(logger.In0("Core", "GetAllStoragePools"), &out0)
	//Append the base pool
	results := []*storage.StoragePool{baseStoragePool}

	//Add each permissionGroup's pool
	for _, pg := range permissionHandler.PermissionGroups {
		results = append(results, pg.StoragePool)
	}

	return results
}

func GetStoragePoolByOwner(owner string) (out0 *storage.StoragePool, out1 error) {
	defer logger.Out2(logger.In1("Core", "GetStoragePoolByOwner", "owner", owner), &out0, &out1)
	sps := GetAllStoragePools()
	for _, pool := range sps {
		if pool.Owner == owner {
			return pool, nil
		}
	}
	return nil, errors.New("Storage pool owned by " + owner + " not found")
}

func GetFSHandlerSubpathFromVpath(vpath string) (out0 *fs.FileSystemHandler, out1 string, out2 error) {
	defer logger.Out3(logger.In1("Core", "GetFSHandlerSubpathFromVpath", "vpath", vpath), &out0, &out1, &out2)
	VirtualRootID, subpath, err := fs.GetIDFromVirtualPath(vpath)
	if err != nil {
		logger.DebugErr("Core", err)
		return nil, "", errors.New("Unable to resolve requested path: " + err.Error())
	}

	fsh, err := GetFsHandlerByUUID(VirtualRootID)
	if err != nil {
		logger.DebugErr("Core", err)
		return nil, "", errors.New("Unable to resolve requested path: " + err.Error())
	}

	if fsh == nil || fsh.FileSystemAbstraction == nil {
		//err is nil on this branch, do not dereference it for a message
		return nil, "", errors.New("Unable to resolve requested path: file system handler not loaded")
	}

	if fsh.Closed {
		return nil, "", errors.New("Target file system handler already closed")
	}

	return fsh, subpath, nil
}

func GetFsHandlerByUUID(uuid string) (out0 *fs.FileSystemHandler, out1 error) {
	defer logger.Out2(logger.In1("Core", "GetFsHandlerByUUID", "uuid", uuid), &out0, &out1)
	//Filter out the :/ fropm uuid if exists
	if strings.Contains(uuid, ":") {
		uuid = strings.Split(uuid, ":")[0]
	}
	var resultFsh *fs.FileSystemHandler = nil
	allFsh := GetAllLoadedFsh()
	for _, fsh := range allFsh {
		if fsh.UUID == uuid && !fsh.Closed {
			resultFsh = fsh
		}
	}
	if resultFsh == nil {
		return nil, errors.New("Filesystem handler with given UUID not found")
	} else {
		return resultFsh, nil
	}
}

func GetAllLoadedFsh() (out0 []*fs.FileSystemHandler) {
	defer logger.Out1(logger.In0("Core", "GetAllLoadedFsh"), &out0)
	fshTmp := map[string]*fs.FileSystemHandler{}
	allFsh := []*fs.FileSystemHandler{}
	allStoragePools := GetAllStoragePools()
	for _, thisSP := range allStoragePools {
		for _, thisFsh := range thisSP.Storages {
			fshPointer := thisFsh
			fshTmp[thisFsh.UUID] = fshPointer
		}
	}

	//Restructure the map to slice
	for _, fsh := range fshTmp {
		allFsh = append(allFsh, fsh)
	}

	return allFsh
}

func RegisterStorageSettings() {
	defer logger.Out0(logger.In0("Core", "RegisterStorageSettings"))
	//Storage Pool Configuration
	registerSetting(settingModule{
		Name:         "Storage Pools",
		Desc:         "Storage Pool Mounting Configuration",
		IconPath:     "SystemAO/disk/smart/img/small_icon.png",
		Group:        "Disk",
		StartDir:     "SystemAO/storage/poolList.html",
		RequireAdmin: true,
	})

}

// CloseAllStorages Close all storage database
func CloseAllStorages() {
	defer logger.Out0(logger.In0("Core", "CloseAllStorages"))

}

func closeAllStoragePools() {
	defer logger.Out0(logger.In0("Core", "closeAllStoragePools"))
	//Stop the storage pool heartbeat
	storageHeartbeatTickerChan <- true

	//Close all storage pools
	for _, sp := range GetAllStoragePools() {
		sp.Close()
	}
}
