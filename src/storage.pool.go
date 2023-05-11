package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/storage/bridge"
	"imuslab.com/arozos/mod/utils"

	fs "imuslab.com/arozos/mod/filesystem"
	prout "imuslab.com/arozos/mod/prouter"
	storage "imuslab.com/arozos/mod/storage"
)

/*
	Storage Pool Handler
	author: tobychui

	This script handle the storage pool editing of different permission groups

*/

func StoragePoolEditorInit() {

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Create the required folder structure
	err := os.MkdirAll("./system/storage", 0775)
	if err != nil {
		log.Println("Create storage pool setting folder failed: ")
		log.Fatal(err)
	}

	adminRouter.HandleFunc("/system/storage/pool/list", HandleListStoragePools)
	adminRouter.HandleFunc("/system/storage/pool/listraw", HandleListStoragePoolsConfig)
	//adminRouter.HandleFunc("/system/storage/pool/newHandler", HandleStorageNewFsHandler)
	adminRouter.HandleFunc("/system/storage/pool/removeHandler", HandleStoragePoolRemove)
	adminRouter.HandleFunc("/system/storage/pool/reload", HandleStoragePoolReload)
	adminRouter.HandleFunc("/system/storage/pool/toggle", HandleFSHToggle)
	adminRouter.HandleFunc("/system/storage/pool/edit", HandleFSHEdit)
	adminRouter.HandleFunc("/system/storage/pool/bridge", HandleFSHBridging)
	adminRouter.HandleFunc("/system/storage/pool/checkBridge", HandleFSHBridgeCheck)

}

// Handle editing of a given File System Handler
func HandleFSHEdit(w http.ResponseWriter, r *http.Request) {
	opr, _ := utils.PostPara(r, "opr")
	group, err := utils.PostPara(r, "group")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid group given")
		return
	}

	if opr == "get" {
		uuid, err := utils.PostPara(r, "uuid")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid UUID")
			return
		}

		//Load
		fshOption, err := getFSHConfigFromGroupAndUUID(group, uuid)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		//Hide the password info
		fshOption.Username = ""
		fshOption.Password = ""

		//Return as JSON
		js, _ := json.Marshal(fshOption)
		utils.SendJSONResponse(w, string(js))
		return
	} else if opr == "set" {
		config, err := utils.PostPara(r, "config")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid UUID")
			return
		}

		newFsOption, err := buildOptionFromRequestForm(config)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		//systemWideLogger.PrintAndLog("Storage", newFsOption, nil)

		uuid := newFsOption.Uuid

		//Read and remove the original settings from the config file
		err = setFSHConfigByGroupAndId(group, uuid, newFsOption)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
		} else {
			utils.SendOK(w)
		}
	} else if opr == "new" {
		//New handler
		config, err := utils.PostPara(r, "config")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid config")
			return
		}
		newFsOption, err := buildOptionFromRequestForm(config)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Check if group exists
		if !permissionHandler.GroupExists(group) && group != "system" {
			utils.SendErrorResponse(w, "Group not exists: "+group)
			return
		}

		//Validate the config is correct
		err = fs.ValidateOption(&newFsOption)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		configFile := "./system/storage.json"
		if group != "system" {
			configFile = "./system/storage/" + group + ".json"
		}

		//Merge the old config file if exists
		oldConfigs := []fs.FileSystemOption{}
		if fs.FileExists(configFile) {
			originalConfigFile, _ := os.ReadFile(configFile)
			err := json.Unmarshal(originalConfigFile, &oldConfigs)
			if err != nil {
				systemWideLogger.PrintAndLog("Storage", err.Error(), err)
			}
		}

		oldConfigs = append(oldConfigs, newFsOption)
		js, _ := json.MarshalIndent(oldConfigs, "", " ")
		err = os.WriteFile(configFile, js, 0775)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		utils.SendOK(w)

	} else {
		//Unknown
		utils.SendErrorResponse(w, "Unknown opr given")
		return
	}
}

