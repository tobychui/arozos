package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/storage/access"
	"imuslab.com/arozos/mod/utils"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	prout "imuslab.com/arozos/mod/prouter"
	storage "imuslab.com/arozos/mod/storage"
)

/*
	Storage Pool Handler
	author: tobychui

	This script handle the storage pool editing of different permission groups.

	A pool is where a drive is configured and which group it belongs to. Who
	may use a drive is set on the drive itself, see storage.access.go.
*/

const (
	storagePoolSystem = "system"
	reloadAllPools    = "1eb201a3-d0f6-6630-5e6d-2f40480115c5" //Super long string just to prevent any typo

	driveKindFixed      = "fixed"      //user:/ and tmp:/, open to everyone
	driveKindBuiltin    = "builtin"    //share:/ and cluster:/, built by code, with an access list
	driveKindConfigured = "configured" //Has a row in the config of its pool

	driveStateOnline    = "online"
	driveStateStopped   = "stopped"   //Stopped by an admin until the next restart or reload
	driveStateOffline   = "offline"   //Configured, but not mounted
	driveStateRemoved   = "removed"   //Mounted, but its config row is gone. Leaves at the next reload
	driveStateNotActive = "notactive" //cluster:/ on a node with no cluster or no volume yet

	driveTestTimeout = 20 * time.Second
)

// A new drive id ends up in every virtual path of the drive
var driveIDFormat = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func StoragePoolEditorInit() {
	defer logger.Out0(logger.In0("Core", "StoragePoolEditorInit"))

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
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("System", "Create storage pool setting folder failed: ", nil)
		systemWideLogger.PrintAndLog("System", fmt.Sprint(err), nil)
		os.Exit(1)
	}

	adminRouter.HandleFunc("/system/storage/drives", HandleListDrives)
	adminRouter.HandleFunc("/system/storage/access", HandleDriveAccess)
	adminRouter.HandleFunc("/system/storage/access/explain", HandleDriveAccessExplain)
	adminRouter.HandleFunc("/system/storage/pool/removeHandler", HandleStoragePoolRemove)
	adminRouter.HandleFunc("/system/storage/pool/reload", HandleStoragePoolReload)
	adminRouter.HandleFunc("/system/storage/pool/toggle", HandleFSHToggle)
	adminRouter.HandleFunc("/system/storage/pool/edit", HandleFSHEdit)
	adminRouter.HandleFunc("/system/storage/pool/test", HandleFSHTest)
}

/*
	Pool config files
*/

// storagePoolKnown reports whether a pool of this name exists
func storagePoolKnown(pool string) (out0 bool) {
	defer logger.Out1(logger.In1("Core", "storagePoolKnown", "pool", pool), &out0)
	return pool == storagePoolSystem || permissionHandler.GroupExists(pool)
}

// poolConfigFile returns the config file of a pool
func poolConfigFile(pool string) (out0 string) {
	defer logger.Out1(logger.In1("Core", "poolConfigFile", "pool", pool), &out0)
	if pool == storagePoolSystem {
		return *storage_config_file
	}
	return "./system/storage/" + pool + ".json"
}

// readPoolConfig returns the drives configured in a pool. A pool with no
// config file has none.
func readPoolConfig(pool string) (out0 []fs.FileSystemOption, out1 error) {
	defer logger.Out2(logger.In1("Core", "readPoolConfig", "pool", pool), &out0, &out1)
	options := []fs.FileSystemOption{}
	configFile := poolConfigFile(pool)
	if !fs.FileExists(configFile) {
		return options, nil
	}
	content, err := os.ReadFile(configFile)
	if err != nil {
		logger.DebugErr("Core", err)
		return nil, err
	}
	if err := json.Unmarshal(content, &options); err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Storage", "Unable to parse storage config "+configFile, err)
		return nil, err
	}
	return options, nil
}

