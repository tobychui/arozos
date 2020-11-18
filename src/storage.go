package main

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	fs "imuslab.com/arozos/mod/filesystem"
	prout "imuslab.com/arozos/mod/prouter"
	storage "imuslab.com/arozos/mod/storage"
	ftp "imuslab.com/arozos/mod/storage/ftp"
)

var (
	baseStoragePool *storage.StoragePool
	fsHandlers      []*fs.FileSystemHandler
	ftpServer       *ftp.Handler
)

func StorageInit() {
	//Load the default handler for the user storage root
	if !fileExists(filepath.Clean(*root_directory) + "/") {
		os.MkdirAll(filepath.Clean(*root_directory)+"/", 0755)
	}
	baseHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name:       "User",
		Uuid:       "user",
		Path:       filepath.ToSlash(filepath.Clean(*root_directory)) + "/",
		Hierarchy:  "user",
		Automount:  false,
		Filesystem: "ext4",
	})

	if err != nil {
		log.Println("Failed to initiate user root storage directory: " + *root_directory)
		panic(err)
	}
	fsHandlers = append(fsHandlers, baseHandler)

	//Load the tmp folder as storage unit
	tmpHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name:       "tmp",
		Uuid:       "tmp",
		Path:       filepath.ToSlash(filepath.Clean(*tmp_directory)) + "/",
		Hierarchy:  "user",
		Automount:  false,
		Filesystem: "ext4",
	})

	if err != nil {
		log.Println("Failed to initiate tmp storage directory: " + *tmp_directory)
		panic(err)
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
		panic(err.Error())
	}
	//Update the storage pool permission to readwrite
	sp.OtherPermission = "readwrite"
	baseStoragePool = sp

	//Mount permission group's storage pool
	//WIP

}

//CloseAllStorages Close all storage database
func CloseAllStorages() {
	for _, fsh := range fsHandlers {
		fsh.FilesystemDatabase.Close()
	}
}

/*
	FTP Server related handlers
*/

//Handle init of the FTP server endpoints
func storageFTPServerInit() {
	//Register FTP Endpoints
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	//Create database related tables
	sysdb.NewTable("ftp")
	defaultEnable := false
	if sysdb.KeyExists("ftp", "default") {
		sysdb.Read("ftp", "default", &defaultEnable)
	} else {
		sysdb.Write("ftp", "default", false)
	}

	//Enable this service
	if defaultEnable {
		storageFTPServerStart()
	}

	adminRouter.HandleFunc("/system/storage/ftp/start", storageHandleFTPServerStart)
	adminRouter.HandleFunc("/system/storage/ftp/stop", storageHandleFTPServerStop)
	adminRouter.HandleFunc("/system/storage/ftp/upnp", storageHandleFTPuPnP)
	adminRouter.HandleFunc("/system/storage/ftp/status", storageHandleFTPServerStatus)
	adminRouter.HandleFunc("/system/storage/ftp/updateGroups", storageHandleFTPAccessUpdate)
	adminRouter.HandleFunc("/system/storage/ftp/setPort", storageHandleFTPSetPort)
}

//Start the FTP Server by request
func storageHandleFTPServerStart(w http.ResponseWriter, r *http.Request) {
	err := storageFTPServerStart()
	if err != nil {
		sendErrorResponse(w, err.Error())
	}

	//Remember the FTP server status
	sysdb.Write("ftp", "default", true)
	sendOK(w)
}

//Stop the FTP server by request
func storageHandleFTPServerStop(w http.ResponseWriter, r *http.Request) {
	if ftpServer != nil {
		ftpServer.Close()
	}
	sysdb.Write("ftp", "default", false)
	log.Println("FTP Server Stopped")
	sendOK(w)
}

//Update UPnP setting on FTP server
func storageHandleFTPuPnP(w http.ResponseWriter, r *http.Request) {
	enable, _ := mv(r, "enable", false)
	if enable == "true" {
		log.Println("Enabling UPnP on FTP Server Port")
		sysdb.Write("ftp", "upnp", true)
	} else {
		log.Println("Disabling UPnP on FTP Server Port")
		sysdb.Write("ftp", "upnp", false)
	}

	//Restart FTP Server if server is running
	if ftpServer != nil && ftpServer.ServerRunning {
		storageFTPServerStart()
	}

	sendOK(w)
}