// Get the FSH configuration for the given group and uuid
func getFSHConfigFromGroupAndUUID(group string, uuid string) (*fs.FileSystemOption, error) {
	//Spot the desired config file
	targerFile := ""
	if group == "system" {
		targerFile = "./system/storage.json"
	} else {
		targerFile = "./system/storage/" + group + ".json"
	}

	//Check if file exists.
	if !fs.FileExists(targerFile) {
		systemWideLogger.PrintAndLog("Storage", "Config file not found: "+targerFile, nil)
		return nil, errors.New("Configuration file not found")
	}

	if !fs.FileExists(filepath.Dir(targerFile)) {
		os.MkdirAll(filepath.Dir(targerFile), 0775)
	}

	//Load and parse the file
	configContent, err := os.ReadFile(targerFile)
	if err != nil {
		return nil, err
	}

	loadedConfig := []fs.FileSystemOption{}
	err = json.Unmarshal(configContent, &loadedConfig)
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Request to parse config error: "+err.Error()+targerFile, err)
		return nil, err
	}

	//Look for the target fsh uuid
	for _, thisFshConfig := range loadedConfig {
		if thisFshConfig.Uuid == uuid {
			return &thisFshConfig, nil
		}
	}

	return nil, errors.New("No FSH config found with the uuid")

}

func setFSHConfigByGroupAndId(group string, uuid string, options fs.FileSystemOption) error {
	//Spot the desired config file
	targerFile := ""
	if group == "system" {
		targerFile = "./system/storage.json"
	} else {
		targerFile = "./system/storage/" + group + ".json"
	}

	//Check if file exists.
	if !fs.FileExists(targerFile) {
		systemWideLogger.PrintAndLog("Storage", "Config file not found: "+targerFile, nil)
		return errors.New("Configuration file not found")
	}

	if !fs.FileExists(filepath.Dir(targerFile)) {
		os.MkdirAll(filepath.Dir(targerFile), 0775)
	}

	//Load and parse the file
	configContent, err := os.ReadFile(targerFile)
	if err != nil {
		return err
	}

	loadedConfig := []fs.FileSystemOption{}
	err = json.Unmarshal(configContent, &loadedConfig)
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Request to parse config error: "+err.Error()+targerFile, err)
		return err
	}

	//Filter the old fs handler option with given uuid
	newConfig := []fs.FileSystemOption{}
	var overwritingConfig fs.FileSystemOption
	for _, fso := range loadedConfig {
		if fso.Uuid != uuid {
			newConfig = append(newConfig, fso)
		} else {
			overwritingConfig = fso
		}
	}

	//Continue using the old username and password if it is left empty
	if options.Username == "" {
		options.Username = overwritingConfig.Username
	}
	if options.Password == "" {
		options.Password = overwritingConfig.Password
	}

	//Append the new fso to config
	newConfig = append(newConfig, options)

	//Write config back to file
	js, _ := json.MarshalIndent(newConfig, "", " ")
	return os.WriteFile(targerFile, js, 0775)
}

// Handle Storage Pool toggle on-off
func HandleFSHToggle(w http.ResponseWriter, r *http.Request) {
	fsh, _ := utils.PostPara(r, "fsh")
	if fsh == "" {
		utils.SendErrorResponse(w, "Invalid File System Handler ID")
		return
	}

	group, _ := utils.PostPara(r, "group")
	if group == "" {
		utils.SendErrorResponse(w, "Invalid group ID")
		return
	}

	//Check if group exists
	if group != "system" && !permissionHandler.GroupExists(group) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	//Not allow to modify system reserved fsh
	if fsh == "user" || fsh == "tmp" {
		utils.SendErrorResponse(w, "Cannot toggle system reserved File System Handler")
		return
	}

	//Check if fsh exists
	var targetpg *permission.PermissionGroup
	var storagePool *storage.StoragePool
	if group == "system" {
		//System storage pool.
		storagePool = baseStoragePool
	} else {
		targetpg = permissionHandler.GetPermissionGroupByName(group)
		storagePool = targetpg.StoragePool
	}

	var targetFSH *fs.FileSystemHandler
	for _, thisFsh := range storagePool.Storages {
		if thisFsh.UUID == fsh {
			targetFSH = thisFsh
		}
	}

	//Target File System Handler not found
	if targetFSH == nil {
		utils.SendErrorResponse(w, "Target File System Handler not found, given: "+fsh)
		return
	}

	if targetFSH.Closed {
		//Reopen the fsh database and set this to false
		aofsPath := filepath.ToSlash(filepath.Clean(targetFSH.Path)) + "/aofs.db"
		conn, err := database.NewDatabase(aofsPath, false)
		if err == nil {
			targetFSH.FilesystemDatabase = conn
		}
		targetFSH.Closed = false
	} else {
		//Close the fsh database and set this to true
		if targetFSH.FilesystemDatabase != nil {
			targetFSH.FilesystemDatabase.Close()
		}
		targetFSH.Closed = true
	}

	//Give it some time to finish unloading
	time.Sleep(1 * time.Second)

	//Return ok
	utils.SendOK(w)

}