// writePoolConfig replaces the drives configured in a pool
func writePoolConfig(pool string, options []fs.FileSystemOption) (out0 error) {
	defer logger.Out1(logger.In2("Core", "writePoolConfig", "pool", pool, "options", options), &out0)
	configFile := poolConfigFile(pool)
	if len(options) == 0 {
		err := os.Remove(configFile)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	js, err := json.MarshalIndent(options, "", " ")
	if err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	return os.WriteFile(configFile, js, 0775)
}

// findPoolOption returns the config row of a drive in a pool, or nil
func findPoolOption(options []fs.FileSystemOption, uuid string) (out0 *fs.FileSystemOption) {
	defer logger.Out1(logger.In2("Core", "findPoolOption", "options", options, "uuid", uuid), &out0)
	for i := range options {
		if options[i].Uuid == uuid {
			return &options[i]
		}
	}
	return nil
}

// Constract a fsoption from form
func buildOptionFromRequestForm(payload string) (out0 fs.FileSystemOption, out1 error) {
	defer logger.Out2(logger.In1("Core", "buildOptionFromRequestForm", "payload", payload), &out0, &out1)
	newFsOption := fs.FileSystemOption{}
	err := json.Unmarshal([]byte(payload), &newFsOption)
	if err != nil {
		logger.DebugErr("Core", err)
		return fs.FileSystemOption{}, err
	}

	//Do data cleaning
	newFsOption.Name = strings.TrimSpace(newFsOption.Name)
	newFsOption.Uuid = strings.TrimSpace(newFsOption.Uuid)
	newFsOption.Path = strings.TrimSpace(newFsOption.Path)

	if newFsOption.Filesystem == "" {
		//A plain folder: the form does not ask, so use what this host has
		newFsOption.Filesystem = localFilesystemType()
	}
	return newFsOption, nil
}

// localFilesystemType names the file system of a local folder on this host
func localFilesystemType() (out0 string) {
	defer logger.Out1(logger.In0("Core", "localFilesystemType"), &out0)
	if runtime.GOOS == "windows" {
		return "ntfs"
	}
	return "ext4"
}

/*
	Mounting

	Saving a drive mounts it right away, so most changes need no pool reload.
*/

func mountDrive(poolOwner string, option fs.FileSystemOption) (out0 error) {
	defer logger.Out1(logger.In2("Core", "mountDrive", "poolOwner", poolOwner, "&option", &option), &out0)
	pool, err := GetStoragePoolByOwner(poolOwner)
	if err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	handler, err := fs.NewFileSystemHandler(option, fs.RuntimePersistenceConfig{
		LocalBufferPath: *tmp_directory,
	})
	if err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	if err := pool.AttachFsHandler(handler); err != nil {
		logger.DebugErr("Core", err)
		handler.Close()
		return err
	}
	systemWideLogger.PrintAndLog("Storage", handler.Name+" Mounted as "+handler.UUID+":/ for "+poolOwner, nil)
	return nil
}

func unmountDrive(poolOwner string, uuid string) {
	defer logger.Out0(logger.In2("Core", "unmountDrive", "poolOwner", poolOwner, "uuid", uuid))
	pool, err := GetStoragePoolByOwner(poolOwner)
	if err != nil {
		logger.DebugErr("Core", err)
		return
	}
	fsh, err := pool.GetFsHandlerByUUID(uuid)
	if err != nil {
		logger.DebugErr("Core", err)
		return
	}
	pool.DetachFsHandler(uuid)
	if !fsh.Closed {
		fsh.Close()
	}
}

// sendMountResult reports a saved drive. The config is kept when the mount
// fails, so the drive shows as offline and can be fixed from the page.
func sendMountResult(w http.ResponseWriter, mountErr error) {
	defer logger.Out0(logger.In1("Core", "sendMountResult", "mountErr", mountErr))
	result := struct {
		Mounted bool   `json:"mounted"`
		Reason  string `json:"reason,omitempty"`
	}{Mounted: mountErr == nil}
	if mountErr != nil {
		logger.DebugErr("Core", mountErr)
		result.Reason = mountErr.Error()
	}
	js, _ := json.Marshal(result)
	utils.SendJSONResponse(w, string(js))
}

/*
	Editing
*/

// Handle editing of a given File System Handler
func HandleFSHEdit(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleFSHEdit", "r", r))
	opr, _ := utils.PostPara(r, "opr")
	group, err := utils.PostPara(r, "group")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid group given")
		return
	}
	if !storagePoolKnown(group) {
		utils.SendErrorResponse(w, "Group not exists: "+group)
		return
	}

	switch opr {
	case "get":
		handleDriveGet(w, r, group)
	case "set":
		handleDriveSet(w, r, group)
	case "new":
		handleDriveNew(w, r, group)
	default:
		utils.SendErrorResponse(w, "Unknown opr given")
	}
}

