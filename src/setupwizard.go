package main

/*
	Setup Wizard backend

	The administrator group of a new installation boots into the Setup Wizard
	WebApp (web/Setup Wizard, see its README.md) instead of the desktop. Most
	of its steps call the endpoints the System Settings pages use (storage
	pools, permission groups, accounts, file servers); this file adds what
	the wizard needs on top of them:

	/system/setup/state        everything the wizard shows, in one read
	/system/setup/progress     the step and choices, so a closed tab resumes
	/system/setup/disks        the disks of the host and what uses them
	/system/setup/disk/format  format a disk nothing uses (Linux, password)
	/system/setup/disk/add     mount a disk partition and add it as a drive
	/system/setup/finish       boot the admins into their chosen interface
	                           and disable the wizard (also used to skip it)

	All of them are admin only.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/permission"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/setupwizard"
	"imuslab.com/arozos/mod/utils"
)

const (
	setupWizardTable   = "setupwizard"
	setupProgressKey   = "progress"
	setupProgressLimit = 32 << 10 //The saved progress is a small JSON object
	interfaceModGroup  = "Interface Module"
)

func SetupWizardInit() {
	if err := sysdb.NewTable(setupWizardTable); err != nil {
		systemWideLogger.PrintAndLog("Setup Wizard", "Could not create the setup wizard table", err)
		return
	}

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})
	router.HandleFunc("/system/setup/state", handleSetupState)
	router.HandleFunc("/system/setup/progress", handleSetupProgress)
	router.HandleFunc("/system/setup/disks", handleSetupDisks)
	router.HandleFunc("/system/setup/disk/format", handleSetupDiskFormat)
	router.HandleFunc("/system/setup/disk/add", handleSetupDiskAdd)
	router.HandleFunc("/system/setup/finish", handleSetupFinish)
}

/*
	State
*/

type setupInterfaceInfo struct {
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	IconPath string `json:"icon"`
}

type setupGroupInfo struct {
	Name      string   `json:"name"`
	IsAdmin   bool     `json:"isAdmin"`
	Interface string   `json:"interface"`
	Quota     int64    `json:"quota"`
	Modules   []string `json:"modules"`
}

type setupFileServerInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Desc       string `json:"desc"`
	IconPath   string `json:"icon"`
	Enabled    bool   `json:"enabled"`
	ConfigPage string `json:"configPage"`
}

type setupStateInfo struct {
	Active         bool                  `json:"active"` //An admin group still boots into the wizard
	Username       string                `json:"username"`
	Hostname       string                `json:"hostname"`
	Platform       string                `json:"platform"`
	CanListDisks   bool                  `json:"canListDisks"`
	CanMountDisks  bool                  `json:"canMountDisks"`
	DiskNote       string                `json:"diskNote,omitempty"` //Why disks cannot be mounted: platform, sudo or hardware
	Interfaces     []setupInterfaceInfo  `json:"interfaces"`
	AdminInterface string                `json:"adminInterface"`
	Groups         []setupGroupInfo      `json:"groups"`
	Users          []string              `json:"users"`
	FileServers    []setupFileServerInfo `json:"fileServers"`
	Progress       json.RawMessage       `json:"progress"`
}

// setupWizardActive reports whether any group still boots into the wizard
func setupWizardActive() bool {
	return len(groupsBootingInto(permission.SetupWizardModule)) > 0
}

// setupInterfaces lists the interface modules a user can boot into, the
// desktop first and the wizard itself left out
func setupInterfaces() []setupInterfaceInfo {
	result := []setupInterfaceInfo{}
	for _, mod := range moduleHandler.LoadedModule {
		if !strings.EqualFold(mod.Group, interfaceModGroup) || mod.Name == permission.SetupWizardModule {
			continue
		}
		result = append(result, setupInterfaceInfo{Name: mod.Name, Desc: mod.Desc, IconPath: mod.IconPath})
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].Name == "Desktop" && result[j].Name != "Desktop"
	})
	return result
}

func handleSetupState(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	state := setupStateInfo{
		Active:       setupWizardActive(),
		Username:     userinfo.Username,
		Hostname:     *host_name,
		Platform:     platformName(),
		CanListDisks: setupwizard.Supported,
		Interfaces:   setupInterfaces(),
		Groups:       []setupGroupInfo{},
		Users:        authAgent.ListUsers(),
		FileServers:  []setupFileServerInfo{},
		Progress:     json.RawMessage("null"),
	}
	state.CanMountDisks, state.DiskNote = setupDiskSupport()

	for _, pg := range permissionHandler.PermissionGroups {
		if pg.Name == "administrator" && pg.DefaultInterfaceModule != permission.SetupWizardModule {
			state.AdminInterface = pg.DefaultInterfaceModule
		}
		state.Groups = append(state.Groups, setupGroupInfo{
			Name:      pg.Name,
			IsAdmin:   pg.IsAdmin,
			Interface: pg.DefaultInterfaceModule,
			Quota:     pg.DefaultStorageQuota,
			Modules:   pg.AccessibleModules,
		})
	}
	sort.Strings(state.Users)

	for _, server := range networkFileServerDaemon {
		state.FileServers = append(state.FileServers, setupFileServerInfo{
			ID:         server.ID,
			Name:       server.Name,
			Desc:       server.Desc,
			IconPath:   server.IconPath,
			Enabled:    server.EnableCheck != nil && server.EnableCheck(),
			ConfigPage: server.ConfigPage,
		})
	}

	progress := ""
	if err := sysdb.Read(setupWizardTable, setupProgressKey, &progress); err == nil && json.Valid([]byte(progress)) {
		state.Progress = json.RawMessage(progress)
	}

	js, _ := json.Marshal(state)
	utils.SendJSONResponse(w, string(js))
}