// Handle reload of storage pool
func HandleStoragePoolReload(w http.ResponseWriter, r *http.Request) {
	pool, _ := utils.PostPara(r, "pool")

	//Basepool super long string just to prevent any typo
	if pool == "1eb201a3-d0f6-6630-5e6d-2f40480115c5" {
		//Reload ALL storage pools
		//Reload basepool
		baseStoragePool.Close()
		emptyPool := storage.StoragePool{}
		baseStoragePool = &emptyPool

		//Start BasePool again
		err := LoadBaseStoragePool()
		if err != nil {
			systemWideLogger.PrintAndLog("Storage", err.Error(), err)
		} else {
			//Update userHandler's basePool
			userHandler.UpdateStoragePool(baseStoragePool)
		}

		//Reload all permission group's pool
		for _, pg := range permissionHandler.PermissionGroups {
			systemWideLogger.PrintAndLog("Storage", "Reloading Storage Pool for: "+pg.Name, err)

			//Pool should be exists. Close it
			pg.StoragePool.Close()

			//Create an empty pool for this permission group
			newEmptyPool := storage.StoragePool{}
			pg.StoragePool = &newEmptyPool

			//Recreate a new pool for this permission group
			//If there is no handler in config, the empty one will be kept
			LoadStoragePoolForGroup(pg)
		}

		BridgeStoragePoolInit()

	} else {

		if pool == "system" {
			//Reload basepool
			baseStoragePool.Close()
			emptyPool := storage.StoragePool{}
			baseStoragePool = &emptyPool

			//Start BasePool again
			err := LoadBaseStoragePool()
			if err != nil {
				systemWideLogger.PrintAndLog("Storage", err.Error(), err)
			} else {
				//Update userHandler's basePool
				userHandler.UpdateStoragePool(baseStoragePool)
			}

			BridgeStoragePoolForGroup("system")

		} else {
			//Reload the given storage pool
			if !permissionHandler.GroupExists(pool) {
				utils.SendErrorResponse(w, "Permission Pool owner not exists")
				return
			}

			systemWideLogger.PrintAndLog("Storage", "Reloading Storage Pool for: "+pool, nil)

			//Pool should be exists. Close it
			pg := permissionHandler.GetPermissionGroupByName(pool)

			//Record a list of uuids that reloaded, use for later checking for bridge remount
			reloadedFshUUIDs := []string{}
			for _, fsh := range pg.StoragePool.Storages {
				//Close the fsh if it is not a bridged one
				isBridged, _ := bridgeManager.IsBridgedFSH(fsh.UUID, pg.Name)
				if !isBridged && !fsh.Closed {
					fsh.Close()
					reloadedFshUUIDs = append(reloadedFshUUIDs, fsh.UUID)
				}
			}

			//Create an empty pool for this permission group
			newEmptyPool := storage.StoragePool{}
			pg.StoragePool = &newEmptyPool

			//Recreate a new pool for this permission group
			//If there is no handler in config, the empty one will be kept
			LoadStoragePoolForGroup(pg)
			BridgeStoragePoolForGroup(pg.Name)

			//Get all the groups that have bridged the reloaded fshs
			rebridgePendingMap := map[string]bool{}
			for _, fshuuid := range reloadedFshUUIDs {
				pgs := bridgeManager.GetBridgedGroups(fshuuid)
				for _, pg := range pgs {
					rebridgePendingMap[pg] = true
				}
			}

			//Debridge and rebridge all the related storage pools
			for pg, _ := range rebridgePendingMap {
				DebridgeAllFSHandlerFromGroup(pg)
				time.Sleep(100 * time.Millisecond)
				BridgeStoragePoolForGroup(pg)
			}

		}
	}

	utils.SendOK(w)
}

