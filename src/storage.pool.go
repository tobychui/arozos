package main

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/permission"

	"github.com/tidwall/pretty"
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
			sendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/storage/pool/list", HandleListStoragePools)
	adminRouter.HandleFunc("/system/storage/pool/listraw", HandleListStoragePoolsConfig)
	adminRouter.HandleFunc("/system/storage/pool/newHandler", HandleStorageNewFsHandler)
	adminRouter.HandleFunc("/system/storage/pool/removeHandler", HandleStoragePoolRemove)
	adminRouter.HandleFunc("/system/storage/pool/reload", HandleStoragePoolReload)
	adminRouter.HandleFunc("/system/storage/pool/toggle", HandleFSHToggle)
	adminRouter.HandleFunc("/system/storage/pool/edit", HandleFSHEdit)
}

//Handle editing of a given File System Handler
func HandleFSHEdit(w http.ResponseWriter, r *http.Request) {
	opr, _ := mv(r, "opr", false)

	uuid, err := mv(r, "uuid", false)
	if err != nil {
		sendErrorResponse(w, "Invalid UUID")
		return
	}

	group, err := mv(r, "group", false)
	if err != nil {
		sendErrorResponse(w, "Invalid group given")
		return
	}

	if opr == "get" {
		//Load
		fshOption, err := getFSHConfigFromGroupAndUUID(group, uuid)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
		//Hide the password info
		fshOption.Username = ""
		fshOption.Password = ""

		//Return as JSON
		js, _ := json.Marshal(fshOption)
		sendJSONResponse(w, string(js))
		return
	} else if opr == "set" {
		//Set
		newFsOption := buildOptionFromRequestForm(r)
		//log.Println(newFsOption)

		//Read and remove the original settings from the config file
		err := setFSHConfigByGroupAndId(group, uuid, newFsOption)
		if err != nil {
			errmsg, _ := json.Marshal(err.Error())
			http.Redirect(w, r, "../../../SystemAO/storage/updateError.html#"+string(errmsg), 307)
		} else {
			http.Redirect(w, r, "../../../SystemAO/storage/updateComplete.html#"+group, 307)
		}

	} else {
		//Unknown
		sendErrorResponse(w, "Unknown opr given")
		return
	}
}