func handleDriveGet(w http.ResponseWriter, r *http.Request, group string) {
	defer logger.Out0(logger.In2("Core", "handleDriveGet", "r", r, "group", group))
	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid UUID")
		return
	}

	fshOption, err := getFSHConfigFromGroupAndUUID(group, uuid)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	//Hide the password info
	fshOption.Username = ""
	fshOption.Password = ""

	js, _ := json.Marshal(fshOption)
	utils.SendJSONResponse(w, string(js))
}

func handleDriveSet(w http.ResponseWriter, r *http.Request, group string) {
	defer logger.Out0(logger.In2("Core", "handleDriveSet", "r", r, "group", group))
	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid UUID")
		return
	}
	config, err := utils.PostPara(r, "config")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid config")
		return
	}
	newFsOption, err := buildOptionFromRequestForm(config)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Paths, share links and the access list all carry the id. Looking the old
	//row up by a changed id would also leave it behind as a second drive.
	if newFsOption.Uuid != uuid {
		utils.SendErrorResponse(w, "The id of a drive cannot be changed")
		return
	}
	if access.IsBuiltin(uuid) {
		utils.SendErrorResponse(w, "Built-in drives cannot be edited")
		return
	}

	err = setFSHConfigByGroupAndId(group, uuid, &newFsOption)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Replace the running drive with the new settings
	unmountDrive(group, uuid)
	sendMountResult(w, mountDrive(group, newFsOption))
	driveAccessChanged()
}

func handleDriveNew(w http.ResponseWriter, r *http.Request, group string) {
	defer logger.Out0(logger.In2("Core", "handleDriveNew", "r", r, "group", group))
	config, err := utils.PostPara(r, "config")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid config")
		return
	}
	newFsOption, err := buildOptionFromRequestForm(config)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//The access list comes with the drive, so that it is not reachable by the
	//default rule for even a moment
	var rule *access.Rule
	if ruleJSON, _ := utils.PostPara(r, "access"); ruleJSON != "" {
		rule = &access.Rule{}
		if err := json.Unmarshal([]byte(ruleJSON), rule); err != nil {
			logger.DebugErr("Core", err)
			utils.SendErrorResponse(w, "Invalid access list")
			return
		}
		if err := rule.Validate(); err != nil {
			logger.DebugErr("Core", err)
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}

	mountErr, err := addDrive(group, newFsOption, rule)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendMountResult(w, mountErr)
}

// addDrive saves a new drive in a pool and mounts it. err is set when the
// drive was not saved; mountErr when it was saved but could not be mounted,
// in which case it shows as offline. rule, if given, is its access list.
func addDrive(group string, option fs.FileSystemOption, rule *access.Rule) (mountErr error, err error) {
	defer logger.Out2(logger.In3("Core", "addDrive", "group", group, "&option", &option, "rule", rule), &mountErr, &err)
	if err := validateNewDrive(&option, collectPoolStates()); err != nil {
		logger.DebugErr("Core", err)
		return nil, err
	}

	options, err := readPoolConfig(group)
	if err != nil {
		logger.DebugErr("Core", err)
		return nil, err
	}
	if err := writePoolConfig(group, append(options, option)); err != nil {
		logger.DebugErr("Core", err)
		return nil, err
	}
	if rule != nil {
		if err := driveAccessStore.Set(option.Uuid, *rule); err != nil {
			logger.DebugErr("Core", err)
			return nil, err
		}
	}

	mountErr = mountDrive(group, option)
	driveAccessChanged()
	return mountErr, nil
}