func HandleStoragePoolRemove(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.PostPara(r, "group")
	if err != nil {
		utils.SendErrorResponse(w, "group not defined")
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		utils.SendErrorResponse(w, "File system handler UUID not defined")
		return
	}

	targetConfigFile := "./system/storage.json"
	if groupname == "system" {
		if uuid == "user" || uuid == "tmp" {
			utils.SendErrorResponse(w, "Cannot remove system reserved file system handlers")
			return
		}
		//Ok to continue
	} else {
		//Check group exists
		if !permissionHandler.GroupExists(groupname) {
			utils.SendErrorResponse(w, "Group not exists")
			return
		}

		targetConfigFile = "./system/storage/" + groupname + ".json"
		if !fs.FileExists(targetConfigFile) {
			//No config. Create an empty one
			initConfig := []fs.FileSystemOption{}
			js, _ := json.MarshalIndent(initConfig, "", " ")
			os.WriteFile(targetConfigFile, js, 0775)
		}
	}

	//Check if this handler is bridged handler
	bridged, _ := bridgeManager.IsBridgedFSH(uuid, groupname)
	if bridged {
		//Bridged FSH. Remove it from bridge config
		basePool, err := GetStoragePoolByOwner(groupname)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		err = DebridgeFSHandlerFromGroup(uuid, basePool)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Remove it from the config
		bridgeManager.RemoveFromConfig(uuid, groupname)
		utils.SendOK(w)
		return
	} else {
		//Remove it from the json file
		//Read and parse from old config
		oldConfigs := []fs.FileSystemOption{}
		originalConfigFile, _ := os.ReadFile(targetConfigFile)
		err = json.Unmarshal(originalConfigFile, &oldConfigs)
		if err != nil {
			utils.SendErrorResponse(w, "Failed to parse original config file")
			return
		}

		//Generate new confic by filtering
		newConfigs := []fs.FileSystemOption{}
		for _, config := range oldConfigs {
			if config.Uuid != uuid {
				newConfigs = append(newConfigs, config)
			}
		}

		//Parse and put it into file
		if len(newConfigs) > 0 {
			js, _ := json.MarshalIndent(newConfigs, "", " ")

			os.WriteFile(targetConfigFile, js, 0777)
		} else {
			os.Remove(targetConfigFile)
		}
	}

	utils.SendOK(w)
}

// Constract a fsoption from form
func buildOptionFromRequestForm(payload string) (fs.FileSystemOption, error) {
	newFsOption := fs.FileSystemOption{}
	err := json.Unmarshal([]byte(payload), &newFsOption)
	if err != nil {
		return fs.FileSystemOption{}, err
	}
	return newFsOption, nil
}

/*
func HandleStorageNewFsHandler(w http.ResponseWriter, r *http.Request) {
	newFsOption, _ := buildOptionFromRequestForm(r)

	type errorObject struct {
		Message string
		Source  string
	}

	//Get group from form data
	groupName := r.FormValue("group")

	//Check if group exists
	if !permissionHandler.GroupExists(groupName) && groupName != "system" {
		js, _ := json.Marshal(errorObject{
			Message: "Group not exists: " + groupName,
			Source:  "",
		})
		http.Redirect(w, r, "../../../SystemAO/storage/error.html#"+string(js), 307)
	}

	//Validate the config
	err := fs.ValidateOption(&newFsOption)
	if err != nil {
		//Serve an error page
		js, _ := json.Marshal(errorObject{
			Message: err.Error(),
			Source:  groupName,
		})
		http.Redirect(w, r, "../../../SystemAO/storage/error.html#"+string(js), 307)
		return
	}

	//Ok. Append to the record
	configFile := "./system/storage.json"
	if groupName != "system" {
		configFile = "./system/storage/" + groupName + ".json"
	}

	//If file exists, merge it to
	oldConfigs := []fs.FileSystemOption{}
	if fs.FileExists(configFile) {
		originalConfigFile, _ := os.ReadFile(configFile)
		err := json.Unmarshal(originalConfigFile, &oldConfigs)
		if err != nil {
			systemWideLogger.PrintAndLog(err,nil)
		}
	}

	oldConfigs = append(oldConfigs, newFsOption)

	//Prepare the content to be written
	js, _ := json.Marshal(oldConfigs)
	resultingJson := pretty.Pretty(js)

	err = os.WriteFile(configFile, resultingJson, 0775)
	if err != nil {
		//Write Error. This could sometime happens on Windows host for unknown reason
		js, _ := json.Marshal(errorObject{
			Message: err.Error(),
			Source:  groupName,
		})
		http.Redirect(w, r, "../../../SystemAO/storage/error.html#"+string(js), 307)
		return
	}
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, post-check=0, pre-check=0")
	http.Redirect(w, r, "../../../SystemAO/storage/poolEditor.html#"+groupName, 307)
}
*/