//Get the FSH configuration for the given group and uuid
func getFSHConfigFromGroupAndUUID(group string, uuid string) (*fs.FileSystemOption, error) {
	//Spot the desired config file
	targerFile := ""
	if group == "system" {
		targerFile = "./system/storage.json"
	} else {
		targerFile = "./system/storage/" + group + ".json"
	}

	//Check if file exists.
	if !fileExists(targerFile) {
		log.Println("Config file not found: ", targerFile)
		return nil, errors.New("Configuration file not found")
	}

	if !fileExists(filepath.Dir(targerFile)) {
		os.MkdirAll(filepath.Dir(targerFile), 0775)
	}

	//Load and parse the file
	configContent, err := ioutil.ReadFile(targerFile)
	if err != nil {
		return nil, err
	}

	loadedConfig := []fs.FileSystemOption{}
	err = json.Unmarshal(configContent, &loadedConfig)
	if err != nil {
		log.Println("Request to parse config error: "+err.Error(), targerFile)
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
	if !fileExists(targerFile) {
		log.Println("Config file not found: ", targerFile)
		return errors.New("Configuration file not found")
	}

	if !fileExists(filepath.Dir(targerFile)) {
		os.MkdirAll(filepath.Dir(targerFile), 0775)
	}

	//Load and parse the file
	configContent, err := ioutil.ReadFile(targerFile)
	if err != nil {
		return err
	}

	loadedConfig := []fs.FileSystemOption{}
	err = json.Unmarshal(configContent, &loadedConfig)
	if err != nil {
		log.Println("Request to parse config error: "+err.Error(), targerFile)
		return err
	}

	//Filter the old fs handler option with given uuid
	newConfig := []fs.FileSystemOption{}
	for _, fso := range loadedConfig {
		if fso.Uuid != uuid {
			newConfig = append(newConfig, fso)
		}
	}

	//Append the new fso to config
	newConfig = append(newConfig, options)

	//Write config back to file
	js, _ := json.MarshalIndent(newConfig, "", " ")
	return ioutil.WriteFile(targerFile, js, 0775)
}

//Handle Storage Pool toggle on-off
func HandleFSHToggle(w http.ResponseWriter, r *http.Request) {
	fsh, _ := mv(r, "fsh", true)
	if fsh == "" {
		sendErrorResponse(w, "Invalid File System Handler ID")
		return
	}

	group, _ := mv(r, "group", true)
	if group == "" {
		sendErrorResponse(w, "Invalid group ID")
		return
	}

	//Check if group exists
	if group != "system" && !permissionHandler.GroupExists(group) {
		sendErrorResponse(w, "Group not exists")
		return
	}

	//Not allow to modify system reserved fsh
	if fsh == "user" || fsh == "tmp" {
		sendErrorResponse(w, "Cannot toggle system reserved File System Handler")
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
		sendErrorResponse(w, "Target File System Handler not found, given: "+fsh)
		return
	}

	if targetFSH.Closed == true {
		//Reopen the fsh database and set this to false
		aofsPath := filepath.ToSlash(filepath.Clean(targetFSH.Path)) + "/aofs.db"
		conn, err := database.NewDatabase(aofsPath, false)
		if err != nil {
			sendErrorResponse(w, "Filesystme database startup failed")
			return
		}

		targetFSH.FilesystemDatabase = conn
		targetFSH.Closed = false
	} else {
		//Close the fsh database and set this to true
		targetFSH.FilesystemDatabase.Close()
		targetFSH.Closed = true
	}

	//Give it some time to finish unloading
	time.Sleep(1 * time.Second)

	//Return ok
	sendOK(w)

}

//Handle reload of storage pool
func HandleStoragePoolReload(w http.ResponseWriter, r *http.Request) {
	pool, _ := mv(r, "pool", true)

	//Basepool super long string just to prevent any typo
	if pool == "1eb201a3-d0f6-6630-5e6d-2f40480115c5" {
		//Reload ALL storage pools
		//Reload basepool
		baseStoragePool.Close()
		emptyPool := storage.StoragePool{}
		baseStoragePool = &emptyPool
		fsHandlers = []*fs.FileSystemHandler{}

		//Start BasePool again
		err := LoadBaseStoragePool()
		if err != nil {
			log.Println(err.Error())
		} else {
			//Update userHandler's basePool
			userHandler.UpdateStoragePool(baseStoragePool)
		}

		//Reload all permission group's pool
		for _, pg := range permissionHandler.PermissionGroups {
			log.Println("Reloading Storage Pool for: " + pg.Name)

			//Pool should be exists. Close it
			pg.StoragePool.Close()

			//Create an empty pool for this permission group
			newEmptyPool := storage.StoragePool{}
			pg.StoragePool = &newEmptyPool

			//Recreate a new pool for this permission group
			//If there is no handler in config, the empty one will be kept
			LoadStoragePoolForGroup(pg)
		}
	} else {

		if pool == "system" {
			//Reload basepool
			baseStoragePool.Close()
			emptyPool := storage.StoragePool{}
			baseStoragePool = &emptyPool
			fsHandlers = []*fs.FileSystemHandler{}

			//Start BasePool again
			err := LoadBaseStoragePool()
			if err != nil {
				log.Println(err.Error())
			} else {
				//Update userHandler's basePool
				userHandler.UpdateStoragePool(baseStoragePool)
			}

		} else {
			//Reload the given storage pool
			if !permissionHandler.GroupExists(pool) {
				sendErrorResponse(w, "Permission Pool owner not exists")
				return
			}

			log.Println("Reloading Storage Pool for: " + pool)

			//Pool should be exists. Close it
			pg := permissionHandler.GetPermissionGroupByName(pool)
			pg.StoragePool.Close()

			//Create an empty pool for this permission group
			newEmptyPool := storage.StoragePool{}
			pg.StoragePool = &newEmptyPool

			//Recreate a new pool for this permission group
			//If there is no handler in config, the empty one will be kept
			LoadStoragePoolForGroup(pg)
		}
	}

	sendOK(w)
}

func HandleStoragePoolRemove(w http.ResponseWriter, r *http.Request) {
	groupname, err := mv(r, "group", true)
	if err != nil {
		sendErrorResponse(w, "group not defined")
		return
	}

	uuid, err := mv(r, "uuid", true)
	if err != nil {
		sendErrorResponse(w, "File system handler UUID not defined")
		return
	}

	targetConfigFile := "./system/storage.json"
	if groupname == "system" {
		if uuid == "user" || uuid == "tmp" {
			sendErrorResponse(w, "Cannot remove system reserved file system handlers")
			return
		}
		//Ok to continue
	} else {
		//Check group exists
		if !permissionHandler.GroupExists(groupname) {
			sendErrorResponse(w, "Group not exists")
			return
		}

		if fileExists("./system/storage/" + groupname + ".json") {
			targetConfigFile = "./system/storage/" + groupname + ".json"
		} else {
			//No config to delete
			sendErrorResponse(w, "File system handler not exists")
			return
		}
	}

	//Remove it from the json file
	//Read and parse from old config
	oldConfigs := []fs.FileSystemOption{}
	originalConfigFile, _ := ioutil.ReadFile(targetConfigFile)
	err = json.Unmarshal(originalConfigFile, &oldConfigs)
	if err != nil {
		sendErrorResponse(w, "Failed to parse original config file")
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
		js, _ := json.Marshal(newConfigs)
		resultingJson := pretty.Pretty(js)
		ioutil.WriteFile(targetConfigFile, resultingJson, 777)
	} else {
		os.Remove(targetConfigFile)
	}

	sendOK(w)
}

//Constract a fsoption from form
func buildOptionFromRequestForm(r *http.Request) fs.FileSystemOption {
	r.ParseForm()
	autoMount := (r.FormValue("automount") == "on")
	newFsOption := fs.FileSystemOption{
		Name:       r.FormValue("name"),
		Uuid:       r.FormValue("uuid"),
		Path:       r.FormValue("path"),
		Access:     r.FormValue("access"),
		Hierarchy:  r.FormValue("hierarchy"),
		Automount:  autoMount,
		Filesystem: r.FormValue("filesystem"),
		Mountdev:   r.FormValue("mountdev"),
		Mountpt:    r.FormValue("mountpt"),

		Parentuid:  r.FormValue("parentuid"),
		BackupMode: r.FormValue("backupmode"),

		Username: r.FormValue("username"),
		Password: r.FormValue("password"),
	}

	return newFsOption
}

func HandleStorageNewFsHandler(w http.ResponseWriter, r *http.Request) {
	newFsOption := buildOptionFromRequestForm(r)

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
	if fileExists(configFile) {
		originalConfigFile, _ := ioutil.ReadFile(configFile)
		err := json.Unmarshal(originalConfigFile, &oldConfigs)
		if err != nil {
			log.Println(err)
		}
	}

	oldConfigs = append(oldConfigs, newFsOption)

	//Prepare the content to be written
	js, err := json.Marshal(oldConfigs)
	resultingJson := pretty.Pretty(js)

	err = ioutil.WriteFile(configFile, resultingJson, 0775)
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

func HandleListStoragePoolsConfig(w http.ResponseWriter, r *http.Request) {
	target, _ := mv(r, "target", false)
	if target == "" {
		target = "system"
	}

	target = strings.ReplaceAll(filepath.ToSlash(target), "/", "")

	//List the target storage pool config
	targetFile := "./system/storage.json"
	if target != "system" {
		targetFile = "./system/storage/" + target + ".json"
	}

	//Read and serve it
	configContent, err := ioutil.ReadFile(targetFile)
	if err != nil {
		sendErrorResponse(w, "Given group does not have a config file.")
		return
	} else {
		sendJSONResponse(w, string(configContent))
	}
}

//Return all storage pool mounted to the system, aka base pool + pg pools
func HandleListStoragePools(w http.ResponseWriter, r *http.Request) {
	filter, _ := mv(r, "filter", false)

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
	sendJSONResponse(w, string(js))
}