// validateNewDrive checks a drive about to be added. Drive ids are global:
// the access list and every path lookup find a drive by its id alone.
func validateNewDrive(option *fs.FileSystemOption, pools []poolState) (out0 error) {
	defer logger.Out1(logger.In2("Core", "validateNewDrive", "option", option, "pools", pools), &out0)
	if err := fs.ValidateOption(option); err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	if !driveIDFormat.MatchString(option.Uuid) {
		return errors.New("A drive id can only contain letters, numbers, - and _")
	}
	for _, pool := range pools {
		if pool.holds(option.Uuid) {
			return errors.New("Drive id " + option.Uuid + " is already used in the " + pool.owner + " pool")
		}
	}
	return nil
}

// Get the FSH configuration for the given group and uuid
func getFSHConfigFromGroupAndUUID(group string, uuid string) (out0 *fs.FileSystemOption, out1 error) {
	defer logger.Out2(logger.In2("Core", "getFSHConfigFromGroupAndUUID", "group", group, "uuid", uuid), &out0, &out1)
	options, err := readPoolConfig(group)
	if err != nil {
		logger.DebugErr("Core", err)
		return nil, err
	}
	option := findPoolOption(options, uuid)
	if option == nil {
		return nil, errors.New("No FSH config found with the uuid")
	}
	return option, nil
}

// setFSHConfigByGroupAndId replaces a config row in place, keeping the stored
// login when the form left it empty. The stored login is written back into
// options, which the caller goes on to mount.
func setFSHConfigByGroupAndId(group string, uuid string, options *fs.FileSystemOption) (out0 error) {
	defer logger.Out1(logger.In3("Core", "setFSHConfigByGroupAndId", "group", group, "uuid", uuid, "options", options), &out0)
	loadedConfig, err := readPoolConfig(group)
	if err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	current := findPoolOption(loadedConfig, uuid)
	if current == nil {
		return errors.New("No FSH config found with the uuid")
	}

	if options.Username == "" {
		options.Username = current.Username
	}
	if options.Password == "" {
		options.Password = current.Password
	}
	if err := fs.ValidateOption(options); err != nil {
		logger.DebugErr("Core", err)
		return err
	}

	*current = *options
	return writePoolConfig(group, loadedConfig)
}

// Handle Storage Pool toggle on-off
func HandleFSHToggle(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleFSHToggle", "r", r))
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
	if !storagePoolKnown(group) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	//Not allow to modify system reserved fsh
	if access.IsBuiltin(fsh) {
		utils.SendErrorResponse(w, "Cannot toggle system reserved File System Handler")
		return
	}

	storagePool, err := GetStoragePoolByOwner(group)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	targetFSH, err := storagePool.GetFsHandlerByUUID(fsh)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Target File System Handler not found, given: "+fsh)
		return
	}

	targetFSH.Closed = !targetFSH.Closed

	//Return ok
	utils.SendOK(w)

}

// reloadBasePool closes and reopens the system pool, built-in drives included
func reloadBasePool() {
	defer logger.Out0(logger.In0("Core", "reloadBasePool"))
	baseStoragePool.Close()
	emptyPool := storage.StoragePool{}
	baseStoragePool = &emptyPool

	//Start BasePool again
	err := LoadBaseStoragePool()
	if err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Storage", err.Error(), err)
		return
	}
	//Update userHandler's basePool
	userHandler.UpdateStoragePool(baseStoragePool)
}

// Handle reload of storage pool
func HandleStoragePoolReload(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleStoragePoolReload", "r", r))
	pool, _ := utils.PostPara(r, "pool")

	switch pool {
	case reloadAllPools:
		reloadBasePool()
		for _, pg := range permissionHandler.PermissionGroups {
			reloadGroupPool(pg.Name)
		}

	case storagePoolSystem:
		reloadBasePool()

	default:
		if !permissionHandler.GroupExists(pool) {
			utils.SendErrorResponse(w, "Permission Pool owner not exists")
			return
		}
		reloadGroupPool(pool)
	}

	driveAccessChanged()

	// Restart all enabled file servers so they pick up the new drive
	// configuration.  Errors are logged but do not prevent the reload
	// from succeeding.
	restartAllEnabledServers()

	utils.SendOK(w)
}

