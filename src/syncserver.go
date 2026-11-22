package main

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/fileservers/servers/syncserv"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/network"
	prout "imuslab.com/arozos/mod/prouter"
	user "imuslab.com/arozos/mod/user"
)

/*
	syncserver.go

	Wires the Sync Server into the file server list: an upload endpoint for
	phone automations, such as an iOS Shortcut that sends the photos of the
	last days every night. An admin turns it on, picks the groups that may
	use it and the largest file. Each of those users turns it on for their
	account, picks a folder of their drives and how uploads are sorted in it.
	See mod/fileservers/servers/syncserv.
*/

// SyncServerManager is nil when the manager could not start.
var SyncServerManager *syncserv.Manager

// SyncServerInit sets up the manager, its endpoints and its list entry.
func SyncServerInit(router, adminRouter *prout.RouterDef) {
	var err error
	SyncServerManager, err = syncserv.NewManager(&syncserv.ManagerOption{
		Sysdb: sysdb,
		//The tmp folder is emptied at every boot, which clears what an
		//interrupted upload left
		SpoolDir:    filepath.Join(*tmp_directory, "syncserver"),
		CurrentUser: fileServerCurrentUser,
		ConfirmPassword: func(w http.ResponseWriter, r *http.Request) bool {
			return AuthValidateSecureRequest(w, r, false)
		},
		CheckLoginPassword: func(username, password string) bool {
			ok, _ := authAgent.ValidateUsernameAndPasswordWithReason(username, password)
			return ok
		},
		AllowIP: func(ip string) error {
			if allowed, err := authAgent.ValidateLoginIpAccess(ip); !allowed {
				if err == nil {
					err = errors.New("This address may not sign in")
				}
				return err
			}
			return nil
		},
		ClientIP: func(r *http.Request) string {
			ip, _ := network.GetIpFromRequest(r)
			return ip
		},
		LogAuth:    fileServerLogAuth("syncserver"),
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
		OpenFolder: syncServerOpenFolder,
	})
	if err != nil {
		systemWideLogger.PrintAndLog("Sync Server", "The Sync Server is not available", err)
		SyncServerManager = nil
		return
	}

	//Deliberately outside the session router: phone automations sign in
	//with the Username and Authorization headers of every request, which
	//HandleUpload checks itself (sync password, login IP rules, wrong
	//password delays, login history)
	http.HandleFunc(syncserv.UploadPath, SyncServerManager.HandleUpload)
	//Any other address below it (a typo in the shortcut, a trailing slash)
	//gets an answer that says so, instead of the login page
	http.HandleFunc(syncserv.UploadPrefix, SyncServerManager.HandleOtherPath)

	router.HandleFunc("/system/storage/syncserver/status", SyncServerManager.HandleStatus)
	router.HandleFunc("/system/storage/syncserver/activate", SyncServerManager.HandleActivate)
	router.HandleFunc("/system/storage/syncserver/settings", SyncServerManager.HandleSettings)
	router.HandleFunc("/system/storage/syncserver/password", SyncServerManager.HandlePassword)
	router.HandleFunc("/system/storage/syncserver/deactivate", SyncServerManager.HandleDeactivate)
	router.HandleFunc("/system/storage/syncserver/forget", SyncServerManager.HandleForget)
	adminRouter.HandleFunc("/system/storage/syncserver/config", SyncServerManager.HandleConfig)
	adminRouter.HandleFunc("/system/storage/syncserver/users", SyncServerManager.HandleUsers)
	adminRouter.HandleFunc("/system/storage/syncserver/revoke", SyncServerManager.HandleRevoke)

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "syncserver",
		Name:              "Sync Server",
		Desc:              "Receive photos and files from phone automations",
		IconPath:          "img/system/network-folder-syncserver.svg",
		DefaultPorts:      []int{},
		Ports:             []int{},
		ForwardPortIfUpnp: false, //Served on the web server port
		ConnInstrPage:     "SystemAO/disk/instr/syncserver.html",
		ConfigPage:        "SystemAO/disk/syncserver.html",
		EnableCheck:       SyncServerManager.IsEnabled,
		ToggleFunc:        SyncServerManager.ServerToggle,
		GetEndpoints:      SyncServerManager.GetEndpoints,
	})
}

