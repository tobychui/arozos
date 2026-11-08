package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode"

	"imuslab.com/arozos/mod/disk/diskcapacity"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/fileservers/servers/smbserv"
	"imuslab.com/arozos/mod/filesystem"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/storage/smbserver/aroz"
)

/*
	smbserver.go

	Wires the built in SMB server into the file server list. It is off until
	an admin turns it on, and each user then sets an SMB password of their own.
*/

// SMBManager is nil when the manager could not start.
var SMBManager *smbserv.Manager

// netbiosName turns the host name into a NetBIOS style name.
func netbiosName(host string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(host) {
		if b.Len() == 15 {
			break
		}
		if r == '-' || r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "AROZOS"
	}
	return b.String()
}

// SMBServerInit sets up the manager, its endpoints and its list entry. It runs
// after the Samba wrapper, which it has to share port 445 with.
func SMBServerInit(router, adminRouter *prout.RouterDef) {
	//Windows keeps port 445 for its own file sharing, and only Windows 11 24H2
	//and newer clients can reach another port, so on a Windows host the
	//server, its settings and its endpoints are left out altogether
	if runtime.GOOS == "windows" {
		return
	}
	hostname, err := os.Hostname()
	if err != nil {
		hostname = *host_name
	}
	resolver := diskcapacity.NewCapacityResolver(userHandler)

	option := &smbserv.ManagerOption{
		ServerName:  netbiosName(*host_name),
		DNSName:     hostname,
		DeviceID:    deviceUUID,
		Sysdb:       sysdb,
		SecretDir:   filepath.Join("system", "smb"),
		CaptureDir:  *smb_capture,
		DisplayName: *host_name,
		AllowMDNS:   *allow_mdns,
		Trash:       smbTrash,
		//The tmp folder is emptied at every boot, which clears stale copies,
		//so a copy whose upload failed is kept in system/ instead
		StageDir: filepath.Join(*tmp_directory, "smb"),
		KeepDir:  filepath.Join("system", "smb", "failed"),
		CurrentUser: func(w http.ResponseWriter, r *http.Request) (string, error) {
			userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
			if err != nil {
				return "", err
			}
			return userinfo.Username, nil
		},
		ConfirmPassword: func(w http.ResponseWriter, r *http.Request) bool {
			return AuthValidateSecureRequest(w, r, false)
		},
		LookupUser: func(username string) (aroz.Account, aroz.Quota, error) {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				return nil, nil, err
			}
			return userinfo, userinfo.StorageQuota, nil
		},
		Capacity: func(username, vpath string) (uint64, uint64, bool) {
			info, err := resolver.ResolveCapacityInfo(username, vpath)
			if err != nil || info == nil || info.Total <= 0 {
				return 0, 0, false
			}
			return uint64(info.Total), uint64(info.Available), true
		},
		AllowIP: func(ip string) bool {
			allowed, _ := authAgent.ValidateLoginIpAccess(ip)
			return allowed
		},
		LogAuth: func(username, remote string, ok bool) {
			authAgent.Logger.LogAuthByRequestInfo(username, remote, time.Now().Unix(), ok, "smb")
		},
		UserExists: authAgent.UserExists,
		PortConflict: func() string {
			if SambaShareManager != nil && SambaShareManager.IsEnabled() {
				return "Samba"
			}
			return ""
		},
	}
	if SambaShareManager != nil {
		option.SambaHashes = SambaShareManager.ListNTHashes
	}

	SMBManager, err = smbserv.NewManager(option)
	if err != nil {
		systemWideLogger.PrintAndLog("SMB", "The SMB server is not available", err)
		return
	}

	router.HandleFunc("/system/storage/smb/status", SMBManager.HandleStatus)
	router.HandleFunc("/system/storage/smb/activate", SMBManager.HandleActivate)
	router.HandleFunc("/system/storage/smb/deactivate", SMBManager.HandleDeactivate)
	adminRouter.HandleFunc("/system/storage/smb/config", SMBManager.HandleConfig)
	adminRouter.HandleFunc("/system/storage/smb/clients", SMBManager.HandleClients)
	adminRouter.HandleFunc("/system/storage/smb/users", SMBManager.HandleUsers)
	adminRouter.HandleFunc("/system/storage/smb/revoke", SMBManager.HandleRevoke)
	adminRouter.HandleFunc("/system/storage/smb/import", SMBManager.HandleImport)

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "smb",
		Name:              "SMB (Experimental)",
		Desc:              "Built in Windows file sharing, no Samba needed",
		IconPath:          "img/system/network-samba.svg",
		DefaultPorts:      []int{smbserv.DefaultPort},
		Ports:             []int{},
		ForwardPortIfUpnp: false, //Port 445 must never reach the internet
		ConnInstrPage:     "SystemAO/disk/instr/smb.html",
		ConfigPage:        "SystemAO/disk/smb.html",
		EnableCheck:       SMBManager.IsEnabled,
		ToggleFunc:        SMBManager.ServerToggle,
		GetEndpoints:      SMBManager.GetEndpoints,
	})
}

// sambaToggle starts or stops Samba, which cannot run beside a built in server
// on the same port.
func sambaToggle(enabled bool) error {
	if enabled && SMBManager != nil && SMBManager.HoldsDefaultPort() {
		return errors.New("the built in SMB server holds port 445. Only one of them can run at a time")
	}
	return SambaShareManager.ServerToggle(enabled)
}

// SMBServerShutdown stops the SMB server if it is running.
func SMBServerShutdown() {
	if SMBManager != nil {
		SMBManager.Close()
	}
}

// smbTrash moves a file deleted over SMB into the trash bin, as the File
// Manager does, so it can be restored from there.
func smbTrash(fsh *filesystem.FileSystemHandler, subpath, rpath, username string) error {
	err := system_fs_moveToTrash(fsh, subpath, rpath, username)
	if errors.Is(err, errTrashQuota) {
		return aroz.ErrTrashFull
	}
	return err
}
