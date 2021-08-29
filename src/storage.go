package main

import (
	"errors"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/storage/bridge"

	fs "imuslab.com/arozos/mod/filesystem"
	storage "imuslab.com/arozos/mod/storage"
)

var (
	baseStoragePool *storage.StoragePool    //base storage pool, all user can access these virtual roots
	fsHandlers      []*fs.FileSystemHandler //All File system handlers. All opened handles must be registered in here
	//storagePools    []*storage.StoragePool  //All Storage pool opened
	bridgeManager *bridge.Record //Manager to handle bridged FSH
)

func StorageInit() {
	//Load the default handler for the user storage root
	if !fileExists(filepath.Clean(*root_directory) + "/") {
		os.MkdirAll(filepath.Clean(*root_directory)+"/", 0755)
	}

	//Start loading the base storage pool
	err := LoadBaseStoragePool()
	if err != nil {
		panic(err)
	}

	//Create a brdige record manager
	bm := bridge.NewBridgeRecord("system/bridge.json")
	bridgeManager = bm

}

func LoadBaseStoragePool() error {
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
	})

	if err != nil {
		log.Println("Failed to initiate user root storage directory: " + *root_directory)
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
	})

	if err != nil {
		log.Println("Failed to initiate tmp storage directory: " + *tmp_directory)
		return err
	}
	fsHandlers = append(fsHandlers, tmpHandler)

	//Load all the storage config from file
	rawConfig, err := ioutil.ReadFile(*storage_config_file)
	if err != nil {
		//File not found. Use internal storage only
		log.Println("Storage configuration file not found. Using internal storage only.")
	} else {
		//Configuration loaded. Initializing handler
		externalHandlers, err := fs.NewFileSystemHandlersFromJSON(rawConfig)
		if err != nil {
			log.Println("Failed to load storage configuration: " + err.Error() + " -- Skipping")
		} else {
			for _, thisHandler := range externalHandlers {
				fsHandlers = append(fsHandlers, thisHandler)
				log.Println(thisHandler.Name + " Mounted as " + thisHandler.UUID + ":/")
			}

		}
	}

	//Create a base storage pool for all users
	sp, err := storage.NewStoragePool(fsHandlers, "system")
	if err != nil {
		log.Println("Failed to create base Storaeg Pool")
		return err
	}

	//Update the storage pool permission to readwrite
	sp.OtherPermission = "readwrite"
	baseStoragePool = sp

	return nil
}

//Initialize group storage pool
func GroupStoragePoolInit() {
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
	expectedConfigPath := "./system/storage/" + pg.Name + ".json"
	if fileExists(expectedConfigPath) {
		//Read the config file
		pgStorageConfig, err := ioutil.ReadFile(expectedConfigPath)
		if err != nil {
			log.Println("Failed to read config for " + pg.Name + ": " + err.Error())
			return errors.New("Failed to read config for " + pg.Name + ": " + err.Error())
		}

		//Generate fsHandler form json
		thisGroupFsHandlers, err := fs.NewFileSystemHandlersFromJSON(pgStorageConfig)
		if err != nil {
			log.Println("Failed to load storage configuration: " + err.Error())
			return errors.New("Failed to load storage configuration: " + err.Error())
		}

		//Add these to mounted handlers
		for _, thisHandler := range thisGroupFsHandlers {
			fsHandlers = append(fsHandlers, thisHandler)
			log.Println(thisHandler.Name + " Mounted as " + thisHandler.UUID + ":/ for group " + pg.Name)
		}

		//Create a storage pool from these handlers
		sp, err := storage.NewStoragePool(thisGroupFsHandlers, pg.Name)
		if err != nil {
			log.Println("Failed to create storage pool for " + pg.Name)
			return errors.New("Failed to create storage pool for " + pg.Name)
		}

		//Set other permission to denied by default
		sp.OtherPermission = "denied"

		//Assign storage pool to group
		pg.StoragePool = sp

	} else {
		//Storage configuration not exists. Fill in the basic information and move to next storage pool

		//Create a new empty storage pool for this group
		sp, err := storage.NewStoragePool([]*fs.FileSystemHandler{}, pg.Name)
		if err != nil {
			log.Println("Failed to create empty storage pool for group: ", pg.Name)
		}
		pg.StoragePool = sp
		pg.StoragePool.OtherPermission = "denied"
	}

	return nil
}

//Check if a storage pool exists by its group owner name
func StoragePoolExists(poolOwner string) bool {
	_, err := GetStoragePoolByOwner(poolOwner)
	return err == nil
}

func GetAllStoragePools() []*storage.StoragePool {
	//Append the base pool
	results := []*storage.StoragePool{baseStoragePool}

	//Add each permissionGroup's pool
	for _, pg := range permissionHandler.PermissionGroups {
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

func GetFsHandlerByUUID(uuid string) (*fs.FileSystemHandler, error) {
	//Filter out the :/ fropm uuid if exists
	if strings.Contains(uuid, ":") {
		uuid = strings.Split(uuid, ":")[0]
	}

	for _, fsh := range fsHandlers {
		if fsh.UUID == uuid {
			return fsh, nil
		}
	}

	return nil, errors.New("Filesystem handler with given UUID not found")
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

//CloseAllStorages Close all storage database
func CloseAllStorages() {
	for _, fsh := range fsHandlers {
		fsh.FilesystemDatabase.Close()
	}
}

func closeAllStoragePools() {
	for _, sp := range GetAllStoragePools() {
		sp.Close()
	}
}