// restartAllEnabledServers stops and restarts every enabled file server.
// It is invoked after a storage pool reload to ensure file servers (SMB,
// WebDAV, SFTP, FTP, etc.) see the re-mounted drives.  Failures are
// logged to systemWideLogger but never block the reload response.
func restartAllEnabledServers() {
	defer logger.Out0(logger.In0("Core", "restartAllEnabledServers"))
	for _, fserv := range networkFileServerDaemon {
		if fserv.EnableCheck == nil || fserv.ToggleFunc == nil {
			continue
		}
		if !fserv.EnableCheck() {
			continue
		}

		systemWideLogger.PrintAndLog("Storage", fmt.Sprintf("Restarting file server: %s", fserv.Name), nil)

		// Stop
		if err := fserv.ToggleFunc(false); err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", fmt.Sprintf("Failed to stop file server %s: %v", fserv.Name, err), nil)
			continue
		}

		// Brief pause so the OS releases the port cleanly (important for
		// SMB on port 445).
		time.Sleep(500 * time.Millisecond)

		// Start
		if err := fserv.ToggleFunc(true); err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", fmt.Sprintf("Failed to restart file server %s: %v", fserv.Name, err), nil)
			continue
		}

		systemWideLogger.PrintAndLog("Storage", fmt.Sprintf("File server %s restarted successfully", fserv.Name), nil)
	}
}

// reloadGroupPool closes and reopens the pool of a permission group
func reloadGroupPool(group string) {
	defer logger.Out0(logger.In1("Core", "reloadGroupPool", "group", group))
	systemWideLogger.PrintAndLog("Storage", "Reloading Storage Pool for: "+group, nil)
	pg := permissionHandler.GetPermissionGroupByName(group)

	//Pool should be exists. Close it
	pg.StoragePool.Close()

	//Create an empty pool for this permission group
	newEmptyPool := storage.StoragePool{}
	pg.StoragePool = &newEmptyPool

	//Recreate a new pool for this permission group
	//If there is no handler in config, the empty one will be kept
	LoadStoragePoolForGroup(pg)
}

func HandleStoragePoolRemove(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleStoragePoolRemove", "r", r))
	groupname, err := utils.PostPara(r, "group")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "group not defined")
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "File system handler UUID not defined")
		return
	}

	if access.IsBuiltin(uuid) {
		utils.SendErrorResponse(w, "Cannot remove system reserved file system handlers")
		return
	}
	if !storagePoolKnown(groupname) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	if err := removeDrive(groupname, uuid); err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// removeDrive takes a drive out of a pool's config, unmounts it and drops its
// access rule once no pool holds that id any more
func removeDrive(groupname string, uuid string) (out0 error) {
	defer logger.Out1(logger.In2("Core", "removeDrive", "groupname", groupname, "uuid", uuid), &out0)
	//Generate new confic by filtering
	oldConfigs, err := readPoolConfig(groupname)
	if err != nil {
		logger.DebugErr("Core", err)
		return errors.New("Failed to parse original config file")
	}
	newConfigs := []fs.FileSystemOption{}
	for _, config := range oldConfigs {
		if config.Uuid != uuid {
			newConfigs = append(newConfigs, config)
		}
	}
	if err := writePoolConfig(groupname, newConfigs); err != nil {
		logger.DebugErr("Core", err)
		return err
	}

	unmountDrive(groupname, uuid)

	//The rule goes with the last drive of that id
	if _, stillUsed := drivePoolHome(uuid); !stillUsed {
		if err := driveAccessStore.Remove(uuid); err != nil {
			logger.DebugErr("Core", err)
			systemWideLogger.PrintAndLog("Storage", "Unable to remove the access rule of "+uuid+":/", err)
		}
	}
	driveAccessChanged()
	return nil
}

/*
	Testing a drive before saving it
*/

