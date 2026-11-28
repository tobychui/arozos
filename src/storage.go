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
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/permission"

	fs "imuslab.com/arozos/mod/filesystem"
	storage "imuslab.com/arozos/mod/storage"
)

var (
	baseStoragePool *storage.StoragePool //base storage pool, all user can access these virtual roots
	//fsHandlers      []*fs.FileSystemHandler //All File system handlers. All opened handles must be registered in here
	//storagePools    []*storage.StoragePool  //All Storage pool opened
	storageHeartbeatTickerChan chan bool //Channel to stop the storage heartbeat ticker
)

func StorageInit() {
	//Load the default handler for the user storage root
	if !fs.FileExists(filepath.Clean(*root_directory) + "/") {
		os.MkdirAll(filepath.Clean(*root_directory)+"/", 0755)
	}

	//Start loading the base storage pool
	err := LoadBaseStoragePool()
	if err != nil {
		panic(err)
	}
}

func LoadBaseStoragePool() error {
	defer logger.TracePanic("Storage", "loading the base storage pool")
	logger.Debugf("Storage", "LoadBaseStoragePool: root %q, tmp %q, config %q, replacing base pool %p", *root_directory, *tmp_directory, *storage_config_file, baseStoragePool)
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
		systemWideLogger.PrintAndLog("Storage", "Failed to initiate user root storage directory: "+*root_directory+err.Error(), err)
		return err
	}
	fsHandlers = append(fsHandlers, baseHandler)
	logger.Debugf("Storage", "LoadBaseStoragePool: user drive %s", baseHandler.Describe())

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
		systemWideLogger.PrintAndLog("Storage", "Failed to initiate tmp storage directory: "+*tmp_directory+err.Error(), err)
		return err
	}
	fsHandlers = append(fsHandlers, tmpHandler)
	logger.Debugf("Storage", "LoadBaseStoragePool: tmp drive %s", tmpHandler.Describe())

	//Load all the storage config from file
	rawConfig, err := os.ReadFile(*storage_config_file)
	if err != nil {
		//File not found. Use internal storage only
		systemWideLogger.PrintAndLog("Storage", "Storage configuration file not found. Using internal storage only.", err)
	} else {
		//Configuration loaded. Initializing handler
		logger.Debugf("Storage", "LoadBaseStoragePool: opening the drives in %q (%d bytes)", *storage_config_file, len(rawConfig))
		externalHandlers, err := fs.NewFileSystemHandlersFromJSON(rawConfig, fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		})
		if err != nil {
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
		systemWideLogger.PrintAndLog("Storage", "Failed to create base Storaeg Pool", err)
		return err
	}

	logger.Debugf("Storage", "LoadBaseStoragePool: base pool %p replaced by %p. Requests still holding drives of the old pool keep using them", baseStoragePool, sp)
	baseStoragePool = sp

	//A reload lands here too and cluster:/ is not in any config, so put it
	//back. During boot the cluster is not up yet and this changes nothing.
	clusterSyncDrive()

	logger.Debugf("Storage", "LoadBaseStoragePool: done, base pool holds %s", fs.DebugHandlerList(baseStoragePool.Storages))
	return nil
}