// platformName is the host OS as the wizard words it
func platformName() string {
	if setupwizard.Supported {
		return "linux"
	}
	return runtime.GOOS
}

// setupDiskSupport tells whether disks can be mounted and formatted here,
// and if not, why
func setupDiskSupport() (bool, string) {
	switch {
	case !setupwizard.Supported:
		return false, "platform"
	case !*allow_hardware_management:
		return false, "hardware"
	case !sudo_mode:
		return false, "sudo"
	}
	return true, ""
}

/*
	Progress
*/

// handleSetupProgress saves (POST progress=<json>) or clears (POST clear=true)
// what the wizard needs to resume. It never holds passwords.
func handleSetupProgress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	if clear, _ := utils.PostBool(r, "clear"); clear {
		sysdb.Delete(setupWizardTable, setupProgressKey)
		utils.SendOK(w)
		return
	}
	progress, err := utils.PostPara(r, "progress")
	if err != nil {
		utils.SendErrorResponse(w, "progress not defined")
		return
	}
	if len(progress) > setupProgressLimit || !json.Valid([]byte(progress)) {
		utils.SendErrorResponse(w, "Invalid progress")
		return
	}
	if err := sysdb.Write(setupWizardTable, setupProgressKey, progress); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

/*
	Disks
*/

// setupUsedDrives lists the local drives of every pool, plus the folder
// ArozOS runs from, so the disks behind them are never offered for format
func setupUsedDrives() []setupwizard.UsedDrive {
	used := []setupwizard.UsedDrive{}
	absolute := func(path string) string {
		if path == "" {
			return ""
		}
		if abs, err := filepath.Abs(path); err == nil {
			return filepath.ToSlash(abs)
		}
		return path
	}
	for _, pool := range collectPoolStates() {
		for _, option := range pool.config {
			if arozfs.IsNetworkDrive(option.Filesystem) {
				continue
			}
			used = append(used, setupwizard.UsedDrive{
				ID:       option.Uuid,
				Mountdev: option.Mountdev,
				DiskUUID: option.DiskUUID,
				Path:     absolute(option.Path),
			})
		}
		for _, fsh := range pool.live {
			if fsh.IsNetworkDrive() || fsh.Path == "" {
				continue
			}
			used = append(used, setupwizard.UsedDrive{ID: fsh.UUID, Path: absolute(fsh.Path)})
		}
	}
	if wd, err := os.Getwd(); err == nil {
		used = append(used, setupwizard.UsedDrive{ID: "arozos", Path: absolute(wd)})
	}
	return used
}

func handleSetupDisks(w http.ResponseWriter, r *http.Request) {
	disks, err := setupwizard.ListDisks(setupUsedDrives())
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(disks)
	utils.SendJSONResponse(w, string(js))
}

// setupConfirmPassword checks the signed in admin's password, which every
// destructive disk action asks for again
func setupConfirmPassword(w http.ResponseWriter, r *http.Request) bool {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return false
	}
	password, err := utils.PostPara(r, "password")
	if err != nil || password == "" {
		utils.SendErrorResponse(w, "Enter your password to continue")
		return false
	}
	if ok, reason := authAgent.ValidateUsernameAndPasswordWithReason(username, password); !ok {
		utils.SendErrorResponse(w, reason)
		return false
	}
	return true
}