// HandleFSHTest tries the settings of the add and edit drive form
func HandleFSHTest(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleFSHTest", "r", r))
	config, err := utils.PostPara(r, "config")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid config")
		return
	}
	option, err := buildOptionFromRequestForm(config)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if !arozfs.IsNetworkDrive(option.Filesystem) {
		if !fs.FileExists(option.Path) {
			utils.SendErrorResponse(w, "Path not exists, given: "+option.Path)
			return
		}
		utils.SendOK(w)
		return
	}

	//Editing a drive leaves the login fields empty to keep the stored login
	group, _ := utils.PostPara(r, "group")
	if option.Username == "" && option.Password == "" && storagePoolKnown(group) {
		if stored, err := getFSHConfigFromGroupAndUUID(group, option.Uuid); err == nil {
			option.Username = stored.Username
			option.Password = stored.Password
		}
	}

	if err := testNetworkDrive(option); err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// testNetworkDrive connects to a network drive and disconnects again. A server
// that does not answer must not hold the request up for as long as its
// connection attempt takes.
func testNetworkDrive(option fs.FileSystemOption) (out0 error) {
	defer logger.Out1(logger.In1("Core", "testNetworkDrive", "&option", &option), &out0)
	if option.Uuid == "" {
		option.Uuid = "connectiontest"
	}
	option.Automount = false

	result := make(chan error, 1)
	go func() {
		handler, err := fs.NewFileSystemHandler(option, fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		})
		if err == nil {
			handler.Close()
		}
		result <- err
	}()

	select {
	case err := <-result:
		return err
	case <-time.After(driveTestTimeout):
		return errors.New("The server did not answer in time")
	}
}

/*
	The drive list

	The state of a drive used to be guessed by the page from the running pools
	and the raw config files, which sent the stored logins to the browser and
	called every drive built by code "Removed". It is worked out here instead.
*/

// poolState is what is known about one pool, running and configured
type poolState struct {
	owner  string
	live   []*fs.FileSystemHandler
	config []fs.FileSystemOption
}

// holds reports whether this pool runs or configures a drive
func (p poolState) holds(uuid string) (out0 bool) {
	defer logger.Out1(logger.In2("Core", "poolState.holds", "&p", &p, "uuid", uuid), &out0)
	for _, fsh := range p.live {
		if fsh.UUID == uuid {
			return true
		}
	}
	return findPoolOption(p.config, uuid) != nil
}

// collectPoolStates reads every pool, the system pool first
func collectPoolStates() (out0 []poolState) {
	defer logger.Out1(logger.In0("Core", "collectPoolStates"), &out0)
	states := []poolState{}
	for _, pool := range GetAllStoragePools() {
		state := poolState{owner: pool.Owner, live: pool.Storages}
		if options, err := readPoolConfig(pool.Owner); err == nil {
			state.config = options
		}
		states = append(states, state)
	}
	return states
}

// duplicateDriveIDs lists the drive ids used by more than one pool
func duplicateDriveIDs(pools []poolState) (out0 []string) {
	defer logger.Out1(logger.In1("Core", "duplicateDriveIDs", "pools", pools), &out0)
	useCount := map[string]int{}
	for _, pool := range pools {
		seen := map[string]bool{}
		for _, fsh := range pool.live {
			seen[fsh.UUID] = true
		}
		for _, option := range pool.config {
			seen[option.Uuid] = true
		}
		for uuid := range seen {
			useCount[uuid]++
		}
	}

	duplicates := []string{}
	for uuid, count := range useCount {
		if count > 1 {
			duplicates = append(duplicates, uuid)
		}
	}
	sort.Strings(duplicates)
	return duplicates
}

// driveInfo is one drive of the Storage Pools page. It never carries a login.
type driveInfo struct {
	UUID       string      `json:"uuid"`
	Name       string      `json:"name"`
	Pool       string      `json:"pool"`
	Kind       string      `json:"kind"`
	State      string      `json:"state"`
	Path       string      `json:"path"`
	Filesystem string      `json:"filesystem"`
	Hierarchy  string      `json:"hierarchy"`
	ReadOnly   bool        `json:"readOnly"`
	Duplicate  bool        `json:"duplicate"`
	Rule       access.Rule `json:"rule"`
	Editable   bool        `json:"ruleEditable"`
	Replicated bool        `json:"ruleReplicated"`
}