//Update access permission on FTP server
func storageHandleFTPAccessUpdate(w http.ResponseWriter, r *http.Request) {
	//Get groups paramter from post req
	groupString, err := mv(r, "groups", true)
	if err != nil {
		sendErrorResponse(w, "groups not defined")
		return
	}

	//Prase it
	groups := []string{}
	err = json.Unmarshal([]byte(groupString), &groups)
	if err != nil {
		sendErrorResponse(w, "Unable to parse groups")
		return
	}

	log.Println("Updating FTP Access group to: ", groups)
	//Set the accessable group
	ftp.UpdateAccessableGroups(sysdb, groups)

	sendOK(w)
}

func storageHandleFTPSetPort(w http.ResponseWriter, r *http.Request) {
	port, err := mv(r, "port", true)
	if err != nil {
		sendErrorResponse(w, "Port not defined")
		return
	}

	//Try parse the port into int
	portInt, err := strconv.Atoi(port)
	if err != nil {
		sendErrorResponse(w, "Invalid port number")
		return
	}

	//Update the database port configuration
	sysdb.Write("ftp", "port", portInt)

	//Restart the FTP server
	storageFTPServerStart()

	sendOK(w)
}

func storageHandleFTPServerStatus(w http.ResponseWriter, r *http.Request) {
	type ServerStatus struct {
		Enabled     bool
		Port        int
		AllowUPNP   bool
		UPNPEnabled bool
		UserGroups  []string
	}

	enabled := false
	if ftpServer != nil && ftpServer.ServerRunning {
		enabled = true
	}

	serverPort := 21
	if sysdb.KeyExists("ftp", "port") {
		sysdb.Read("ftp", "port", &serverPort)
	}

	enableUPnP := false
	if sysdb.KeyExists("ftp", "upnp") {
		sysdb.Read("ftp", "upnp", &enableUPnP)
	}

	userGroups := []string{}
	if sysdb.KeyExists("ftp", "groups") {
		sysdb.Read("ftp", "groups", &userGroups)
	}

	jsonString, _ := json.Marshal(ServerStatus{
		Enabled:     enabled,
		Port:        serverPort,
		AllowUPNP:   *allow_upnp,
		UPNPEnabled: enableUPnP,
		UserGroups:  userGroups,
	})
	sendJSONResponse(w, string(jsonString))
}

func storageFTPServerStart() error {
	if ftpServer != nil {
		//If the previous ftp server is not closed, close it and open a new one
		if ftpServer.UPNPEnabled && UPNP != nil {
			UPNP.ClosePort(ftpServer.Port)
		}
		ftpServer.Close()
	}

	//Load new server config from database
	serverPort := int(21)
	if sysdb.KeyExists("ftp", "port") {
		sysdb.Read("ftp", "port", &serverPort)
	}

	enableUPnP := false
	if sysdb.KeyExists("ftp", "upnp") {
		sysdb.Read("ftp", "upnp", &enableUPnP)
	}

	//Create a new FTP Handler
	h, err := ftp.NewFTPHandler(userHandler, *host_name, serverPort, *tmp_directory)
	if err != nil {
		return err
	}
	h.Start()
	ftpServer = h

	if *allow_upnp {
		if enableUPnP {
			if UPNP == nil {
				return errors.New("UPnP did not started correctly on this host. Ignore this option")
			} else {
				//Forward the port
				UPNP.ForwardPort(ftpServer.Port, *host_name+" FTP Server")
				ftpServer.UPNPEnabled = true
			}

		} else {
			//UPNP disabled
			if UPNP == nil {
				return errors.New("UPnP did not started correctly on this host. Ignore this option")
			} else {
				UPNP.ClosePort(ftpServer.Port)
				ftpServer.UPNPEnabled = false
			}
		}
	}

	return nil
}