// syncFolder is a folder of a user's drives that uploads go to.
type syncFolder struct {
	userinfo *user.User
	fsh      *fs.FileSystemHandler
	base     string //Virtual path of the folder
	//The drive is a folder on a local disk: a received file is renamed into
	//place, and only copied when it is on another disk
	local bool
}

// syncServerOpenFolder checks a folder a user picked for uploads: the drive
// is there and mounted, and the user can write to the folder.
func syncServerOpenFolder(username, vpath string) (syncserv.Folder, error) {
	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return nil, err
	}
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return nil, errors.New("This drive cannot be found")
	}
	if fsh.Closed {
		return nil, errors.New("This drive is not mounted")
	}
	if fsh.ReadOnly || !userinfo.CanWrite(vpath) {
		return nil, errors.New("You cannot write to this folder")
	}
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return nil, errors.New("This folder cannot be used")
	}
	if fshAbs.FileExists(rpath) && !fshAbs.IsDir(rpath) {
		return nil, errors.New("This is a file, not a folder")
	}
	return &syncFolder{
		userinfo: userinfo,
		fsh:      fsh,
		base:     vpath,
		local:    !fsh.RequireBuffer && !arozfs.IsNetworkDrive(fsh.Filesystem),
	}, nil
}

func (f *syncFolder) VirtualPath(rel string) string {
	return strings.TrimSuffix(f.base, "/") + "/" + rel
}

func (f *syncFolder) realPath(rel string) (string, error) {
	return f.fsh.FileSystemAbstraction.VirtualPathToRealPath(f.VirtualPath(rel), f.userinfo.Username)
}

func (f *syncFolder) Stat(rel string) (bool, bool, int64) {
	rpath, err := f.realPath(rel)
	if err != nil {
		return false, false, 0
	}
	info, err := f.fsh.FileSystemAbstraction.Stat(rpath)
	if err != nil {
		return false, false, 0
	}
	return true, info.IsDir(), info.Size()
}

func (f *syncFolder) Open(rel string) (io.ReadCloser, error) {
	rpath, err := f.realPath(rel)
	if err != nil {
		return nil, err
	}
	return f.fsh.FileSystemAbstraction.ReadStream(rpath)
}

func (f *syncFolder) HaveSpace(size int64) bool {
	if size <= 0 || f.fsh.Hierarchy != "user" || f.userinfo.StorageQuota == nil {
		return true
	}
	return f.userinfo.StorageQuota.HaveSpace(size)
}

func (f *syncFolder) Place(spool string, rel string) error {
	vpath := f.VirtualPath(rel)
	//Access is asked on every write: a group or drive rule may have changed
	//since the folder was picked
	if !f.userinfo.CanWrite(vpath) {
		return errors.New("You cannot write to this folder")
	}
	fshAbs := f.fsh.FileSystemAbstraction
	rpath, err := f.realPath(rel)
	if err != nil {
		return err
	}
	dir := arozfs.ToSlash(filepath.Dir(rpath))
	if !fshAbs.FileExists(dir) {
		if err := fshAbs.MkdirAll(dir, 0775); err != nil {
			return err
		}
	}
	if fshAbs.FileExists(rpath) {
		//The quota no longer counts the file being replaced
		f.userinfo.RemoveOwnershipFromFile(f.fsh, vpath)
	}

	placed := false
	if f.local {
		if err := os.Rename(spool, rpath); err == nil {
			os.Chmod(rpath, 0664)
			placed = true
		}
	}
	if !placed {
		src, err := os.Open(spool)
		if err != nil {
			return err
		}
		err = fshAbs.WriteStream(rpath, src, 0775)
		src.Close()
		if err != nil {
			fshAbs.Remove(rpath)
			return err
		}
	}
	f.userinfo.SetOwnerOfFile(f.fsh, vpath)
	return nil
}
