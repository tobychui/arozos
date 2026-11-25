package main

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/fileservers/servers/syncthingserv"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/quota"
)

/*
	syncthing.go

	Wires the embedded Syncthing device into the file server list. An admin
	turns it on and picks the permission groups that may use it (admins
	always can). Each of those users links their own phones and computers and
	picks, for every folder they share, a folder of their drives to keep it in.
*/

// SyncthingManager is nil where this build carries no Syncthing.
var SyncthingManager *syncthingserv.Manager

// SyncthingInit sets up the manager, its endpoints and its list entry.
func SyncthingInit(router, adminRouter *prout.RouterDef) {
	defer logger.Out0(logger.In2("Core", "SyncthingInit", "router", router, "adminRouter", adminRouter))
	if !syncthingserv.Available() {
		return
	}
	var err error
	SyncthingManager, err = syncthingserv.NewManager(&syncthingserv.ManagerOption{
		Sysdb:      sysdb,
		StateDir:   filepath.Join("system", "syncthing"),
		DeviceName: *host_name,
		CurrentUser: func(w http.ResponseWriter, r *http.Request) (string, error) {
			userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				logger.DebugErr("Core", err)
				return "", err
			}
			return userinfo.Username, nil
		},
		ConfirmPassword: func(w http.ResponseWriter, r *http.Request) bool {
			return AuthValidateSecureRequest(w, r, false)
		},
		UserExists: authAgent.UserExists,
		IsAdmin: func(username string) bool {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			return err == nil && userinfo.IsAdmin()
		},
		InGroups: func(username string, groups []string) bool {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			return err == nil && userinfo.UserIsInOneOfTheGroupOf(groups)
		},
		ListGroups: func() []string {
			names := []string{}
			for _, group := range permissionHandler.PermissionGroups {
				names = append(names, group.Name)
			}
			return names
		},
		ResolveFolder: syncthingResolveFolder,
	})
	if err != nil {
		logger.DebugErr("Core", err)
		systemWideLogger.PrintAndLog("Syncthing", "The Syncthing server is not available", err)
		SyncthingManager = nil
		return
	}

	router.HandleFunc("/system/storage/syncthing/status", SyncthingManager.HandleStatus)
	router.HandleFunc("/system/storage/syncthing/qr", SyncthingManager.HandleQR)
	router.HandleFunc("/system/storage/syncthing/device/add", SyncthingManager.HandleDeviceAdd)
	router.HandleFunc("/system/storage/syncthing/device/edit", SyncthingManager.HandleDeviceEdit)
	router.HandleFunc("/system/storage/syncthing/device/remove", SyncthingManager.HandleDeviceRemove)
	router.HandleFunc("/system/storage/syncthing/folder/add", SyncthingManager.HandleFolderAdd)
	router.HandleFunc("/system/storage/syncthing/folder/edit", SyncthingManager.HandleFolderEdit)
	router.HandleFunc("/system/storage/syncthing/folder/remove", SyncthingManager.HandleFolderRemove)
	router.HandleFunc("/system/storage/syncthing/folder/rescan", SyncthingManager.HandleFolderRescan)
	router.HandleFunc("/system/storage/syncthing/offer/ignore", SyncthingManager.HandleOfferIgnore)
	adminRouter.HandleFunc("/system/storage/syncthing/config", SyncthingManager.HandleConfig)
	adminRouter.HandleFunc("/system/storage/syncthing/overview", SyncthingManager.HandleOverview)
	adminRouter.HandleFunc("/system/storage/syncthing/admin/remove", SyncthingManager.HandleAdminRemove)

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "syncthing",
		Name:              "Syncthing",
		Desc:              "Sync folders with phones and computers running Syncthing",
		IconPath:          "img/system/network-folder-syncthing.svg",
		DefaultPorts:      []int{syncthingserv.DefaultPort},
		Ports:             []int{},
		ForwardPortIfUpnp: false, //Syncthing opens its own port with UPnP / NAT-PMP when allowed
		ConnInstrPage:     "SystemAO/disk/instr/syncthing.html",
		ConfigPage:        "SystemAO/disk/syncthing.html",
		EnableCheck:       SyncthingManager.IsEnabled,
		ToggleFunc:        SyncthingManager.ServerToggle,
		GetEndpoints:      SyncthingManager.GetEndpoints,
	})
}