func HandleListStoragePoolsConfig(w http.ResponseWriter, r *http.Request) {
	target, _ := utils.GetPara(r, "target")
	if target == "" {
		target = "system"
	}

	target = strings.ReplaceAll(filepath.ToSlash(target), "/", "")

	//List the target storage pool config
	targetFile := "./system/storage.json"
	if target != "system" {
		targetFile = "./system/storage/" + target + ".json"
	}

	if !fs.FileExists(targetFile) {
		//Assume no storage.
		nofsh := []*fs.FileSystemOption{}
		js, _ := json.Marshal(nofsh)
		utils.SendJSONResponse(w, string(js))
		return
	}

	//Read and serve it
	configContent, err := os.ReadFile(targetFile)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	} else {
		utils.SendJSONResponse(w, string(configContent))
	}
}

// Return all storage pool mounted to the system, aka base pool + pg pools
func HandleListStoragePools(w http.ResponseWriter, r *http.Request) {
	filter, _ := utils.GetPara(r, "filter")

	storagePools := []*storage.StoragePool{}

	if filter != "" {
		if filter == "system" {
			storagePools = append(storagePools, baseStoragePool)
		} else {
			for _, pg := range userHandler.GetPermissionHandler().PermissionGroups {
				if pg.Name == filter {
					storagePools = append(storagePools, pg.StoragePool)
				}
			}
		}
	} else {
		//Add the base pool into the list
		storagePools = append(storagePools, baseStoragePool)

		for _, pg := range userHandler.GetPermissionHandler().PermissionGroups {
			storagePools = append(storagePools, pg.StoragePool)
		}

	}

	js, _ := json.Marshal(storagePools)
	utils.SendJSONResponse(w, string(js))
}

// Handler for bridging two FSH, require admin permission
func HandleFSHBridging(w http.ResponseWriter, r *http.Request) {
	//Get the target pool and fsh to bridge
	basePool, err := utils.PostPara(r, "base")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid base pool")
		return
	}

	//Add the target FSH into the base pool
	basePoolObject, err := GetStoragePoolByOwner(basePool)
	if err != nil {
		systemWideLogger.PrintAndLog("Storage", "Bridge FSH failed: "+err.Error(), err)
		utils.SendErrorResponse(w, "Storage pool not found")
		return
	}

	targetFSH, err := utils.PostPara(r, "fsh")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid File System Handler given")
		return
	}

	fsh, err := GetFsHandlerByUUID(targetFSH)
	if err != nil {
		utils.SendErrorResponse(w, "Given File System Handler UUID does not exists")
		return
	}

	err = BridgeFSHandlerToGroup(fsh, basePoolObject)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	bridgeConfig := bridge.BridgeConfig{
		FSHUUID: fsh.UUID,
		SPOwner: basePoolObject.Owner,
	}

	//Write changes to file
	err = bridgeManager.AppendToConfig(&bridgeConfig)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func HandleFSHBridgeCheck(w http.ResponseWriter, r *http.Request) {
	basePool, err := utils.PostPara(r, "base")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid base pool")
		return
	}

	fsh, err := utils.PostPara(r, "fsh")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid fsh UUID")
		return
	}

	isBridged, err := bridgeManager.IsBridgedFSH(fsh, basePool)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(isBridged)
	utils.SendJSONResponse(w, string(js))
}