// handleSetupDiskFormat formats a partition, or a disk without partitions,
// that nothing uses. POST device, fstype, label, password
func handleSetupDiskFormat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	if canMount, note := setupDiskSupport(); !canMount {
		utils.SendErrorResponse(w, "Disks cannot be formatted on this server ("+note+")")
		return
	}
	device, err := utils.PostPara(r, "device")
	if err != nil {
		utils.SendErrorResponse(w, "device not defined")
		return
	}
	fstype, err := utils.PostPara(r, "fstype")
	if err != nil || !utils.StringInArray(setupwizard.FormatTypes, fstype) {
		utils.SendErrorResponse(w, "File system not supported")
		return
	}
	label, _ := utils.PostPara(r, "label")
	if !setupConfirmPassword(w, r) {
		return
	}

	username, _ := authAgent.GetUserName(w, r)
	systemWideLogger.PrintAndLog("Setup Wizard", username+" is formatting "+device+" as "+fstype, nil)
	if err := setupwizard.Format(device, fstype, label, setupUsedDrives()); err != nil {
		systemWideLogger.PrintAndLog("Setup Wizard", "Formatting "+device+" failed", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	systemWideLogger.PrintAndLog("Setup Wizard", device+" formatted as "+fstype, nil)
	utils.SendOK(w)
}

// handleSetupDiskAdd adds a disk partition to the system pool as a drive.
// A partition nothing mounts is mounted under the media folder at every
// start; one the host already mounts is used as a plain folder.
// POST device, id, name, hierarchy (public or user)
func handleSetupDiskAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	device, err := utils.PostPara(r, "device")
	if err != nil {
		utils.SendErrorResponse(w, "device not defined")
		return
	}
	id, _ := utils.PostPara(r, "id")
	id = strings.TrimSpace(id)
	if !setupwizard.ValidDriveID(id) {
		utils.SendErrorResponse(w, "A drive id can only contain letters, numbers, - and _")
		return
	}
	name, _ := utils.PostPara(r, "name")
	name = strings.TrimSpace(name)
	if name == "" {
		name = id
	}
	hierarchy, _ := utils.PostPara(r, "hierarchy")
	if hierarchy != "user" {
		hierarchy = "public"
	}

	disks, err := setupwizard.ListDisks(setupUsedDrives())
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	_, part, err := setupwizard.FindPartition(disks, device)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if !part.CanAdd {
		utils.SendErrorResponse(w, "This disk cannot be added as a drive")
		return
	}

	option := fs.FileSystemOption{
		Name:       name,
		Uuid:       id,
		Access:     arozfs.FsReadWrite,
		Hierarchy:  hierarchy,
		Filesystem: part.Fstype,
	}
	mountpoint := ""
	if part.AddMode == setupwizard.AddMount {
		if canMount, note := setupDiskSupport(); !canMount {
			utils.SendErrorResponse(w, "Disks cannot be mounted on this server ("+note+")")
			return
		}
		//Refuse a taken id before a folder is made for it
		if err := validateNewDrive(&fs.FileSystemOption{Name: name, Uuid: id, Path: ".", Access: arozfs.FsReadWrite, Hierarchy: hierarchy, Filesystem: part.Fstype}, collectPoolStates()); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		mountpoint, err = setupwizard.PrepareMountPoint(id)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		option.Path = mountpoint
		option.Automount = true
		option.Mountdev = part.Path
		option.Mountpt = mountpoint
		option.DiskUUID = part.UUID
	} else {
		option.Path = part.Mountpoint
	}

	mountErr, err := addDrive(storagePoolSystem, option, nil)
	if err == nil && mountErr == nil && mountpoint != "" && !fs.CheckMounted(mountpoint) {
		//mount failed quietly: never let the drive write into the empty folder
		mountErr = errors.New("The disk could not be mounted on " + mountpoint)
	}
	if err != nil || mountErr != nil {
		if err == nil {
			//Saved but not usable: take it out again, so the user can retry
			removeDrive(storagePoolSystem, id)
			err = mountErr
		}
		if mountpoint != "" {
			//Only removes the folder if it is still empty
			os.Remove(mountpoint)
		}
		systemWideLogger.PrintAndLog("Setup Wizard", "Adding "+device+" as "+id+":/ failed", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	systemWideLogger.PrintAndLog("Setup Wizard", device+" added as drive "+id+":/", nil)
	js, _ := json.Marshal(map[string]string{"uuid": id, "path": option.Path})
	utils.SendJSONResponse(w, string(js))
}

/*
	Finish
*/

// handleSetupFinish boots every group that still opens the wizard into the
// chosen interface, then disables the wizard. Skipping uses it too, with the
// desktop. POST interface=<module name>
func handleSetupFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	target, err := utils.PostPara(r, "interface")
	if err != nil {
		target = "Desktop"
	}
	if err := finishSetupWizard(target); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	username, _ := authAgent.GetUserName(w, r)
	systemWideLogger.PrintAndLog("Setup Wizard", "Setup finished by "+username+", interface: "+target, nil)
	utils.SendOK(w)
}

func finishSetupWizard(target string) error {
	valid := false
	for _, iface := range setupInterfaces() {
		if iface.Name == target {
			valid = true
		}
	}
	if !valid {
		return errors.New("Not an interface module: " + target)
	}

	//When the wizard was opened again by an admin, their group gets the
	//chosen interface even though it no longer boots into the wizard
	groups := groupsBootingInto(permission.SetupWizardModule)
	if len(groups) == 0 {
		groups = []string{"administrator"}
	}
	for _, group := range groups {
		if err := permissionHandler.SetInterfaceModule(group, target); err != nil {
			return err
		}
	}

	sysdb.Delete(setupWizardTable, setupProgressKey)
	if moduleHandler.GetModuleInfoByID(permission.SetupWizardModule) != nil {
		if err := moduleHandler.SetModuleEnabled(permission.SetupWizardModule, false); err != nil {
			return err
		}
	}
	return nil
}