func driveKindOf(uuid string) (out0 string) {
	defer logger.Out1(logger.In1("Core", "driveKindOf", "uuid", uuid), &out0)
	switch {
	case access.IsFixed(uuid):
		return driveKindFixed
	case access.IsBuiltin(uuid):
		return driveKindBuiltin
	default:
		return driveKindConfigured
	}
}

// homeOfPool turns a pool owner into the home group of its drives
func homeOfPool(owner string) (out0 string) {
	defer logger.Out1(logger.In1("Core", "homeOfPool", "owner", owner), &out0)
	if owner == storagePoolSystem {
		return ""
	}
	return owner
}

// buildDriveList lists every drive of the given pools with its state and rule
func buildDriveList(pools []poolState, rules access.Source) (out0 []driveInfo) {
	defer logger.Out1(logger.In2("Core", "buildDriveList", "pools", pools, "&rules", &rules), &out0)
	duplicates := map[string]bool{}
	for _, uuid := range duplicateDriveIDs(pools) {
		duplicates[uuid] = true
	}

	drives := []driveInfo{}
	for _, pool := range pools {
		home := homeOfPool(pool.owner)
		live := map[string]bool{}

		for _, fsh := range pool.live {
			live[fsh.UUID] = true
			kind := driveKindOf(fsh.UUID)
			state := driveStateOnline
			if fsh.Closed {
				state = driveStateStopped
			} else if kind == driveKindConfigured && findPoolOption(pool.config, fsh.UUID) == nil {
				state = driveStateRemoved
			}
			drives = append(drives, driveInfo{
				UUID:       fsh.UUID,
				Name:       fsh.Name,
				Pool:       pool.owner,
				Kind:       kind,
				State:      state,
				Path:       fsh.Path,
				Filesystem: fsh.Filesystem,
				Hierarchy:  fsh.Hierarchy,
				ReadOnly:   fsh.ReadOnly,
				Duplicate:  duplicates[fsh.UUID],
				Rule:       effectiveDriveRule(rules, fsh.UUID, home),
				Editable:   kind != driveKindFixed,
			})
		}

		for _, option := range pool.config {
			if live[option.Uuid] {
				continue
			}
			drives = append(drives, driveInfo{
				UUID:       option.Uuid,
				Name:       option.Name,
				Pool:       pool.owner,
				Kind:       driveKindConfigured,
				State:      driveStateOffline,
				Path:       option.Path,
				Filesystem: option.Filesystem,
				Hierarchy:  option.Hierarchy,
				ReadOnly:   option.Access == arozfs.FsReadOnly,
				Duplicate:  duplicates[option.Uuid],
				Rule:       effectiveDriveRule(rules, option.Uuid, home),
				Editable:   true,
			})
		}
	}
	return drives
}

// applyClusterDriveState completes the row of cluster:/. Its rule belongs to
// the cluster, and a node that is not in one has nowhere to save it. Without
// a mounted drive it is listed anyway, so an admin can tell it exists.
func applyClusterDriveState(drives []driveInfo, inCluster bool, rules access.Source) (out0 []driveInfo) {
	defer logger.Out1(logger.In3("Core", "applyClusterDriveState", "drives", drives, "inCluster", inCluster, "&rules", &rules), &out0)
	for i := range drives {
		if drives[i].UUID == access.ClusterDriveID {
			drives[i].Editable = inCluster
			drives[i].Replicated = true
			return drives
		}
	}
	return append(drives, driveInfo{
		UUID:       access.ClusterDriveID,
		Name:       "Cluster",
		Pool:       storagePoolSystem,
		Kind:       driveKindBuiltin,
		State:      driveStateNotActive,
		Path:       access.ClusterDriveID + ":/",
		Filesystem: "cluster",
		Hierarchy:  "public",
		Rule:       effectiveDriveRule(rules, access.ClusterDriveID, ""),
		Editable:   inCluster,
		Replicated: true,
	})
}