// SyncthingShutdown stops Syncthing if it is running.
func SyncthingShutdown() {
	defer logger.Out0(logger.In0("Core", "SyncthingShutdown"))
	if SyncthingManager != nil {
		SyncthingManager.Close()
	}
}

// syncthingQuota is a user's storage quota as Syncthing sees it.
type syncthingQuota struct {
	q *quota.QuotaHandler
}

func (s syncthingQuota) Usage() (int64, int64) {
	logger.DebugTrace("Core", "syncthingQuota.Usage")
	return s.q.UsedStorageQuota, s.q.TotalStorageQuota
}

func (s syncthingQuota) Recount() {
	logger.DebugTrace("Core", "syncthingQuota.Recount")
	s.q.CalculateQuotaUsage()
}

// syncthingResolveFolder finds where a folder of a user's drives is on the
// host. Syncthing writes there directly, so the checks here are the ones the
// file operations of the web desktop would make: the user can write to it,
// it is on a local disk (not a network, cloud, cluster or shared drive), and
// no symbolic link carries it off its drive or into the system folder.
func syncthingResolveFolder(username, vpath string, create bool) (out0 syncthingserv.Location, out1 error) {
	defer logger.Out2(logger.In3("Core", "syncthingResolveFolder", "username", username, "vpath", vpath, "create", create), &out0, &out1)
	none := syncthingserv.Location{}
	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, err
	}
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, errors.New("This drive cannot be found")
	}
	if fsh.Closed {
		return none, errors.New("This drive is not mounted")
	}
	if arozfs.IsNetworkDrive(fsh.Filesystem) || fsh.RequireBuffer || fsh.UUID == "tmp" || fsh.Hierarchy == "backup" {
		return none, errors.New("Syncthing can only keep folders on a local disk")
	}
	if fsh.ReadOnly || !userinfo.CanWrite(vpath) {
		return none, errors.New("You cannot write to this folder")
	}
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, username)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, err
	}
	root, err := fshAbs.VirtualPathToRealPath(fsh.UUID+":/", username)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, err
	}
	if create && !fshAbs.FileExists(rpath) {
		if err := fshAbs.MkdirAll(rpath, 0775); err != nil {
			logger.DebugErr("Core", err)
			return none, errors.New("The folder could not be created")
		}
	}
	if !fshAbs.IsDir(rpath) {
		return none, errors.New("This folder does not exist")
	}

	resolved, err := resolvedAbs(rpath)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, err
	}
	resolvedRoot, err := resolvedAbs(root)
	if err != nil {
		logger.DebugErr("Core", err)
		return none, err
	}
	if !pathWithin(resolved, resolvedRoot) {
		return none, errors.New("This folder leads outside its drive")
	}
	if system, err := resolvedAbs("system"); err == nil && (pathWithin(resolved, system) || pathWithin(system, resolved)) {
		return none, errors.New("Syncthing cannot use the system folder")
	}

	location := syncthingserv.Location{RealPath: resolved}
	if fsh.Hierarchy == "user" && userinfo.StorageQuota != nil {
		location.Quota = syncthingQuota{q: userinfo.StorageQuota}
	}
	return location, nil
}

func resolvedAbs(p string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("Core", "resolvedAbs", "p", p), &out0, &out1)
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		logger.DebugErr("Core", err)
		return "", err
	}
	return filepath.Abs(resolved)
}

// pathWithin reports p being dir or inside it.
func pathWithin(p, dir string) (out0 bool) {
	defer logger.Out1(logger.In2("Core", "pathWithin", "p", p, "dir", dir), &out0)
	p, dir = filepath.Clean(p), filepath.Clean(dir)
	if strings.EqualFold(p, dir) {
		return p == dir || filepath.Separator == '\\'
	}
	prefix := strings.TrimSuffix(dir, string(filepath.Separator)) + string(filepath.Separator)
	if filepath.Separator == '\\' {
		return strings.HasPrefix(strings.ToLower(p), strings.ToLower(prefix))
	}
	return strings.HasPrefix(p, prefix)
}