// Initialize the storage connection health check for all fsh.
func storageHeartbeatTickerInit() {
	ticker := time.NewTicker(60 * time.Second)
	done := make(chan bool)
	go func() {
		defer logger.TracePanic("Storage", "running the storage heartbeat ticker")
		for {
			select {
			case <-done:
				logger.Debug("Storage", "storage heartbeat ticker stopped")
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
	defer logger.TracePanic("Storage", "checking the connection of every drive (heartbeat)")
	allFsh := GetAllLoadedFsh()
	logger.Debugf("Storage", "Heartbeat: checking %d drive(s) %s", len(allFsh), fs.DebugHandlerList(allFsh))
	for _, thisFsh := range allFsh {
		if isClusterOrShareDrive(thisFsh) {
			//Built by code and followed by its own subsystem. There are no
			//start options to reconnect it from
			continue
		}
		logger.Debugf("Storage", "Heartbeat: %s", thisFsh.Describe())
		if thisFsh.FileSystemAbstraction == nil {
			//Nothing to check, and no start options would bring it back
			logger.Debugf("Storage", "Heartbeat: %s:/ has no abstraction, skipped", thisFsh.UUID)
			continue
		}
		err := thisFsh.FileSystemAbstraction.Heartbeat()
		if err != nil {
			systemWideLogger.PrintAndLog("System", "[Storage] File System Abstraction from "+thisFsh.Name+" report an error: "+err.Error(), nil)
			logger.Debugf("Storage", "Heartbeat: %s:/ failed (%v), reconnecting it from its start options", thisFsh.UUID, err)
			//Retreive the old startup config and close the pool
			originalStartOption := filesystem.FileSystemOption{}
			js, _ := json.Marshal(thisFsh.StartOptions)
			json.Unmarshal(js, &originalStartOption)

			//Create a new fsh from original start options
			newfsh, err := filesystem.NewFileSystemHandler(originalStartOption, fs.RuntimePersistenceConfig{
				LocalBufferPath: *tmp_directory,
			})
			if err != nil {
				systemWideLogger.PrintAndLog("System", "[Storage] Unable to reconnect "+thisFsh.Name+": "+err.Error(), nil)
				logger.Debugf("Storage", "Heartbeat: %s:/ reconnect failed, the old handler stays in its pools: %s", thisFsh.UUID, thisFsh.Describe())
				continue
			} else {
				//New fsh created. Close the old one
				logger.Debugf("Storage", "Heartbeat: %s:/ reconnected as %s, closing the old handler %p. Requests holding the old handler now use a closed abstraction", thisFsh.UUID, newfsh.Describe(), thisFsh)
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
			logger.Debugf("Storage", "Heartbeat: %s:/ attaching the new handler to %d pool(s)", originalStartOption.Uuid, len(parentsp))
			for _, pool := range parentsp {
				err := pool.AttachFsHandler(newfsh)
				if err != nil {
					systemWideLogger.PrintAndLog("System", "[Storage] Attach fsh to pool failed: "+err.Error(), nil)
				}
			}
			if len(parentsp) == 0 {
				logger.Debugf("Storage", "Heartbeat: %s:/ was in no pool any more, the new handler %p is not attached anywhere", originalStartOption.Uuid, newfsh)
			}
		}
	}
}

// Initialize group storage pool
func GroupStoragePoolInit() {
	logger.Debugf("Storage", "GroupStoragePoolInit: loading the pools of %d permission group(s)", len(permissionHandler.PermissionGroups))
	//Mount permission groups
	for _, pg := range permissionHandler.PermissionGroups {
		//For each group, check does this group has a config file
		err := LoadStoragePoolForGroup(pg)
		if err != nil {
			continue
		}

		//Do something else, WIP
	}

	//Start editing interface for Storage Pool Editor
	StoragePoolEditorInit()
}

func LoadStoragePoolForGroup(pg *permission.PermissionGroup) error {
	defer logger.TracePanicFunc("Storage", func() string { return "loading the storage pool of group " + pg.Name })
	expectedConfigPath := "./system/storage/" + pg.Name + ".json"
	logger.Debugf("Storage", "LoadStoragePoolForGroup(%s): config %q exists=%v, replacing pool %p", pg.Name, expectedConfigPath, fs.FileExists(expectedConfigPath), pg.StoragePool)
	if fs.FileExists(expectedConfigPath) {
		//Read the config file
		pgStorageConfig, err := os.ReadFile(expectedConfigPath)
		if err != nil {
			logger.Debugf("Storage", "LoadStoragePoolForGroup(%s): config unreadable, the group gets an empty pool: %v", pg.Name, err)
			systemWideLogger.PrintAndLog("Storage", "Failed to read config for "+pg.Name+": "+err.Error(), err)
			ensureGroupPool(pg)
			return errors.New("Failed to read config for " + pg.Name + ": " + err.Error())
		}

		//Generate fsHandler form json
		thisGroupFsHandlers, err := fs.NewFileSystemHandlersFromJSON(pgStorageConfig, fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		})

		if err != nil {
			logger.Debugf("Storage", "LoadStoragePoolForGroup(%s): config is not valid, the group gets an empty pool: %v", pg.Name, err)
			systemWideLogger.PrintAndLog("Storage", "Failed to load storage configuration: "+err.Error(), err)
			ensureGroupPool(pg)
			return errors.New("Failed to load storage configuration: " + err.Error())
		}

		//Show debug message
		for _, thisHandler := range thisGroupFsHandlers {
			systemWideLogger.PrintAndLog("Storage", thisHandler.Name+" Mounted as "+thisHandler.UUID+":/ for group "+pg.Name, err)
		}

		//Create a storage pool from these handlers
		sp, err := storage.NewStoragePool(thisGroupFsHandlers, pg.Name)
		if err != nil {
			systemWideLogger.PrintAndLog("Storage", "Failed to create storage pool for "+pg.Name, err)
			return errors.New("Failed to create storage pool for " + pg.Name)
		}

		//Assign storage pool to group
		logger.Debugf("Storage", "LoadStoragePoolForGroup(%s): pool %p replaced by %p holding %s", pg.Name, pg.StoragePool, sp, fs.DebugHandlerList(sp.Storages))
		pg.StoragePool = sp

	} else {
		//Storage configuration not exists. Fill in the basic information and move to next storage pool

		//Create a new empty storage pool for this group
		sp, err := storage.NewStoragePool([]*fs.FileSystemHandler{}, pg.Name)
		if err != nil {
			systemWideLogger.PrintAndLog("Storage", "Failed to create empty storage pool for group: "+pg.Name, err)
		}
		logger.Debugf("Storage", "LoadStoragePoolForGroup(%s): no config, pool %p replaced by empty pool %p", pg.Name, pg.StoragePool, sp)
		pg.StoragePool = sp
	}

	return nil
}

// ensureGroupPool gives a group an empty pool when it has none, so a group
// whose storage config cannot be loaded has no drives instead of a nil pool,
// which every drive listing and the heartbeat would read
func ensureGroupPool(pg *permission.PermissionGroup) {
	if pg.StoragePool == nil {
		pg.StoragePool = &storage.StoragePool{Owner: pg.Name, Storages: []*fs.FileSystemHandler{}}
	}
}

// Check if a storage pool exists by its group owner name
func StoragePoolExists(poolOwner string) bool {
	_, err := GetStoragePoolByOwner(poolOwner)
	return err == nil
}

func GetAllStoragePools() []*storage.StoragePool {
	//Append the base pool, once it is loaded
	results := []*storage.StoragePool{}
	if baseStoragePool != nil {
		results = append(results, baseStoragePool)
	} else {
		logger.Debug("Storage", "GetAllStoragePools: the base storage pool is not loaded yet, left out")
	}

	//Add each permissionGroup's pool. A group whose pool is not loaded has
	//no drives to list, and every caller reads the pools it gets
	for _, pg := range permissionHandler.PermissionGroups {
		if pg.StoragePool == nil {
			logger.Debugf("Storage", "GetAllStoragePools: group %q has no storage pool (nil), left out", pg.Name)
			continue
		}
		results = append(results, pg.StoragePool)
	}

	return results
}

func GetStoragePoolByOwner(owner string) (*storage.StoragePool, error) {
	sps := GetAllStoragePools()
	for _, pool := range sps {
		if pool.Owner == owner {
			return pool, nil
		}
	}
	return nil, errors.New("Storage pool owned by " + owner + " not found")
}

func GetFSHandlerSubpathFromVpath(vpath string) (*fs.FileSystemHandler, string, error) {
	VirtualRootID, subpath, err := fs.GetIDFromVirtualPath(vpath)
	if err != nil {
		logger.Debugf("Storage", "GetFSHandlerSubpathFromVpath(%q): no drive id: %v", vpath, err)
		return nil, "", errors.New("Unable to resolve requested path: " + err.Error())
	}

	fsh, err := GetFsHandlerByUUID(VirtualRootID)
	if err != nil {
		logger.Debugf("Storage", "GetFSHandlerSubpathFromVpath(%q): drive %s:/ not found: %v", vpath, VirtualRootID, err)
		return nil, "", errors.New("Unable to resolve requested path: " + err.Error())
	}

	if fsh == nil || fsh.FileSystemAbstraction == nil {
		//err is nil on this branch, do not dereference it for a message
		logger.Debugf("Storage", "GetFSHandlerSubpathFromVpath(%q): drive found but not loaded: %s", vpath, fsh.Describe())
		return nil, "", errors.New("Unable to resolve requested path: file system handler not loaded")
	}

	if fsh.Closed {
		logger.Debugf("Storage", "GetFSHandlerSubpathFromVpath(%q): drive closed: %s", vpath, fsh.Describe())
		return nil, "", errors.New("Target file system handler already closed")
	}

	if logger.DebugEnabled() {
		logger.Debugf("Storage", "GetFSHandlerSubpathFromVpath(%q): %s subpath %q", vpath, fsh.Describe(), subpath)
	}
	return fsh, subpath, nil
}

func GetFsHandlerByUUID(uuid string) (*fs.FileSystemHandler, error) {
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

func GetAllLoadedFsh() []*fs.FileSystemHandler {
	fshTmp := map[string]*fs.FileSystemHandler{}
	allFsh := []*fs.FileSystemHandler{}
	allStoragePools := GetAllStoragePools()
	for _, thisSP := range allStoragePools {
		for _, thisFsh := range thisSP.Storages {
			if thisFsh == nil {
				logger.Debugf("Storage", "GetAllLoadedFsh: pool %s holds a nil drive handler, skipped", thisSP.Owner)
				continue
			}
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

}

func closeAllStoragePools() {
	logger.Debug("Storage", "closeAllStoragePools: stopping the heartbeat and closing every pool")
	//Stop the storage pool heartbeat
	storageHeartbeatTickerChan <- true

	//Close all storage pools
	for _, sp := range GetAllStoragePools() {
		sp.Close()
	}
}