// HandleListDrives returns every drive of this host with its state and rule,
// and the permission groups a rule can name
func HandleListDrives(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleListDrives", "r", r))
	type groupInfo struct {
		Name    string `json:"name"`
		IsAdmin bool   `json:"isAdmin"`
	}

	rules := driveRuleSource{}
	drives := buildDriveList(collectPoolStates(), rules)
	if !*disable_cluster {
		drives = applyClusterDriveState(drives, clusterManager != nil && clusterManager.InCluster(), rules)
	}

	groups := []groupInfo{}
	for _, pg := range permissionHandler.PermissionGroups {
		groups = append(groups, groupInfo{Name: pg.Name, IsAdmin: pg.IsAdmin})
	}

	result := struct {
		Groups    []groupInfo `json:"groups"`
		Drives    []driveInfo `json:"drives"`
		RuleError string      `json:"ruleError,omitempty"`
	}{Groups: groups, Drives: drives}
	if err := driveAccessStore.Err(); err != nil {
		logger.DebugErr("Core", err)
		result.RuleError = err.Error()
	}

	js, err := json.Marshal(result)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(js))
}

// HandleDriveAccess reads (GET) or saves (POST) the access list of a drive
func HandleDriveAccess(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleDriveAccess", "r", r))
	if r.Method != http.MethodPost {
		uuid, err := utils.GetPara(r, "uuid")
		if err != nil {
			logger.DebugErr("Core", err)
			utils.SendErrorResponse(w, "Invalid drive id")
			return
		}
		home, known := drivePoolHome(uuid)
		if !known && uuid != access.ClusterDriveID {
			utils.SendErrorResponse(w, "Drive not found: "+uuid)
			return
		}
		js, _ := json.Marshal(effectiveDriveRule(driveRuleSource{}, uuid, home))
		utils.SendJSONResponse(w, string(js))
		return
	}

	uuid, err := utils.PostPara(r, "uuid")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid drive id")
		return
	}
	ruleJSON, err := utils.PostPara(r, "rule")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid access list")
		return
	}
	rule := access.Rule{}
	if err := json.Unmarshal([]byte(ruleJSON), &rule); err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid access list")
		return
	}

	home, known := drivePoolHome(uuid)
	if !known && uuid != access.ClusterDriveID {
		utils.SendErrorResponse(w, "Drive not found: "+uuid)
		return
	}
	if err := prepareDriveRule(uuid, home, &rule); err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if err := setDriveRule(uuid, rule); err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	driveAccessChanged()
	utils.SendOK(w)
}

// prepareDriveRule checks a rule against the drive it is for. A row for the
// home group would change nothing, those members always have full access.
func prepareDriveRule(uuid string, home string, rule *access.Rule) (out0 error) {
	defer logger.Out1(logger.In3("Core", "prepareDriveRule", "uuid", uuid, "home", home, "rule", rule), &out0)
	if access.IsFixed(uuid) {
		return errors.New(uuid + ":/ is open to everyone and has no access list")
	}
	if err := rule.Validate(); err != nil {
		logger.DebugErr("Core", err)
		return err
	}
	if uuid == access.ShareDriveID {
		//The drive is read only, so it is either visible or hidden
		if rule.Other == access.ReadWrite {
			return errors.New("share:/ is read only")
		}
		for _, level := range rule.Groups {
			if level == access.ReadWrite {
				return errors.New("share:/ is read only")
			}
		}
	}
	if home != "" {
		delete(rule.Groups, home)
	}
	return nil
}

// HandleDriveAccessExplain shows which rule decided what a user may do on a drive
func HandleDriveAccessExplain(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("Core", "HandleDriveAccessExplain", "r", r))
	username, err := utils.GetPara(r, "user")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid user")
		return
	}
	uuid, err := utils.GetPara(r, "drive")
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "Invalid drive id")
		return
	}
	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		logger.DebugErr("Core", err)
		utils.SendErrorResponse(w, "User not found: "+username)
		return
	}
	decision, found := userinfo.ExplainDriveAccess(uuid)
	if !found {
		utils.SendErrorResponse(w, "Drive not found: "+uuid)
		return
	}
	js, _ := json.Marshal(decision)
	utils.SendJSONResponse(w, string(js))
}
