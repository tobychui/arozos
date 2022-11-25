package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"

	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	uuid "github.com/satori/go.uuid"

	"imuslab.com/arozos/mod/common"
	"imuslab.com/arozos/mod/compatibility"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	fsp "imuslab.com/arozos/mod/filesystem/fspermission"
	"imuslab.com/arozos/mod/filesystem/fssort"
	"imuslab.com/arozos/mod/filesystem/fuzzy"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
	"imuslab.com/arozos/mod/filesystem/localversion"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/share"
	"imuslab.com/arozos/mod/share/shareEntry"
	storage "imuslab.com/arozos/mod/storage"
)

var (
	thumbRenderHandler *metadata.RenderHandler
	shareEntryTable    *shareEntry.ShareEntryTable
	shareManager       *share.Manager
)

type trashedFile struct {
	Filename         string
	Filepath         string
	FileExt          string
	IsDir            bool
	Filesize         int64
	RemoveTimestamp  int64
	RemoveDate       string
	OriginalPath     string
	OriginalFilename string
}

func FileSystemInit() {
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "File Manager",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Upload related functions
	router.HandleFunc("/system/file_system/upload", system_fs_handleUpload)
	router.HandleFunc("/system/file_system/lowmemUpload", system_fs_handleLowMemoryUpload)

	//Other file operations
	router.HandleFunc("/system/file_system/validateFileOpr", system_fs_validateFileOpr)
	router.HandleFunc("/system/file_system/fileOpr", system_fs_handleOpr)
	router.HandleFunc("/system/file_system/ws/fileOpr", system_fs_handleWebSocketOpr)
	router.HandleFunc("/system/file_system/listDir", system_fs_handleList)
	router.HandleFunc("/system/file_system/listDirHash", system_fs_handleDirHash)
	router.HandleFunc("/system/file_system/listRoots", system_fs_listRoot)
	router.HandleFunc("/system/file_system/listDrives", system_fs_listDrives)
	router.HandleFunc("/system/file_system/newItem", system_fs_handleNewObjects)
	router.HandleFunc("/system/file_system/preference", system_fs_handleUserPreference)
	router.HandleFunc("/system/file_system/listTrash", system_fs_scanTrashBin)
	router.HandleFunc("/system/file_system/ws/listTrash", system_fs_WebSocketScanTrashBin)
	router.HandleFunc("/system/file_system/clearTrash", system_fs_clearTrashBin)
	router.HandleFunc("/system/file_system/restoreTrash", system_fs_restoreFile)
	router.HandleFunc("/system/file_system/zipHandler", system_fs_zipHandler)
	router.HandleFunc("/system/file_system/getProperties", system_fs_getFileProperties)
	router.HandleFunc("/system/file_system/versionHistory", system_fs_FileVersionHistory)

	router.HandleFunc("/system/file_system/handleFilePermission", system_fs_handleFilePermission)
	router.HandleFunc("/system/file_system/search", system_fs_handleFileSearch)

	//Thumbnail caching functions
	router.HandleFunc("/system/file_system/handleFolderCache", system_fs_handleFolderCache)
	router.HandleFunc("/system/file_system/handleCacheRender", system_fs_handleCacheRender)
	router.HandleFunc("/system/file_system/loadThumbnail", system_fs_handleThumbnailLoad)

	//Directory specific config
	router.HandleFunc("/system/file_system/sortMode", system_fs_handleFolderSortModePreference)

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "File Manager",
		Group:       "System Tools",
		IconPath:    "SystemAO/file_system/img/small_icon.png",
		Version:     "1.0",
		StartDir:    "SystemAO/file_system/file_explorer.html",
		SupportFW:   true,
		InitFWSize:  []int{1080, 580},
		LaunchFWDir: "SystemAO/file_system/file_explorer.html",
		SupportEmb:  false,
	})

	//Register the Trashbin module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Trash Bin",
		Group:        "System Tools",
		IconPath:     "SystemAO/file_system/trashbin_img/small_icon.png",
		Version:      "1.0",
		StartDir:     "SystemAO/file_system/trashbin.html",
		SupportFW:    true,
		InitFWSize:   []int{400, 200},
		LaunchFWDir:  "SystemAO/file_system/trashbin.html",
		SupportEmb:   false,
		SupportedExt: []string{"*"},
	})

	//Register the Zip Extractor module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Zip Extractor",
		Group:        "System Tools",
		IconPath:     "SystemAO/file_system/img/zip_extractor.png",
		Version:      "1.0",
		SupportFW:    false,
		LaunchEmb:    "SystemAO/file_system/zip_extractor.html",
		SupportEmb:   true,
		InitEmbSize:  []int{260, 120},
		SupportedExt: []string{".zip"},
	})

	//Create user root if not exists
	err := os.MkdirAll(filepath.Join(*root_directory, "users/"), 0755)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Failed to create system storage root", err)
		panic(err)
	}

	//Create database table if not exists
	err = sysdb.NewTable("fs")
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Failed to create table for file system", err)
		panic(err)
	}

	//Create new table for sort preference
	err = sysdb.NewTable("fs-sortpref")
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Failed to create table for file system", err)
		panic(err)
	}

	//Create a RenderHandler for caching thumbnails
	thumbRenderHandler = metadata.NewRenderHandler()

	/*
		Share Related Registering

		This section of functions create and register the file share service
		for the arozos

	*/
	//Create a share manager to handle user file sharae
	shareEntryTable = shareEntry.NewShareEntryTable(sysdb)
	shareManager = share.NewShareManager(share.Options{
		AuthAgent:       authAgent,
		ShareEntryTable: shareEntryTable,
		UserHandler:     userHandler,
		HostName:        *host_name,
		TmpFolder:       *tmp_directory,
	})

	//Share related functions
	router.HandleFunc("/system/file_system/share/new", shareManager.HandleCreateNewShare)
	router.HandleFunc("/system/file_system/share/delete", shareManager.HandleDeleteShare)
	router.HandleFunc("/system/file_system/share/edit", shareManager.HandleEditShare)
	router.HandleFunc("/system/file_system/share/checkShared", shareManager.HandleShareCheck)
	router.HandleFunc("/system/file_system/share/list", shareManager.HandleListAllShares)

	//Handle the main share function
	//Share function is now routed by the main router
	//http.HandleFunc("/share", shareManager.HandleShareAccess)

	/*
		Nighly Tasks

		These functions allow file system to clear and maintain
		the arozos file system when no one is using the system
	*/

	//Clear tmp folder if files is placed here too long
	nightlyManager.RegisterNightlyTask(system_fs_clearOldTmpFiles)

	//Clear shares that its parent file no longer exists in the system
	shareManager.ValidateAndClearShares()
	nightlyManager.RegisterNightlyTask(shareManager.ValidateAndClearShares)

	//Clear file version history that is more than 30 days
	go func() {
		//Start version history cleaning in background
		system_fs_clearVersionHistories()
		systemWideLogger.PrintAndLog("File System", "Startup File Version History Cleaning Completed", nil)

	}()
	systemWideLogger.PrintAndLog("File System", "Started File Version History Cleaning in background", nil)

	nightlyManager.RegisterNightlyTask(system_fs_clearVersionHistories)
}

/*
	File Search

	Handle file search in wildcard and recursive search

*/

func system_fs_handleFileSearch(w http.ResponseWriter, r *http.Request) {
	//Get the user information
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the search target root path
	vpath, err := common.Mv(r, "path", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid vpath given")
		return
	}

	keyword, err := common.Mv(r, "keyword", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid keyword given")
		return
	}

	//Check if case sensitive is enabled
	casesensitve, _ := common.Mv(r, "casesensitive", true)

	vrootID, _, err := filesystem.GetIDFromVirtualPath(vpath)
	var targetFSH *filesystem.FileSystemHandler = nil
	if err != nil {
		common.SendErrorResponse(w, "Invalid path given")
		return
	}
	targetFSH, err = GetFsHandlerByUUID(vrootID)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	//Translate the vpath to realpath if this is an actual path on disk
	resolvedPath, err := targetFSH.FileSystemAbstraction.VirtualPathToRealPath(vpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, "Invalid path given")
		return
	}
	rpath := resolvedPath

	//Check if the search mode is recursive keyword or wildcard
	if len(keyword) > 1 && keyword[:1] == "/" {
		//Wildcard

		//Updates 31-12-2021: Do not allow wildcard search on virtual type's FSH
		if targetFSH == nil {
			common.SendErrorResponse(w, "Invalid path given")
			return
		}
		targetFshAbs := targetFSH.FileSystemAbstraction
		wildcard := keyword[1:]
		matchingFiles, err := targetFshAbs.Glob(filepath.Join(rpath, wildcard))
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Prepare result struct
		results := []filesystem.FileData{}

		escaped := false
		for _, matchedFile := range matchingFiles {
			thisVpath, _ := targetFSH.FileSystemAbstraction.RealPathToVirtualPath(matchedFile, userinfo.Username)
			isHidden, _ := hidden.IsHidden(thisVpath, true)
			if !isHidden {
				results = append(results, filesystem.GetFileDataFromPath(targetFSH, thisVpath, matchedFile, 2))
			}

		}

		if escaped {
			common.SendErrorResponse(w, "Search keywords contain escape character!")
			return
		}

		//OK. Tidy up the results
		js, _ := json.Marshal(results)
		common.SendJSONResponse(w, string(js))
	} else {
		//Updates 2022-02-16: Build the fuzzy matcher if it is not a wildcard search
		matcher := fuzzy.NewFuzzyMatcher(keyword, casesensitve == "true")

		//Recursive keyword
		results := []filesystem.FileData{}
		var err error = nil

		fshAbs := targetFSH.FileSystemAbstraction
		err = fshAbs.Walk(rpath, func(path string, info os.FileInfo, err error) error {
			thisFilename := filepath.Base(path)
			if casesensitve != "true" {
				thisFilename = strings.ToLower(thisFilename)
			}

			if !filesystem.IsInsideHiddenFolder(path) {
				if matcher.Match(thisFilename) {
					//This is a matching file
					thisVpath, _ := fshAbs.RealPathToVirtualPath(path, userinfo.Username)
					results = append(results, filesystem.GetFileDataFromPath(targetFSH, thisVpath, path, 2))
				}
			}

			return nil
		})

		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
		//OK. Tidy up the results
		js, _ := json.Marshal(results)
		common.SendJSONResponse(w, string(js))
	}

}

/*
	Handle low-memory upload operations

	This function is specailly designed to work with low memory devices
	(e.g. ZeroPi / Orange Pi Zero with 512MB RAM)

	Two cases
	1. Not Buffer FS + Huge File
	=> Write chunks to fsa + merge to fsa

	2. Else
	=> write chunks to tmp (via os package) + merge to fsa
*/
func system_fs_handleLowMemoryUpload(w http.ResponseWriter, r *http.Request) {
	//Get user info
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("401 - Unauthorized"))
		return
	}

	//Get filename and upload path
	filename, err := common.Mv(r, "filename", false)
	if filename == "" || err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Invalid filename given"))
		return
	}

	//Get upload target directory
	uploadTarget, err := common.Mv(r, "path", false)
	if uploadTarget == "" || err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Invalid path given"))
		return
	}

	//Unescape the upload target path
	unescapedPath, err := url.PathUnescape(uploadTarget)
	if err != nil {
		unescapedPath = uploadTarget
	}

	//Check if the user can write to this folder
	if !userinfo.CanWrite(unescapedPath) {
		//No permission
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - Access Denied"))
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(unescapedPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Path translation failed"))
		return
	}
	fshAbs := fsh.FileSystemAbstraction

	//Translate the upload target directory
	realUploadPath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Path translation failed"))
		return
	}

	//Check if it is huge file upload mode
	isHugeFile := false
	hugefile, _ := common.Mv(r, "hugefile", false)
	if hugefile == "true" && !fsh.RequireBuffer {
		//Huge file mode is only compatible with local file systems
		//For remote file system, use buffer to tmp then upload method
		isHugeFile = true
	}

	//Create destination folder if not exists
	targetUploadLocation := arozfs.ToSlash(filepath.Join(realUploadPath, filename))
	if !fshAbs.FileExists(realUploadPath) {
		fshAbs.MkdirAll(realUploadPath, 0755)
	}

	//Generate an UUID for this upload
	uploadUUID := uuid.NewV4().String()
	uploadFolder := filepath.Join(*tmp_directory, "uploads", uploadUUID)
	if isHugeFile {
		//Change to upload directly to target disk
		uploadFolder = filepath.Join(realUploadPath, ".metadata/.upload", uploadUUID)
		fshAbs.MkdirAll(uploadFolder, 0700)
	} else {
		os.MkdirAll(uploadFolder, 0700)
	}

	//Start websocket connection
	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Failed to upgrade websocket connection: ", err)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 WebSocket upgrade failed"))
		return
	}
	defer c.Close()

	//Handle WebSocket upload
	blockCounter := 0
	chunkName := []string{}
	lastChunkArrivalTime := time.Now().Unix()

	//Setup a timeout listener, check if connection still active every 1 minute
	ticker := time.NewTicker(60 * time.Second)
	done := make(chan bool)
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if time.Now().Unix()-lastChunkArrivalTime > 300 {
					//Already 5 minutes without new data arraival. Stop connection
					systemWideLogger.PrintAndLog("File System", "Upload WebSocket connection timeout. Disconnecting.", errors.New("websocket connection timeout"))
					c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
					time.Sleep(1 * time.Second)
					c.Close()
					return
				}
			}
		}
	}()

	totalFileSize := int64(0)
	for {
		mt, message, err := c.ReadMessage()
		if err != nil {
			//Connection closed by client. Clear the tmp folder and exit
			systemWideLogger.PrintAndLog("File System", "Upload terminated by client. Cleaning tmp folder", err)
			//Clear the tmp folder
			time.Sleep(1 * time.Second)
			if isHugeFile {
				fshAbs.RemoveAll(uploadFolder)
			} else {
				os.RemoveAll(uploadFolder)
			}

			return
		}
		//The mt should be 2 = binary for file upload and 1 for control syntax
		if mt == 1 {
			msg := strings.TrimSpace(string(message))
			if msg == "done" {
				//Start the merging process
				break
			} else {
				//Unknown operations

			}
		} else if mt == 2 {
			//File block. Save it to tmp folder
			chunkFilepath := filepath.Join(uploadFolder, "upld_"+strconv.Itoa(blockCounter))
			chunkName = append(chunkName, chunkFilepath)
			var writeErr error
			if isHugeFile {
				writeErr = fshAbs.WriteFile(chunkFilepath, message, 0700)
			} else {
				writeErr = os.WriteFile(chunkFilepath, message, 0700)
			}

			if writeErr != nil {
				//Unable to write block. Is the tmp folder fulled?
				systemWideLogger.PrintAndLog("File System", "Upload chunk write failed: "+err.Error(), err)
				c.WriteMessage(1, []byte(`{\"error\":\"Write file chunk to disk failed\"}`))

				//Close the connection
				c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
				time.Sleep(1 * time.Second)
				c.Close()

				//Clear the tmp files
				if isHugeFile {
					fshAbs.RemoveAll(uploadFolder)
				} else {
					os.RemoveAll(uploadFolder)
				}
				return
			}

			//Update the last upload chunk time
			lastChunkArrivalTime = time.Now().Unix()

			//Check if the file size is too big
			totalFileSize += int64(len(message))

			if totalFileSize > max_upload_size {
				//File too big
				c.WriteMessage(1, []byte(`{\"error\":\"File size too large\"}`))

				//Close the connection
				c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
				time.Sleep(1 * time.Second)
				c.Close()

				//Clear the tmp files
				if isHugeFile {
					fshAbs.RemoveAll(uploadFolder)
				} else {
					os.RemoveAll(uploadFolder)
				}
				return
			} else if !userinfo.StorageQuota.HaveSpace(totalFileSize) {
				//Quota exceeded
				c.WriteMessage(1, []byte(`{\"error\":\"User Storage Quota Exceeded\"}`))

				//Close the connection
				c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
				time.Sleep(1 * time.Second)
				c.Close()

				//Clear the tmp files
				if isHugeFile {
					fshAbs.RemoveAll(uploadFolder)
				} else {
					os.RemoveAll(uploadFolder)
				}
			}
			blockCounter++

			//Request client to send the next chunk
			c.WriteMessage(1, []byte("next"))

		}
		//systemWideLogger.PrintAndLog("File System", ("recv:", len(message), "type", mt)
	}

	//Try to decode the location if possible
	decodedUploadLocation, err := url.PathUnescape(targetUploadLocation)
	if err != nil {
		decodedUploadLocation = targetUploadLocation
	}

	//Do not allow % sign in filename. Replace all with underscore
	decodedUploadLocation = strings.ReplaceAll(decodedUploadLocation, "%", "_")

	//Merge the file. Merge file location must be on local machine
	mergeFileLocation := decodedUploadLocation
	var out arozfs.File
	if fsh.RequireBuffer {
		//The merge file location must be local buffer
		mergeFileLocation = getFsBufferFilepath(decodedUploadLocation, false)
		out, err = os.OpenFile(mergeFileLocation, os.O_CREATE|os.O_WRONLY, 0755)
	} else {
		//The merge file location can be local or remote that support OpenFile.
		out, err = fshAbs.OpenFile(mergeFileLocation, os.O_CREATE|os.O_WRONLY, 0755)
	}
	defer out.Close()

	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Failed to open file:"+err.Error(), err)
		c.WriteMessage(1, []byte(`{\"error\":\"Failed to open destination file\"}`))
		c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
		time.Sleep(1 * time.Second)
		c.Close()
		return
	}

	for _, filesrc := range chunkName {
		var srcChunkReader arozfs.File
		if isHugeFile {
			srcChunkReader, err = fshAbs.Open(filesrc)
		} else {
			srcChunkReader, err = os.Open(filesrc)
		}

		if err != nil {
			systemWideLogger.PrintAndLog("File System", "Failed to open Source Chunk"+filesrc+" with error "+err.Error(), err)
			c.WriteMessage(1, []byte(`{\"error\":\"Failed to open Source Chunk\"}`))
			return
		}
		io.Copy(out, srcChunkReader)
		srcChunkReader.Close()

		//Delete file immediately to save space
		if isHugeFile {
			fshAbs.Remove(filesrc)
		} else {
			os.Remove(filesrc)
		}

	}

	out.Close()

	//Check if the size fit in user quota
	var fi fs.FileInfo
	if fsh.RequireBuffer {
		fi, err = os.Stat(mergeFileLocation)
	} else {
		fi, err = fshAbs.Stat(mergeFileLocation)
	}

	if err != nil {
		// Could not obtain stat, handle error
		systemWideLogger.PrintAndLog("File System", "Failed to validate uploaded file: "+mergeFileLocation+". Error Message: "+err.Error(), err)
		c.WriteMessage(1, []byte(`{\"error\":\"Failed to validate uploaded file\"}`))
		return
	}
	if !userinfo.StorageQuota.HaveSpace(fi.Size()) {
		c.WriteMessage(1, []byte(`{\"error\":\"User Storage Quota Exceeded\"}`))
		if fsh.RequireBuffer {
			os.RemoveAll(mergeFileLocation)
		} else {
			fshAbs.RemoveAll(mergeFileLocation)
		}
		return
	}

	//Upload it to remote side if it fits the user quota && is buffer file
	if fsh.RequireBuffer {
		//This is local buffer file. Upload to dest fsh
		f, err := os.Open(mergeFileLocation)
		if err != nil {
			systemWideLogger.PrintAndLog("File System", "Failed to open buffered file at "+mergeFileLocation+" with error "+err.Error(), err)
			c.WriteMessage(1, []byte(`{\"error\":\"Failed to open buffered object\"}`))
			f.Close()
			return
		}

		err = fsh.FileSystemAbstraction.WriteStream(decodedUploadLocation, f, 0775)
		if err != nil {
			systemWideLogger.PrintAndLog("File System", "Failed to write to file system: "+fsh.UUID+" with error "+err.Error(), err)
			c.WriteMessage(1, []byte(`{\"error\":\"Failed to upload to remote file system\"}`))
			f.Close()
			return
		}

		//Remove the buffered file
		f.Close()
		os.Remove(mergeFileLocation)
	}

	//Log the upload filename
	systemWideLogger.PrintAndLog("File System", userinfo.Username+" uploaded a file: "+filepath.Base(decodedUploadLocation), nil)

	//Set owner of the new uploaded file
	userinfo.SetOwnerOfFile(fsh, unescapedPath)

	//Return complete signal
	c.WriteMessage(1, []byte("OK"))

	//Stop the timeout listner
	done <- true

	//Clear the tmp folder
	time.Sleep(300 * time.Millisecond)
	if isHugeFile {
		fshAbs.RemoveAll(uploadFolder)
	} else {
		os.RemoveAll(uploadFolder)
	}

	//Close WebSocket connection after finished
	c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
	time.Sleep(300 * time.Second)
	c.Close()

}

/*
	Handle FORM POST based upload

	This function is design for general SBCs or computers with more than 2GB of RAM
	(e.g. Raspberry Pi 4 / Linux Server)
*/
func system_fs_handleUpload(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Limit the max upload size to the user defined size
	if max_upload_size != 0 {
		r.Body = http.MaxBytesReader(w, r.Body, max_upload_size)
	}

	//Check if this is running under demo mode. If yes, reject upload
	if *demo_mode {
		common.SendErrorResponse(w, "You cannot upload in demo mode")
		return
	}

	err = r.ParseMultipartForm(int64(*upload_buf) << 20)
	if err != nil {
		//Filesize too big
		systemWideLogger.PrintAndLog("File System", "Upload file size too big", err)
		common.SendErrorResponse(w, "File too large")
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Error Retrieving File from upload by user: "+userinfo.Username, err)
		common.SendErrorResponse(w, "Unable to parse file from upload")
		return
	}

	//Get upload target directory
	uploadTarget, _ := common.Mv(r, "path", true)
	if uploadTarget == "" {
		common.SendErrorResponse(w, "Upload target cannot be empty.")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(uploadTarget)
	if err != nil {
		common.SendErrorResponse(w, "Invalid upload target")
		return
	}

	targetFs := fsh.FileSystemAbstraction

	//Translate the upload target directory
	realUploadPath, err := targetFs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, "Upload target is invalid or permission denied.")
		return
	}

	storeFilename := handler.Filename //Filename of the uploaded file

	//Get request time
	uploadStartTime := time.Now().UnixNano() / int64(time.Millisecond)

	//Update for Firefox 94.0.2 (x64) -> Now firefox put its relative path inside Content-Disposition -> filename
	//Skip this handler logic if Firefox version is in between 84.0.2 to 94.0.2
	bypassMetaCheck := compatibility.FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(r.UserAgent())
	if !bypassMetaCheck && strings.Contains(handler.Header["Content-Disposition"][0], "filename=") && strings.Contains(handler.Header["Content-Disposition"][0], "/") {
		//This is a firefox MIME Header for file inside folder. Look for the actual filename
		headerFields := strings.Split(handler.Header["Content-Disposition"][0], "; ")
		possibleRelativePathname := ""
		for _, hf := range headerFields {
			if strings.Contains(hf, "filename=") && len(hf) > 11 {
				//Found. Overwrite original filename with the latest one
				possibleRelativePathname = hf[10 : len(hf)-1]
				storeFilename = possibleRelativePathname
				break
			}
		}
	}

	destFilepath := arozfs.ToSlash(filepath.Join(realUploadPath, storeFilename))
	//fmt.Println(destFilepath, realUploadPath, storeFilename)
	if !targetFs.FileExists(filepath.Dir(destFilepath)) {
		targetFs.MkdirAll(filepath.Dir(destFilepath), 0775)
	}

	//Check if the upload target is read only.
	accmode := userinfo.GetPathAccessPermission(uploadTarget)
	if accmode == arozfs.FsReadOnly {
		common.SendErrorResponse(w, "The upload target is Read Only.")
		return
	} else if accmode == arozfs.FsDenied {
		common.SendErrorResponse(w, "Access Denied")
		return
	}

	//Check for storage quota
	uploadFileSize := handler.Size
	if !userinfo.StorageQuota.HaveSpace(uploadFileSize) {
		common.SendErrorResponse(w, "User Storage Quota Exceeded")
		return
	}

	//Do not allow % sign in filename. Replace all with underscore
	destFilepath = strings.ReplaceAll(destFilepath, "%", "_")

	//Move the file to destination file location
	if *enable_asyncFileUpload {
		//Use Async upload method
		systemWideLogger.PrintAndLog("File System", "AsyncFileUpload flag has been deprecated. Falling back to blocking upload.", errors.New("call to deprecated flag: asyncFileUpload"))
	}

	err = targetFs.WriteStream(destFilepath, file, 0775)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Write stream to destination file system abstraction from upload failed", err)
		common.SendErrorResponse(w, "Write upload to destination disk failed")
		return

	}
	file.Close()

	//Clear up buffered files
	r.MultipartForm.RemoveAll()

	//Set the ownership of file
	userinfo.SetOwnerOfFile(fsh, uploadTarget)

	//Finish up the upload
	/*
		fmt.Printf("Uploaded File: %+v\n", handler.Filename)
		fmt.Printf("File Size: %+v\n", handler.Size)
		fmt.Printf("MIME Header: %+v\n", handler.Header)
		fmt.Println("Upload target: " + realUploadPath)
	*/

	//Fnish upload. Fix the tmp filename
	systemWideLogger.PrintAndLog("File System", userinfo.Username+" uploaded a file: "+handler.Filename, nil)

	//Do upload finishing stuff

	//Add a delay to the complete message to make sure browser catch the return value
	currentTimeMilli := time.Now().UnixNano() / int64(time.Millisecond)
	if currentTimeMilli-uploadStartTime < 100 {
		//Sleep until at least 300 ms
		time.Sleep(time.Duration(100 - (currentTimeMilli - uploadStartTime)))
	}
	//Completed
	common.SendOK(w)
}

//Validate if the copy and target process will involve file overwriting problem.
func system_fs_validateFileOpr(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	vsrcFiles, _ := common.Mv(r, "src", true)
	vdestFile, _ := common.Mv(r, "dest", true)
	var duplicateFiles []string = []string{}

	//Loop through all files are see if there are duplication during copy and paste
	sourceFiles := []string{}
	decodedSourceFiles, _ := url.QueryUnescape(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		common.SendErrorResponse(w, "Source file JSON parse error.")
		return
	}

	destFsh, destSubpath, err := GetFSHandlerSubpathFromVpath(vdestFile)
	if err != nil {
		common.SendErrorResponse(w, "Operation Valid Failed: "+err.Error())
		return
	}

	rdestFile, _ := destFsh.FileSystemAbstraction.VirtualPathToRealPath(destSubpath, userinfo.Username)
	for _, file := range sourceFiles {
		srcFsh, srcSubpath, _ := GetFSHandlerSubpathFromVpath(string(file))
		rsrcFile, _ := srcFsh.FileSystemAbstraction.VirtualPathToRealPath(srcSubpath, userinfo.Username)
		if destFsh.FileSystemAbstraction.FileExists(filepath.Join(rdestFile, filepath.Base(rsrcFile))) {
			//File exists already.
			vpath, _ := srcFsh.FileSystemAbstraction.RealPathToVirtualPath(rsrcFile, userinfo.Username)
			duplicateFiles = append(duplicateFiles, vpath)
		}

	}

	jsonString, _ := json.Marshal(duplicateFiles)
	common.SendJSONResponse(w, string(jsonString))
}

//Scan all directory and get trash file and send back results with WebSocket
func system_fs_WebSocketScanTrashBin(w http.ResponseWriter, r *http.Request) {
	//Get and check user permission
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Upgrade to websocket
	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - " + err.Error()))
		log.Print("Websocket Upgrade Error:", err.Error())
		return
	}

	//Start Scanning
	scanningRoots := []*filesystem.FileSystemHandler{}
	//Get all roots to scan
	for _, storage := range userinfo.GetAllFileSystemHandler() {
		if storage.Hierarchy == "backup" {
			//Skip this fsh
			continue
		}
		scanningRoots = append(scanningRoots, storage)
	}

	for _, fsh := range scanningRoots {
		thisFshAbs := fsh.FileSystemAbstraction
		rootPath, err := thisFshAbs.VirtualPathToRealPath("", userinfo.Username)
		if err != nil {
			continue
		}
		err = thisFshAbs.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
			oneLevelUpper := filepath.Base(filepath.Dir(path))
			if oneLevelUpper == ".trash" {
				//This is a trashbin dir.
				file := path

				//Parse the trashFile struct
				timestamp := filepath.Ext(file)[1:]
				originalName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(filepath.Base(file)))
				originalExt := filepath.Ext(filepath.Base(originalName))
				virtualFilepath, _ := thisFshAbs.RealPathToVirtualPath(file, userinfo.Username)
				virtualOrgPath, _ := thisFshAbs.RealPathToVirtualPath(filepath.Dir(filepath.Dir(filepath.Dir(file))), userinfo.Username)
				rawsize := thisFshAbs.GetFileSize(file)
				timestampInt64, _ := common.StringToInt64(timestamp)
				removeTimeDate := time.Unix(timestampInt64, 0)
				if thisFshAbs.IsDir(file) {
					originalExt = ""
				}

				thisTrashFileObject := trashedFile{
					Filename:         filepath.Base(file),
					Filepath:         virtualFilepath,
					FileExt:          originalExt,
					IsDir:            thisFshAbs.IsDir(file),
					Filesize:         int64(rawsize),
					RemoveTimestamp:  timestampInt64,
					RemoveDate:       removeTimeDate.Format("2006-01-02 15:04:05"),
					OriginalPath:     virtualOrgPath,
					OriginalFilename: originalName,
				}

				//Send out the result as JSON string
				js, _ := json.Marshal(thisTrashFileObject)
				err := c.WriteMessage(1, js)
				if err != nil {
					//Connection already closed
					return err
				}
			}

			return nil
		})

		if err != nil {
			//Scan or client connection error (Connection closed?)
			return
		}
	}

	//Close connection after finished
	c.Close()

}

//Scan all the directory and get trash files within the system
func system_fs_scanTrashBin(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	username := userinfo.Username

	results := []trashedFile{}
	files, fshs, err := system_fs_listTrash(username)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	//Get information of each files and process it into results
	for c, file := range files {
		fsAbs := fshs[c].FileSystemAbstraction
		timestamp := filepath.Ext(file)[1:]
		originalName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(filepath.Base(file)))
		originalExt := filepath.Ext(filepath.Base(originalName))
		virtualFilepath, _ := fsAbs.RealPathToVirtualPath(file, userinfo.Username)
		virtualOrgPath, _ := fsAbs.RealPathToVirtualPath(filepath.Dir(filepath.Dir(filepath.Dir(file))), userinfo.Username)
		rawsize := fsAbs.GetFileSize(file)
		timestampInt64, _ := common.StringToInt64(timestamp)
		removeTimeDate := time.Unix(timestampInt64, 0)
		if fsAbs.IsDir(file) {
			originalExt = ""
		}
		results = append(results, trashedFile{
			Filename:         filepath.Base(file),
			Filepath:         virtualFilepath,
			FileExt:          originalExt,
			IsDir:            fsAbs.IsDir(file),
			Filesize:         int64(rawsize),
			RemoveTimestamp:  timestampInt64,
			RemoveDate:       removeTimeDate.Format("2006-01-02 15:04:05"),
			OriginalPath:     virtualOrgPath,
			OriginalFilename: originalName,
		})
	}

	//Sort the results by date, latest on top
	sort.Slice(results[:], func(i, j int) bool {
		return results[i].RemoveTimestamp > results[j].RemoveTimestamp
	})

	//Format and return the json results
	jsonString, _ := json.Marshal(results)
	common.SendJSONResponse(w, string(jsonString))
}

//Restore a trashed file to its parent dir
func system_fs_restoreFile(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	targetTrashedFile, err := common.Mv(r, "src", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid src given")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(targetTrashedFile)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	fshAbs := fsh.FileSystemAbstraction

	//Translate it to realpath
	realpath, _ := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if !fshAbs.FileExists(realpath) {
		common.SendErrorResponse(w, "File not exists")
		return
	}

	//Check if this is really a trashed file
	if filepath.Base(filepath.Dir(realpath)) != ".trash" {
		common.SendErrorResponse(w, "File not in trashbin")
		return
	}

	//OK to proceed.
	originalFilename := strings.TrimSuffix(filepath.Base(realpath), filepath.Ext(filepath.Base(realpath)))
	restoreFolderRoot := filepath.Dir(filepath.Dir(filepath.Dir(realpath)))
	targetPath := filepath.ToSlash(filepath.Join(restoreFolderRoot, originalFilename))
	//systemWideLogger.PrintAndLog("File System", (targetPath)
	fshAbs.Rename(realpath, targetPath)

	//Check if the parent dir has no more fileds. If yes, remove it
	filescounter, _ := fshAbs.Glob(filepath.Dir(realpath) + "/*")
	if len(filescounter) == 0 {
		fshAbs.Remove(filepath.Dir(realpath))
	}

	common.SendOK(w)
}

//Clear all trashed file in the system
func system_fs_clearTrashBin(w http.ResponseWriter, r *http.Request) {
	u, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	fileList, fshs, err := system_fs_listTrash(u.Username)

	if err != nil {
		common.SendErrorResponse(w, "Unable to clear trash: "+err.Error())
		return
	}

	//Get list success. Remove each of them.
	for c, file := range fileList {
		fileVpath, _ := fshs[c].FileSystemAbstraction.RealPathToVirtualPath(file, u.Username)
		isOwner := u.IsOwnerOfFile(fshs[c], fileVpath)
		if isOwner {
			//This user own this system. Remove this file from his quota
			u.RemoveOwnershipFromFile(fshs[c], fileVpath)
		}
		fshAbs := fshs[c].FileSystemAbstraction
		fshAbs.RemoveAll(file)
		//Check if its parent directory have no files. If yes, remove the dir itself as well.
		filesInThisTrashBin, _ := fshAbs.Glob(filepath.Dir(file) + "/*")
		if len(filesInThisTrashBin) == 0 {
			fshAbs.Remove(filepath.Dir(file))
		}
	}

	common.SendOK(w)
}

//Get all trash in a string list
func system_fs_listTrash(username string) ([]string, []*filesystem.FileSystemHandler, error) {
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	scanningRoots := []*filesystem.FileSystemHandler{}
	//Get all roots to scan
	for _, storage := range userinfo.GetAllFileSystemHandler() {
		if storage.Hierarchy == "backup" {
			//Skip this fsh
			continue
		}

		scanningRoots = append(scanningRoots, storage)
	}

	files := []string{}
	fshs := []*filesystem.FileSystemHandler{}
	for _, thisFsh := range scanningRoots {
		thisFshAbs := thisFsh.FileSystemAbstraction
		rootPath, _ := thisFshAbs.VirtualPathToRealPath("", userinfo.Username)
		err := thisFshAbs.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
			oneLevelUpper := filepath.Base(filepath.Dir(path))
			if oneLevelUpper == ".trash" {
				//This is a trashbin dir.
				files = append(files, path)
				fshs = append(fshs, thisFsh)
			}
			return nil
		})
		if err != nil {
			continue
		}
	}

	return files, fshs, nil
}

/*
	Handle new file or folder functions

	Required information
	@type {folder / file}
	@ext {any that is listed in the template folder}
	if no paramter is passed in, default listing all the supported template file
*/

func system_fs_handleNewObjects(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Validate the token
	tokenValid := CSRFTokenManager.HandleTokenValidation(w, r)
	if !tokenValid {
		http.Error(w, "Invalid CSRF token", http.StatusUnauthorized)
		return
	}

	fileType, _ := common.Mv(r, "type", true)     //File creation type, {file, folder}
	vsrc, _ := common.Mv(r, "src", true)          //Virtual file source folder, do not include filename
	filename, _ := common.Mv(r, "filename", true) //Filename for the new file

	if fileType == "" && filename == "" {
		//List all the supported new filetype
		if !filesystem.FileExists("system/newitem/") {
			os.MkdirAll("system/newitem/", 0755)
		}

		type newItemObject struct {
			Desc string
			Ext  string
		}

		var newItemList []newItemObject
		newItemTemplate, _ := filepath.Glob("system/newitem/*")
		for _, file := range newItemTemplate {
			thisItem := new(newItemObject)
			thisItem.Desc = strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
			thisItem.Ext = filepath.Ext(file)[1:]
			newItemList = append(newItemList, *thisItem)
		}

		jsonString, err := json.Marshal(newItemList)
		if err != nil {
			systemWideLogger.PrintAndLog("File System", "Unable to parse JSON string for new item list", err)
			common.SendErrorResponse(w, "Unable to parse new item list. See server log for more information.")
			return
		}
		common.SendJSONResponse(w, string(jsonString))
		return
	} else if fileType != "" && filename != "" {
		if vsrc == "" {
			common.SendErrorResponse(w, "Missing paramter: 'src'")
			return
		}

		fsh, subpath, err := GetFSHandlerSubpathFromVpath(vsrc)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
		fshAbs := fsh.FileSystemAbstraction

		//Translate the path to realpath
		rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
		if err != nil {
			common.SendErrorResponse(w, "Invalid path given")
			return
		}

		//Check if directory is readonly
		accmode := userinfo.GetPathAccessPermission(vsrc)
		if accmode == arozfs.FsReadOnly {
			common.SendErrorResponse(w, "This directory is Read Only")
			return
		} else if accmode == arozfs.FsDenied {
			common.SendErrorResponse(w, "Access Denied")
			return
		}

		//Check if the file already exists. If yes, fix its filename.
		newfilePath := filepath.ToSlash(filepath.Join(rpath, filename))

		if fileType == "file" {
			for fshAbs.FileExists(newfilePath) {
				common.SendErrorResponse(w, "Given filename already exists")
				return
			}
			ext := filepath.Ext(filename)
			defaultFileCotent := []byte("")
			if ext != "" {
				templateFile, _ := fshAbs.Glob("system/newitem/*" + ext)
				if len(templateFile) > 0 {
					//Copy file from templateFile[0] to current dir with the given name
					input, _ := os.ReadFile(templateFile[0])
					defaultFileCotent = input
				}
			}

			err = fshAbs.WriteFile(newfilePath, defaultFileCotent, 0775)
			if err != nil {
				systemWideLogger.PrintAndLog("File System", "Unable to create new file: "+err.Error(), err)
				common.SendErrorResponse(w, err.Error())
				return
			}

		} else if fileType == "folder" {
			if fshAbs.FileExists(newfilePath) {
				common.SendErrorResponse(w, "Given folder already exists")
				return
			}
			//Create the folder at target location
			err := fshAbs.Mkdir(newfilePath, 0755)
			if err != nil {
				common.SendErrorResponse(w, err.Error())
				return
			}
		}

		common.SendOK(w)
	} else {
		common.SendErrorResponse(w, "Missing paramter(s).")
		return
	}
}

/*

	Handle file operations via WebSocket

	This handler only handle zip, unzip, copy and move. Not other operations.
	For other operations, please use the legacy handleOpr endpoint
*/

func system_fs_handleWebSocketOpr(w http.ResponseWriter, r *http.Request) {
	//Get and check user permission
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	operation, _ := common.Mv(r, "opr", false) //Accept copy and move
	vsrcFiles, _ := common.Mv(r, "src", false)
	vdestFile, _ := common.Mv(r, "dest", false)
	existsOpr, _ := common.Mv(r, "existsresp", false)

	if existsOpr == "" {
		existsOpr = "keep"
	}

	//Decode the source file list
	var sourceFiles []string
	tmp := []string{}
	decodedSourceFiles, _ := url.QueryUnescape(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Websocket file operation source file JSON parse error", err)
		common.SendErrorResponse(w, "Source file JSON parse error.")
		return
	}

	//Bugged char filtering
	for _, src := range sourceFiles {
		tmp = append(tmp, strings.ReplaceAll(src, "{{plug_sign}}", "+"))
	}
	sourceFiles = tmp
	vdestFile = strings.ReplaceAll(vdestFile, "{{plug_sign}}", "+")

	//Decode the target position
	escapedVdest, _ := url.QueryUnescape(vdestFile)
	vdestFile = escapedVdest

	destFsh, subpath, err := GetFSHandlerSubpathFromVpath(vdestFile)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	destFshAbs := destFsh.FileSystemAbstraction
	rdestFile, _ := destFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)

	//Permission checking
	if !userinfo.CanWrite(vdestFile) {
		systemWideLogger.PrintAndLog("File System", "Access denied for "+userinfo.Username+" try to access "+vdestFile, nil)
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - Access Denied"))
		return
	}

	//Check if opr is suported
	if operation == "move" || operation == "copy" || operation == "zip" || operation == "unzip" {

	} else {
		systemWideLogger.PrintAndLog("File System", "This file operation is not supported on WebSocket file operations endpoint. Please use the legacy endpoint instead. Received: "+operation, errors.New("operaiton not supported on websocket endpoint"))
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Not supported operation"))
		return
	}

	//Upgrade to websocket
	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - " + err.Error()))
		log.Print("Websocket Upgrade Error:", err.Error())
		return
	}

	type ProgressUpdate struct {
		LatestFile string
		Progress   int
		Error      string
	}

	if operation == "zip" {
		//Zip files
		outputFilename := filepath.Join(rdestFile, strings.ReplaceAll(filepath.Base(filepath.Dir(sourceFiles[0])+".zip"), ":", ""))
		if len(sourceFiles) == 1 {
			//Use the basename of the source file as zip file name
			outputFilename = filepath.Join(rdestFile, filepath.Base(sourceFiles[0])) + ".zip"
		}

		//Translate source Files into real paths
		realSourceFiles := []string{}
		sourceFileFsh := []*filesystem.FileSystemHandler{}
		for _, vsrcs := range sourceFiles {
			thisSrcFsh, subpath, err := GetFSHandlerSubpathFromVpath(vsrcs)
			if err != nil {
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(vsrcs),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
				return
			}
			rsrc, err := thisSrcFsh.FileSystemAbstraction.VirtualPathToRealPath(subpath, userinfo.Username)
			if err != nil {
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(rsrc),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
				return
			}

			realSourceFiles = append(realSourceFiles, rsrc)
			sourceFileFsh = append(sourceFileFsh, thisSrcFsh)
		}

		zipDestPath := outputFilename
		zipDestFsh := destFsh
		if destFsh.RequireBuffer {
			zipDestPath = getFsBufferFilepath(outputFilename, false)
			zipDestFsh = nil
		}

		//Create the zip file
		err = filesystem.ArozZipFileWithProgress(sourceFileFsh, realSourceFiles, zipDestFsh, zipDestPath, false, func(currentFilename string, _ int, _ int, progress float64) {
			currentStatus := ProgressUpdate{
				LatestFile: currentFilename,
				Progress:   int(math.Ceil(progress)),
				Error:      "",
			}

			js, _ := json.Marshal(currentStatus)
			c.WriteMessage(1, js)
		})

		if err != nil {
			systemWideLogger.PrintAndLog("File System", "Zipping websocket request failed: "+err.Error(), err)
		}

		if destFsh.RequireBuffer {
			//Move the buffer result to remote
			f, _ := os.Open(zipDestPath)
			err = destFshAbs.WriteStream(outputFilename, f, 0775)
			if err != nil {
				systemWideLogger.PrintAndLog("File System", "Zip write to remote file system with driver"+destFsh.Filesystem+" failed", err)
			}
			f.Close()

			//Clear local buffers
			os.Remove(zipDestPath)
			cleanFsBufferFileFromList(realSourceFiles)
		}
	} else if operation == "unzip" {
		//Check if the target destination exists and writable
		if !userinfo.CanWrite(vdestFile) {
			stopStatus := ProgressUpdate{
				LatestFile: filepath.Base(vdestFile),
				Progress:   -1,
				Error:      "Access Denied: No Write Permission",
			}
			js, _ := json.Marshal(stopStatus)
			c.WriteMessage(1, js)
			c.Close()
		}

		//Create the destination folder
		destFshAbs.MkdirAll(rdestFile, 0755)

		//Convert the src files into realpaths
		realSourceFiles := []string{}
		for _, vsrcs := range sourceFiles {
			thisSrcFsh, subpath, err := GetFSHandlerSubpathFromVpath(vsrcs)
			if err != nil {
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(vsrcs),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
			}
			thisSrcFshAbs := thisSrcFsh.FileSystemAbstraction
			rsrc, err := thisSrcFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
			if err != nil {
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(rsrc),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
			}
			if thisSrcFsh.RequireBuffer {
				localBufferFilepath, err := bufferRemoteFileToLocal(thisSrcFsh, rsrc, false)
				if err != nil {
					stopStatus := ProgressUpdate{
						LatestFile: filepath.Base(rsrc),
						Progress:   -1,
						Error:      "Failed to buffer file to local disk",
					}
					js, _ := json.Marshal(stopStatus)
					c.WriteMessage(1, js)
					c.Close()
				}
				realSourceFiles = append(realSourceFiles, localBufferFilepath)
			} else {
				realSourceFiles = append(realSourceFiles, rsrc)
			}

		}

		unzipDest := rdestFile
		if destFsh.RequireBuffer {
			unzipDest = getFsBufferFilepath(rdestFile, true)
		}

		//Unzip the files
		filesystem.ArozUnzipFileWithProgress(realSourceFiles, unzipDest, func(currentFile string, filecount int, totalfile int, progress float64) {
			//Generate the status update struct
			currentStatus := ProgressUpdate{
				LatestFile: filepath.Base(currentFile),
				Progress:   int(math.Ceil(progress)),
				Error:      "",
			}

			js, _ := json.Marshal(currentStatus)
			c.WriteMessage(1, js)
		})

		if destFsh.RequireBuffer {
			//Push the unzip results back to remote fs
			filepath.Walk(unzipDest, func(path string, info os.FileInfo, err error) error {
				path = filepath.ToSlash(path)
				relpath := strings.TrimPrefix(path, filepath.ToSlash(unzipDest))
				if info.IsDir() {
					destFshAbs.MkdirAll(filepath.Join(rdestFile, relpath), 0775)
				} else {
					f, _ := os.Open(path)
					destFshAbs.WriteStream(filepath.Join(rdestFile, relpath), f, 0775)
					f.Close()
				}
				return nil
			})

			cleanFsBufferFileFromList([]string{unzipDest})
		}

		cleanFsBufferFileFromList(realSourceFiles)

	} else {
		//Other operations that allow multiple source files to handle one by one
		for i := 0; i < len(sourceFiles); i++ {
			vsrcFile := sourceFiles[i]
			thisSrcFsh, subpath, err := GetFSHandlerSubpathFromVpath(vsrcFile)
			if err != nil {
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(vsrcFile),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
				return
			}
			thisSrcFshAbs := thisSrcFsh.FileSystemAbstraction
			rsrcFile, _ := thisSrcFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)

			if !thisSrcFshAbs.FileExists(rsrcFile) {
				//This source file not exists. Report Error and Stop
				stopStatus := ProgressUpdate{
					LatestFile: filepath.Base(rsrcFile),
					Progress:   -1,
					Error:      "File not exists",
				}
				js, _ := json.Marshal(stopStatus)
				c.WriteMessage(1, js)
				c.Close()
				return
			}

			if operation == "move" {
				err := filesystem.FileMove(thisSrcFsh, rsrcFile, destFsh, rdestFile, existsOpr, true, func(progress int, currentFile string) {
					//Multply child progress to parent progress
					blockRatio := float64(100) / float64(len(sourceFiles))
					overallRatio := blockRatio*float64(i) + blockRatio*(float64(progress)/float64(100))

					//Construct return struct
					currentStatus := ProgressUpdate{
						LatestFile: filepath.Base(currentFile),
						Progress:   int(overallRatio),
						Error:      "",
					}

					js, _ := json.Marshal(currentStatus)
					c.WriteMessage(1, js)
				})

				//Handle move starting error
				if err != nil {
					stopStatus := ProgressUpdate{
						LatestFile: filepath.Base(rsrcFile),
						Progress:   -1,
						Error:      err.Error(),
					}
					js, _ := json.Marshal(stopStatus)
					c.WriteMessage(1, js)
					c.Close()
					return
				}

				//Remove the cache for the original file
				metadata.RemoveCache(thisSrcFsh, rsrcFile)

			} else if operation == "copy" {
				err := filesystem.FileCopy(thisSrcFsh, rsrcFile, destFsh, rdestFile, existsOpr, func(progress int, currentFile string) {
					//Multply child progress to parent progress
					blockRatio := float64(100) / float64(len(sourceFiles))
					overallRatio := blockRatio*float64(i) + blockRatio*(float64(progress)/float64(100))

					//Construct return struct
					currentStatus := ProgressUpdate{
						LatestFile: filepath.Base(currentFile),
						Progress:   int(overallRatio),
						Error:      "",
					}

					js, _ := json.Marshal(currentStatus)
					c.WriteMessage(1, js)
				})

				//Handle Copy starting error
				if err != nil {
					stopStatus := ProgressUpdate{
						LatestFile: filepath.Base(rsrcFile),
						Progress:   -1,
						Error:      err.Error(),
					}
					js, _ := json.Marshal(stopStatus)
					c.WriteMessage(1, js)
					c.Close()
					return
				}
			}
		}
	}

	//Close WebSocket connection after finished
	time.Sleep(1 * time.Second)
	c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
	c.Close()

}

/*
	Handle file operations

	Support {move, copy, delete, recycle, rename}
*/
//Handle file operations.
func system_fs_handleOpr(w http.ResponseWriter, r *http.Request) {
	//Check if user logged in
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	//Validate the token
	tokenValid := CSRFTokenManager.HandleTokenValidation(w, r)
	if !tokenValid {
		http.Error(w, "Invalid CSRF token", http.StatusUnauthorized)
		return
	}

	operation, _ := common.Mv(r, "opr", true)
	vsrcFiles, _ := common.Mv(r, "src", true)
	vdestFile, _ := common.Mv(r, "dest", true)
	vnfilenames, _ := common.Mv(r, "new", true) //Only use when rename or create new file / folder

	//Check if operation valid.
	if operation == "" {
		//Undefined operations.
		common.SendErrorResponse(w, "Undefined operations paramter: Missing 'opr' in request header.")
		return
	}

	//As the user can pass in multiple source files at the same time, parse sourceFiles from json string
	var sourceFiles []string
	//This line is required in order to allow passing of special charaters
	decodedSourceFiles := system_fs_specialURIDecode(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		common.SendErrorResponse(w, "Source file JSON parse error.")
		return
	}

	//Check if new filenames are also valid. If yes, translate it into string array
	var newFilenames []string
	if vnfilenames != "" {
		vnfilenames, _ := url.QueryUnescape(vnfilenames)
		err = json.Unmarshal([]byte(vnfilenames), &newFilenames)
		if err != nil {
			common.SendErrorResponse(w, "Unable to parse JSON for new filenames")
			return
		}
	}

	if operation == "zip" {
		//Zip operation. Parse the real filepath list
		rsrcFiles := []string{}
		srcFshs := []*filesystem.FileSystemHandler{}
		destFsh, subpath, err := GetFSHandlerSubpathFromVpath(vdestFile)
		if err != nil {
			common.SendErrorResponse(w, "Unable to resolve zip destination path")
			return
		}
		destFshAbs := destFsh.FileSystemAbstraction
		rdestFile, _ := destFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
		for _, vsrcFile := range sourceFiles {
			vsrcFsh, vsrcSubpath, err := GetFSHandlerSubpathFromVpath(vsrcFile)
			if err != nil {
				continue
			}
			rsrcFile, _ := vsrcFsh.FileSystemAbstraction.VirtualPathToRealPath(vsrcSubpath, userinfo.Username)
			if vsrcFsh.FileSystemAbstraction.FileExists(rsrcFile) {
				//Push directly its local path to list
				rsrcFiles = append(rsrcFiles, rsrcFile)
				srcFshs = append(srcFshs, vsrcFsh)
			}
		}

		zipFilename := rdestFile
		if destFshAbs.IsDir(rdestFile) {
			//Append the filename to it
			if len(rsrcFiles) == 1 {
				zipFilename = filepath.Join(rdestFile, strings.TrimSuffix(filepath.Base(rsrcFiles[0]), filepath.Ext(filepath.Base(rsrcFiles[0])))+".zip")
			} else if len(rsrcFiles) > 1 {
				zipFilename = filepath.Join(rdestFile, filepath.Base(filepath.Dir(rsrcFiles[0]))+".zip")
			}
		}

		//Create a buffer if destination fsh request buffer
		zipFileTargetLocation := zipFilename
		zipDestFsh := destFsh
		if destFsh.RequireBuffer {
			zipFileTargetLocation = getFsBufferFilepath(zipFilename, false)
			zipDestFsh = nil
		}

		//Create a zip file at target location
		err = filesystem.ArozZipFile(srcFshs, rsrcFiles, zipDestFsh, zipFileTargetLocation, false)
		if err != nil {
			os.Remove(zipFileTargetLocation)
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Write it to final destination from buffer
		if destFsh.RequireBuffer {
			//Upload the finalized zip file
			f, _ := destFshAbs.Open(zipFileTargetLocation)
			destFshAbs.WriteStream(zipFilename, f, 0775)
			f.Close()

			//Remove all buff files
			os.Remove(zipFileTargetLocation)
			cleanFsBufferFileFromList(rsrcFiles)
		}

	} else {
		//For operations that is handled file by file
		for i, vsrcFile := range sourceFiles {
			//Convert the virtual path to realpath on disk
			srcFsh, subpath, err := GetFSHandlerSubpathFromVpath(vsrcFile)
			if err != nil {
				continue
			}
			srcFshAbs := srcFsh.FileSystemAbstraction
			rsrcFile, _ := srcFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)

			destFsh, destSubpath, err := GetFSHandlerSubpathFromVpath(vdestFile)
			var destFshAbs filesystem.FileSystemAbstraction = nil
			var rdestFile string = ""
			if err == nil {
				destFshAbs = destFsh.FileSystemAbstraction
				rdestFile, _ = destFshAbs.VirtualPathToRealPath(destSubpath, userinfo.Username)
			}

			//Check if the source file exists
			if operation == "rename" {
				//Check if the usage is correct.
				if vdestFile != "" {
					common.SendErrorResponse(w, "Rename only accept 'src' and 'new'. Please use move if you want to move a file.")
					return
				}
				//Check if new name paramter is passed in.
				if len(newFilenames) == 0 {
					common.SendErrorResponse(w, "Missing paramter (JSON string): 'new'")
					return
				}
				//Check if the source filenames and new filenanmes match
				if len(newFilenames) != len(sourceFiles) {
					common.SendErrorResponse(w, "New filenames do not match with source filename's length.")
					return
				}

				//Check if the target dir is not readonly
				accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
				if accmode == arozfs.FsReadOnly {
					common.SendErrorResponse(w, "This directory is Read Only")
					return
				} else if accmode == arozfs.FsDenied {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				thisFilename := filepath.Base(newFilenames[i])
				//Check if the name already exists. If yes, return false
				if srcFshAbs.FileExists(filepath.Join(filepath.Dir(rsrcFile), thisFilename)) {
					common.SendErrorResponse(w, "File already exists")
					return
				}

				//Everything is ok. Rename the file.
				targetNewName := filepath.Join(filepath.Dir(rsrcFile), thisFilename)
				err = srcFshAbs.Rename(rsrcFile, targetNewName)
				if err != nil {
					systemWideLogger.PrintAndLog("File System", "File rename failed", err)
					common.SendErrorResponse(w, err.Error())
					return
				}

				//Remove the cache for the original file
				metadata.RemoveCache(srcFsh, rsrcFile)

			} else if operation == "move" {
				//File move operation. Check if the source file / dir and target directory exists
				/*
					Example usage from file explorer
					$.ajax({
						type: 'POST',
						url: `/system/file_system/fileOpr`,
						data: {opr: "move" ,src: JSON.stringify(fileList), dest: targetDir},
						success: function(data){
							if (data.error !== undefined){
								msgbox("remove",data.error);
							}else{
								//OK, do something
							}
						}
					});
				*/

				if !srcFshAbs.FileExists(rsrcFile) {
					common.SendErrorResponse(w, "Source file not exists")
					return
				}

				//Check if the source file is read only.
				accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
				if accmode == arozfs.FsReadOnly {
					common.SendErrorResponse(w, "This source file is Read Only")
					return
				} else if accmode == arozfs.FsDenied {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				if rdestFile == "" {
					common.SendErrorResponse(w, "Undefined dest location")
					return
				}

				//Get exists overwrite mode
				existsOpr, _ := common.Mv(r, "existsresp", true)

				//Check if use fast move instead
				//Check if the source and destination folder are under the same root. If yes, use os.Rename for faster move operations

				//Check if the two files are under the same user root path

				//srcAbs, _ := filepath.Abs(rsrcFile)
				//destAbs, _ := filepath.Abs(rdestFile)
				//underSameRoot, _ := filesystem.UnderTheSameRoot(srcAbs, destAbs)

				//Updates 19-10-2020: Added ownership management to file move and copy
				userinfo.RemoveOwnershipFromFile(srcFsh, vsrcFile)

				err = filesystem.FileMove(srcFsh, rsrcFile, destFsh, rdestFile, existsOpr, true, nil)
				if err != nil {
					common.SendErrorResponse(w, err.Error())
					//Restore the ownership if remove failed
					userinfo.SetOwnerOfFile(srcFsh, vsrcFile)
					return
				}

				//Set user to own the new file
				newfileRpath := filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile)
				newfileVpath, _ := destFsh.FileSystemAbstraction.RealPathToVirtualPath(newfileRpath, userinfo.Username)
				userinfo.SetOwnerOfFile(destFsh, newfileVpath)

				//Remove cache for the original file
				metadata.RemoveCache(srcFsh, rsrcFile)
			} else if operation == "copy" {
				//Copy file. See move example and change 'opr' to 'copy'
				if !srcFshAbs.FileExists(rsrcFile) {
					common.SendErrorResponse(w, "Source file not exists")
					return
				}

				//Check if the desintation is read only.
				if !userinfo.CanWrite(vdestFile) {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				if !destFshAbs.FileExists(rdestFile) {
					if destFshAbs.FileExists(filepath.Dir(rdestFile)) {
						//User pass in the whole path for the folder. Report error usecase.
						common.SendErrorResponse(w, "Dest location should be an existing folder instead of the full path of the copied file")
						return
					}
					common.SendErrorResponse(w, "Dest folder not found")
					return
				}

				existsOpr, _ := common.Mv(r, "existsresp", true)

				//Check if the user have space for the extra file
				if !userinfo.StorageQuota.HaveSpace(filesystem.GetFileSize(rdestFile)) {
					common.SendErrorResponse(w, "Storage Quota Full")
					return
				}

				err = filesystem.FileCopy(srcFsh, rsrcFile, destFsh, rdestFile, existsOpr, nil)
				if err != nil {
					common.SendErrorResponse(w, err.Error())
					return
				}

				//Set user to own this file
				newfileRpath := filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile)
				newfileVpath, _ := destFsh.FileSystemAbstraction.RealPathToVirtualPath(newfileRpath, userinfo.Username)
				userinfo.SetOwnerOfFile(destFsh, newfileVpath)

			} else if operation == "delete" {
				//Delete the file permanently
				if !srcFshAbs.FileExists(rsrcFile) {
					//Check if it is a non escapted file instead
					common.SendErrorResponse(w, "Source file not exists")
					return

				}

				if !userinfo.CanWrite(vsrcFile) {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				//Check if the user own this file
				isOwner := userinfo.IsOwnerOfFile(srcFsh, vsrcFile)
				if isOwner {
					//This user own this system. Remove this file from his quota
					userinfo.RemoveOwnershipFromFile(srcFsh, vsrcFile)
				}

				//Check if this file has any cached files. If yes, remove it
				metadata.RemoveCache(srcFsh, rsrcFile)

				//Clear the cache folder if there is no files inside
				fc, err := srcFshAbs.Glob(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.metadata/.cache/*")
				if len(fc) == 0 && err == nil {
					srcFshAbs.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.metadata/.cache/")
				}

				err = srcFshAbs.RemoveAll(rsrcFile)
				if err != nil {
					systemWideLogger.PrintAndLog("File System", "Unable to remove file from "+srcFsh.UUID, err)
					common.SendErrorResponse(w, err.Error())
					return
				}

			} else if operation == "recycle" {
				//Put it into a subfolder named trash and allow it to to be removed later
				if !srcFshAbs.FileExists(rsrcFile) {
					//Check if it is a non escapted file instead
					common.SendErrorResponse(w, "Source file not exists")
					return

				}

				//Check if the upload target is read only.
				if !userinfo.CanWrite(vsrcFile) {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				//Check if this file has any cached files. If yes, remove it
				metadata.RemoveCache(srcFsh, rsrcFile)

				//Clear the cache folder if there is no files inside
				fc, err := srcFshAbs.Glob(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.metadata/.cache/*")
				if len(fc) == 0 && err == nil {
					srcFshAbs.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.metadata/.cache/")
				}

				//Create a trash directory for this folder
				trashDir := filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.metadata/.trash/"
				srcFshAbs.MkdirAll(trashDir, 0755)
				hidden.HideFile(filepath.Dir(trashDir))
				hidden.HideFile(trashDir)
				err = srcFshAbs.Rename(rsrcFile, trashDir+filepath.Base(rsrcFile)+"."+common.Int64ToString(time.Now().Unix()))
				if err != nil {
					if srcFsh.RequireBuffer {
						common.SendErrorResponse(w, "Incompatible File System Type: Try SHIFT + DELETE to delete file permanently")
					} else {
						systemWideLogger.PrintAndLog("File System", "Failed to move file to trash. See log for more info.", err)
						common.SendErrorResponse(w, "Failed to move file to trash")
					}
					return
				}
			} else if operation == "unzip" {
				//Unzip the file to destination

				//Check if the user can write to the target dest file
				if !userinfo.CanWrite(string(vdestFile)) {
					common.SendErrorResponse(w, "Access Denied")
					return
				}

				//Make the rdest directory if not exists
				if !destFshAbs.FileExists(rdestFile) {
					err = destFshAbs.MkdirAll(rdestFile, 0755)
					if err != nil {
						common.SendErrorResponse(w, err.Error())
						return
					}
				}

				unzipSource := rsrcFile
				unzipDest := rdestFile
				if srcFsh.RequireBuffer {
					localBufferedFile, _ := bufferRemoteFileToLocal(srcFsh, rsrcFile, false)
					unzipSource = localBufferedFile
				}

				if destFsh.RequireBuffer {
					localUnzipBuffer, _ := bufferRemoteFileToLocal(destFsh, rdestFile, true)
					unzipDest = localUnzipBuffer
				}

				//OK! Unzip to destination
				err := filesystem.Unzip(unzipSource, unzipDest)
				if err != nil {
					common.SendErrorResponse(w, err.Error())
					return
				}

				if srcFsh.RequireBuffer {
					//Remove the local buffered file
					os.Remove(unzipSource)
				}

				if destFsh.RequireBuffer {
					//Push the buffer to target fs
					filepath.Walk(unzipDest, func(path string, info os.FileInfo, err error) error {
						path = filepath.ToSlash(path)
						relpath := strings.TrimPrefix(path, filepath.ToSlash(unzipDest))
						if info.IsDir() {
							destFshAbs.MkdirAll(filepath.Join(rdestFile, relpath), 0775)
						} else {
							f, _ := os.Open(path)
							destFshAbs.WriteStream(filepath.Join(rdestFile, relpath), f, 0775)
							f.Close()
						}
						return nil
					})

					cleanFsBufferFileFromList([]string{unzipDest})
				}

			} else {
				common.SendErrorResponse(w, "Unknown file opeartion given")
				return
			}
		}

	}
	common.SendOK(w)
}

//Allow systems to store key value pairs in the database as preferences.
func system_fs_handleUserPreference(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	key, _ := common.Mv(r, "key", false)
	value, _ := common.Mv(r, "value", false)
	remove, _ := common.Mv(r, "remove", false)

	if key != "" && value == "" && remove == "" {
		//Get mode. Read the prefernece with given key
		result := ""
		err := sysdb.Read("fs", "pref/"+key+"/"+username, &result)
		if err != nil {
			common.SendJSONResponse(w, "{\"error\":\"Key not found.\"}")
			return
		}
		common.SendTextResponse(w, result)
	} else if key != "" && value == "" && remove == "true" {
		//Remove mode. Delete this key from sysdb
		err := sysdb.Delete("fs", "pref/"+key+"/"+username)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
		}

		common.SendOK(w)
	} else if key != "" && value != "" {
		//Set mode. Set the preference with given key
		if len(value) > 1024 {
			//Size too big. Reject storage
			common.SendErrorResponse(w, "Preference value too long. Preference value can only store maximum 1024 characters.")
			return
		}
		sysdb.Write("fs", "pref/"+key+"/"+username, value)
		common.SendOK(w)
	}
}

func system_fs_removeUserPreferences(username string) {
	entries, err := sysdb.ListTable("fs")
	if err != nil {
		return
	}

	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "pref/") && strings.Contains(string(keypairs[0]), "/"+username) {
			//Remove this preference
			sysdb.Delete("fs", string(keypairs[0]))
		}
	}
}

func system_fs_listDrives(w http.ResponseWriter, r *http.Request) {
	if authAgent.CheckAuth(r) == false {
		common.SendErrorResponse(w, "User not logged in")
		return
	}
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	type driveInfo struct {
		Drivepath       string
		DriveFreeSpace  uint64
		DriveTotalSpace uint64
		DriveAvailSpace uint64
	}
	var drives []driveInfo
	if runtime.GOOS == "windows" {
		//Under windows
		for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
			f, err := os.Open(string(drive) + ":\\")
			if err == nil {
				thisdrive := new(driveInfo)
				thisdrive.Drivepath = string(drive) + ":\\"
				free, total, avail := storage.GetDriveCapacity(string(drive) + ":\\")
				thisdrive.DriveFreeSpace = free
				thisdrive.DriveTotalSpace = total
				thisdrive.DriveAvailSpace = avail
				drives = append(drives, *thisdrive)
				f.Close()
			}
		}
	} else {
		//Under linux environment
		//Append all the virtual directories root as root instead
		storageDevices := []string{}
		for _, fshandler := range userinfo.GetAllFileSystemHandler() {
			storageDevices = append(storageDevices, fshandler.Path)
		}

		//List all storage information of each devices
		for _, dev := range storageDevices {
			thisdrive := new(driveInfo)
			thisdrive.Drivepath = filepath.Base(dev)
			free, total, avail := storage.GetDriveCapacity(string(dev))
			thisdrive.DriveFreeSpace = free
			thisdrive.DriveTotalSpace = total
			thisdrive.DriveAvailSpace = avail
			drives = append(drives, *thisdrive)
		}

	}

	jsonString, _ := json.Marshal(drives)
	common.SendJSONResponse(w, string(jsonString))
}

func system_fs_listRoot(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	username := userinfo.Username
	userRoot, _ := common.Mv(r, "user", false)
	if userRoot == "true" {
		type fileObject struct {
			Filename string
			Filepath string
			IsDir    bool
		}
		//List the root media folders under user:/
		fsh, _ := userinfo.GetFileSystemHandlerFromVirtualPath("user:/")
		fshAbs := fsh.FileSystemAbstraction
		filesInUserRoot := []fileObject{}
		filesInRoot, _ := fshAbs.Glob(filepath.ToSlash(filepath.Clean(*root_directory)) + "/users/" + username + "/*")
		for _, file := range filesInRoot {
			//Check if this is a hidden file
			if len(filepath.Base(file)) > 0 && filepath.Base(file)[:1] == "." {
				continue
			}
			thisFile := new(fileObject)
			thisFile.Filename = filepath.Base(file)
			thisFile.Filepath, _ = fshAbs.RealPathToVirtualPath(file, userinfo.Username)
			thisFile.IsDir = fshAbs.IsDir(file)
			filesInUserRoot = append(filesInUserRoot, *thisFile)
		}
		jsonString, _ := json.Marshal(filesInUserRoot)
		common.SendJSONResponse(w, string(jsonString))
	} else {
		type rootObject struct {
			rootID     string //The vroot id
			RootName   string //The name of this vroot
			RootPath   string //The path of this vroot
			BufferedFs bool   //If buffer typed FS
		}

		roots := []*rootObject{}
		for _, store := range userinfo.GetAllFileSystemHandler() {
			var thisDevice = new(rootObject)
			thisDevice.RootName = store.Name
			thisDevice.RootPath = store.UUID + ":/"
			thisDevice.rootID = store.UUID
			thisDevice.BufferedFs = store.RequireBuffer
			roots = append(roots, thisDevice)
		}

		jsonString, _ := json.Marshal(roots)
		common.SendJSONResponse(w, string(jsonString))
	}

}

/*
	Special Glob for handling path with [ or ] inside.
	You can also pass in normal path for globing if you are not sure.
*/

func system_fs_specialGlob(path string) ([]string, error) {
	//Quick fix for foldername containing -] issue
	path = strings.ReplaceAll(path, "[", "[[]")
	files, err := filepath.Glob(path)
	if err != nil {
		return []string{}, err
	}

	if strings.Contains(path, "[") == true || strings.Contains(path, "]") == true {
		if len(files) == 0 {
			//Handle reverse check. Replace all [ and ] with *
			newSearchPath := strings.ReplaceAll(path, "[", "?")
			newSearchPath = strings.ReplaceAll(newSearchPath, "]", "?")
			//Scan with all the similar structure except [ and ]
			tmpFilelist, _ := filepath.Glob(newSearchPath)
			for _, file := range tmpFilelist {
				file = filepath.ToSlash(file)
				if strings.Contains(file, filepath.ToSlash(filepath.Dir(path))) {
					files = append(files, file)
				}
			}
		}
	}
	//Convert all filepaths to slash
	for i := 0; i < len(files); i++ {
		files[i] = filepath.ToSlash(files[i])
	}
	return files, nil
}

func system_fs_specialURIDecode(inputPath string) string {
	inputPath = strings.ReplaceAll(inputPath, "+", "{{plus_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{plus_sign}}", "+")
	return inputPath
}

func system_fs_specialURIEncode(inputPath string) string {
	inputPath = strings.ReplaceAll(inputPath, " ", "{{space_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{space_sign}}", "%20")
	return inputPath
}

//Handle file properties request
func system_fs_getFileProperties(w http.ResponseWriter, r *http.Request) {
	type fileProperties struct {
		VirtualPath    string
		StoragePath    string
		Basename       string
		VirtualDirname string
		StorageDirname string
		Ext            string
		MimeType       string
		Filesize       int64
		Permission     string
		LastModTime    string
		LastModUnix    int64
		IsDirectory    bool
		Owner          string
	}

	result := fileProperties{}

	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	vpath, err := common.Mv(r, "path", true)
	if err != nil {
		common.SendErrorResponse(w, "path not defined")
		return
	}

	vrootID, subpath, _ := filesystem.GetIDFromVirtualPath(vpath)
	fsh, err := GetFsHandlerByUUID(vrootID)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	fshAbs := fsh.FileSystemAbstraction

	rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	fileStat, err := fshAbs.Stat(rpath)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	fileMime := "text/directory"
	if !fileStat.IsDir() {
		m, _, err := filesystem.GetMime(rpath)
		if err != nil {
			fileMime = mime.TypeByExtension(filepath.Ext(rpath))
		} else {
			fileMime = m
		}

	}

	filesize := fileStat.Size()
	//Get file overall size if this is folder
	if fileStat.IsDir() {
		var size int64
		fshAbs.Walk(rpath, func(_ string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() {
				size += info.Size()
			}
			return err
		})
		filesize = size
	}

	//Get file owner
	owner := userinfo.GetFileOwner(fsh, vpath)

	if owner == "" {
		//Handle special virtual roots
		owner = "Unknown"
	}

	result = fileProperties{
		VirtualPath:    vpath,
		StoragePath:    filepath.ToSlash(filepath.Clean(rpath)),
		Basename:       filepath.Base(rpath),
		VirtualDirname: filepath.ToSlash(filepath.Dir(vpath)),
		StorageDirname: filepath.ToSlash(filepath.Dir(rpath)),
		Ext:            filepath.Ext(rpath),
		MimeType:       fileMime,
		Filesize:       filesize,
		Permission:     fileStat.Mode().Perm().String(),
		LastModTime:    fileStat.ModTime().Format("2006-01-02 15:04:05"),
		LastModUnix:    fileStat.ModTime().Unix(),
		IsDirectory:    fileStat.IsDir(),
		Owner:          owner,
	}

	jsonString, _ := json.Marshal(result)
	common.SendJSONResponse(w, string(jsonString))

}

/*
	List directory in the given path

	Usage: Pass in dir like the following examples:
	AOR:/Desktop	<= Open /user/{username}/Desktop
	S1:/			<= Open {uuid=S1}/


*/

func system_fs_handleList(w http.ResponseWriter, r *http.Request) {
	currentDir, _ := common.Mv(r, "dir", true)
	//Commented this line to handle dirname that contains "+" sign
	//currentDir, _ = url.QueryUnescape(currentDir)
	sortMode, _ := common.Mv(r, "sort", true)
	showHidden, _ := common.Mv(r, "showHidden", true)
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//user not logged in. Redirect to login page.
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	if currentDir == "" {
		common.SendErrorResponse(w, "Invalid dir given.")
		return
	}

	//Pad a slash at the end of currentDir if not exists
	if currentDir[len(currentDir)-1:] != "/" {
		currentDir = currentDir + "/"
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(currentDir)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	fshAbs := fsh.FileSystemAbstraction

	//Normal file systems
	realpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	if !fshAbs.FileExists(realpath) {
		//Path not exists
		userRoot, _ := fshAbs.VirtualPathToRealPath("", userinfo.Username)
		if filepath.Clean(realpath) == filepath.Clean(userRoot) {
			//Initiate user folder (Initiaed in user object)
			userinfo.GetHomeDirectory()
		} else if !strings.Contains(filepath.ToSlash(filepath.Clean(currentDir)), "/") {
			//User root not created. Create the root folder
			os.MkdirAll(filepath.Clean(realpath), 0775)
		} else {
			//Folder not exists
			systemWideLogger.PrintAndLog("File System", "Requested path: "+realpath+" does not exists", nil)
			common.SendErrorResponse(w, "Folder not exists")
			return
		}

	}

	if sortMode == "" {
		sortMode = "default"
	}

	files, err := fshAbs.ReadDir(realpath)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Unable to read dir: "+err.Error(), err)
		return
	}

	//Remapping use parsed list
	parsedFilelist := map[string]filesystem.FileData{}

	//Sorting use list
	realpathList := []string{}
	fileInfoList := []fs.FileInfo{}

	for _, f := range files {
		//Check if it is hidden file
		isHidden, _ := hidden.IsHidden(f.Name(), false)
		if showHidden != "true" && isHidden {
			//Skipping hidden files
			continue
		}

		//Check if this is an aodb file
		if f.Name() == "aofs.db" || f.Name() == "aofs.db.lock" {
			//Database file (reserved)
			continue
		}

		//Check if it is shortcut file. If yes, render a shortcut data struct
		var shortCutInfo *arozfs.ShortcutData = nil
		if filepath.Ext(f.Name()) == ".shortcut" {
			//This is a shortcut file
			fcontent, err := fshAbs.ReadFile(arozfs.ToSlash(filepath.Join(realpath, f.Name())))
			if err != nil {
				shortCutInfo = nil
			} else {
				shorcutData, err := shortcut.ReadShortcut(fcontent)
				if err != nil {
					shortCutInfo = nil
				} else {
					shortCutInfo = shorcutData
				}
			}
		}

		statInfo, err := f.Info()
		if err != nil {
			continue
		}
		thisvPath, _ := fshAbs.RealPathToVirtualPath(filepath.Join(realpath, f.Name()), userinfo.Username)
		thisFile := filesystem.FileData{
			Filename:    f.Name(),
			Filepath:    currentDir + f.Name(),
			Realpath:    filepath.ToSlash(filepath.Join(realpath, f.Name())),
			IsDir:       f.IsDir(),
			Filesize:    statInfo.Size(),
			Displaysize: filesystem.GetFileDisplaySize(statInfo.Size(), 2),
			ModTime:     statInfo.ModTime().Unix(),
			IsShared:    shareManager.FileIsShared(userinfo, thisvPath),
			Shortcut:    shortCutInfo,
		}

		parsedFilelist[currentDir+f.Name()] = thisFile
		realpathList = append(realpathList, currentDir+f.Name())
		fileInfoList = append(fileInfoList, statInfo)
	}

	//Sort the filelist
	sortedRealpathList := fssort.SortFileList(realpathList, fileInfoList, sortMode)
	results := []filesystem.FileData{}

	for _, thisRpath := range sortedRealpathList {
		val, ok := parsedFilelist[thisRpath]
		if ok {
			results = append(results, val)
		}
	}

	jsonString, _ := json.Marshal(results)
	common.SendJSONResponse(w, string(jsonString))

}

//Handle getting a hash from a given contents in the given path
func system_fs_handleDirHash(w http.ResponseWriter, r *http.Request) {
	currentDir, err := common.Mv(r, "dir", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid dir given")
		return
	}

	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(currentDir)
	if err != nil {
		common.SendErrorResponse(w, "Unable to resolve target directory")
		return
	}
	fshAbs := fsh.FileSystemAbstraction

	rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, "Invalid dir given")
		return
	}

	//Get a list of files in this directory
	currentDir = filepath.ToSlash(filepath.Clean(rpath)) + "/"
	/*
		filesInDir, err := fshAbs.Glob(currentDir + "*")
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}


		filenames := []string{}
		for _, file := range filesInDir {
			if len(filepath.Base(file)) > 0 && string([]rune(filepath.Base(file))[0]) != "." {
				//Ignore hidden files
				filenames = append(filenames, filepath.Base(file))
			}

		}
	*/
	finfos, err := fshAbs.ReadDir(rpath)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	filenames := []string{}
	for _, fi := range finfos {
		isHiddenFile, _ := hidden.IsHidden(fi.Name(), false)
		if len(fi.Name()) > 0 && !isHiddenFile {
			//Ignore hidden files
			filenames = append(filenames, fi.Name())
		}
	}

	sort.Strings(filenames)

	//Build a hash base on the filelist
	h := sha256.New()
	h.Write([]byte(strings.Join(filenames, ",")))
	common.SendTextResponse(w, hex.EncodeToString((h.Sum(nil))))
}

/*
	File zipping and unzipping functions
*/

//Handle all zip related API
func system_fs_zipHandler(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	opr, err := common.Mv(r, "opr", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid opr or opr not defined")
		return
	}

	vsrc, _ := common.Mv(r, "src", true)
	if vsrc == "" {
		common.SendErrorResponse(w, "Invalid src paramter")
		return
	}

	vdest, _ := common.Mv(r, "dest", true)
	rdest := ""

	//Convert source path from JSON string to object
	virtualSourcePaths := []string{}
	err = json.Unmarshal([]byte(vsrc), &virtualSourcePaths)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	//Check each of the path
	realSourcePaths := []string{}
	sourceFshs := []*filesystem.FileSystemHandler{}
	for _, vpath := range virtualSourcePaths {
		thisSrcFsh, subpath, err := GetFSHandlerSubpathFromVpath(vpath)
		if err != nil {
			common.SendErrorResponse(w, "Unable to resolve file: "+vpath)
			return
		}
		thisSrcFshAbs := thisSrcFsh.FileSystemAbstraction
		thisrpath, err := thisSrcFshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
		if err != nil || !thisSrcFshAbs.FileExists(thisrpath) {
			common.SendErrorResponse(w, "File not exists: "+vpath)
			return
		}

		realSourcePaths = append(realSourcePaths, thisrpath)
		sourceFshs = append(sourceFshs, thisSrcFsh)
	}

	///Convert dest to real if given
	var destFsh *filesystem.FileSystemHandler = nil
	var subpath string = ""
	var filename string = ""
	if vdest != "" {
		//Given target virtual dest
		destFsh, subpath, err = GetFSHandlerSubpathFromVpath(rdest)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
	} else {
		//Given no virtual dest. Zip to tmp:/
		filename = common.Int64ToString(time.Now().Unix()) + ".zip"
		destFsh, subpath, err = GetFSHandlerSubpathFromVpath(filepath.Join("tmp:/", filename))
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
	}
	rdest, _ = destFsh.FileSystemAbstraction.VirtualPathToRealPath(subpath, userinfo.Username)
	destFshAbs := destFsh.FileSystemAbstraction
	zipOutput := rdest
	zipDestFsh := destFsh
	if destFsh.RequireBuffer {
		zipOutput = getFsBufferFilepath(rdest, false)
		zipDestFsh = nil
	}

	if opr == "zip" {
		//Check if destination location exists
		if rdest == "" || !destFshAbs.FileExists(filepath.Dir(zipOutput)) {
			common.SendErrorResponse(w, "Invalid dest location")
			return
		}

		//OK. Create the zip at the desired location
		err := filesystem.ArozZipFile(sourceFshs, realSourcePaths, zipDestFsh, zipOutput, false)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		common.SendOK(w)
	} else if opr == "tmpzip" {
		//Zip to tmp folder
		err := filesystem.ArozZipFile(sourceFshs, realSourcePaths, zipDestFsh, zipOutput, false)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Send the tmp filename to the user
		common.SendTextResponse(w, "tmp:/"+filename)
	}

	if destFsh.RequireBuffer {
		//Write the buffer zip file to destination
		f, _ := os.Open(zipOutput)
		destFsh.FileSystemAbstraction.WriteStream(rdest, f, 0775)
		f.Close()
		os.Remove(zipOutput)
	}
	cleanFsBufferFileFromList(realSourcePaths)
}

//Manage file version history
func system_fs_FileVersionHistory(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	path, err := common.Mv(r, "path", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid path given")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(path)
	if err != nil {
		if err != nil {
			common.SendErrorResponse(w, "Invalid path given")
			return
		}
	}
	fshAbs := fsh.FileSystemAbstraction

	opr, _ := common.Mv(r, "opr", true)

	rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, "Unable to translate virtual path")
		return
	}

	if opr == "" {
		//List file history

		fileVersionData, err := localversion.GetFileVersionData(fsh, rpath)
		if err != nil {
			common.SendErrorResponse(w, "Unable to load version information: "+err.Error())
			return
		}

		js, _ := json.Marshal(fileVersionData)
		common.SendJSONResponse(w, string(js))

	} else if opr == "delete" {
		//Delete file history of given history ID
		historyID, err := common.Mv(r, "histid", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid history id given")
			return
		}

		err = localversion.RemoveFileHistory(fsh, rpath, historyID)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		common.SendOK(w)
	} else if opr == "deleteAll" {
		//Delete all file history of given vpath
		err = localversion.RemoveAllRelatedFileHistory(fsh, rpath)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		common.SendOK(w)

	} else if opr == "restore" {
		//Restore file history of given history ID
		historyID, err := common.Mv(r, "histid", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid history id given")
			return
		}
		err = localversion.RestoreFileHistory(fsh, rpath, historyID)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		common.SendOK(w)
	} else if opr == "new" {
		//Create a new snapshot of this file
		err = localversion.CreateFileSnapshot(fsh, rpath)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		common.SendOK(w)
	} else {
		common.SendErrorResponse(w, "Unknown opr")
	}

}

func system_fs_clearVersionHistories() {
	allFsh := GetAllLoadedFsh()
	for _, fsh := range allFsh {
		if !fsh.ReadOnly {
			localversion.CleanExpiredVersionBackups(fsh, fsh.Path, 30*86400)
		}

	}
}

//Handle cache rendering with websocket pipeline
func system_fs_handleCacheRender(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vpath, err := common.Mv(r, "folder", false)
	if err != nil {
		common.SendErrorResponse(w, "Invalid folder paramter")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(vpath)
	if err != nil {
		common.SendErrorResponse(w, "Unable to resolve target directory")
		return
	}
	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(subpath, userinfo.Username)

	//Get folder sort mode
	sortMode := "default"
	folder := filepath.ToSlash(filepath.Clean(vpath))
	if sysdb.KeyExists("fs-sortpref", userinfo.Username+"/"+folder) {
		sysdb.Read("fs-sortpref", userinfo.Username+"/"+folder, &sortMode)
	}

	//Perform cache rendering
	thumbRenderHandler.HandleLoadCache(w, r, fsh, rpath, sortMode)
}

//Handle loading of one thumbnail
func system_fs_handleThumbnailLoad(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vpath, err := common.Mv(r, "vpath", false)
	if err != nil {
		common.SendErrorResponse(w, "vpath not defined")
		return
	}

	byteMode, _ := common.Mv(r, "bytes", false)
	isByteMode := byteMode == "true"
	fsh, subpath, err := GetFSHandlerSubpathFromVpath(vpath)
	if err != nil {
		if isByteMode {
			http.NotFound(w, r)
			return
		}
		common.SendErrorResponse(w, "Unable to resolve target directory")
		return
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		if isByteMode {
			http.NotFound(w, r)
			return
		}
		common.SendErrorResponse(w, err.Error())
		return
	}

	if isByteMode {
		thumbnailBytes, err := thumbRenderHandler.LoadCacheAsBytes(fsh, vpath, userinfo.Username, false)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		filetype := http.DetectContentType(thumbnailBytes)
		w.Header().Add("Content-Type", filetype)
		w.Write(thumbnailBytes)
	} else {
		thumbnailPath, err := thumbRenderHandler.LoadCache(fsh, rpath, false)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		js, _ := json.Marshal(thumbnailPath)
		common.SendJSONResponse(w, string(js))
	}
}

//Handle file thumbnail caching
func system_fs_handleFolderCache(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vfolderpath, err := common.Mv(r, "folder", false)
	if err != nil {
		common.SendErrorResponse(w, "folder not defined")
		return
	}

	fsh, _, err := GetFSHandlerSubpathFromVpath(vfolderpath)
	if err != nil {
		common.SendErrorResponse(w, "unable to resolve path")
		return
	}

	thumbRenderHandler.BuildCacheForFolder(fsh, vfolderpath, userinfo.Username)
	common.SendOK(w)
}

//Handle the get and set of sort mode of a particular folder
func system_fs_handleFolderSortModePreference(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}
	folder, err := common.Mv(r, "folder", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid folder given")
		return
	}

	opr, _ := common.Mv(r, "opr", true)

	folder = filepath.ToSlash(filepath.Clean(folder))

	if opr == "" || opr == "get" {
		sortMode := "default"
		if sysdb.KeyExists("fs-sortpref", userinfo.Username+"/"+folder) {
			sysdb.Read("fs-sortpref", userinfo.Username+"/"+folder, &sortMode)
		}

		js, err := json.Marshal(sortMode)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
		common.SendJSONResponse(w, string(js))
	} else if opr == "set" {
		sortMode, err := common.Mv(r, "mode", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid sort mode given")
			return
		}

		if !common.StringInArray([]string{"default", "reverse", "smallToLarge", "largeToSmall", "mostRecent", "leastRecent"}, sortMode) {
			common.SendErrorResponse(w, "Not supported sort mode: "+sortMode)
			return
		}

		sysdb.Write("fs-sortpref", userinfo.Username+"/"+folder, sortMode)
		common.SendOK(w)
	} else {
		common.SendErrorResponse(w, "Invalid opr mode")
		return
	}
}

//Handle setting and loading of file permission on Linux
func system_fs_handleFilePermission(w http.ResponseWriter, r *http.Request) {
	file, err := common.Mv(r, "file", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid file")
		return
	}

	//Translate the file to real path
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	fsh, subpath, err := GetFSHandlerSubpathFromVpath(file)
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	newMode, _ := common.Mv(r, "mode", true)
	if newMode == "" {
		//Read the file mode

		//Check if the file exists
		if !fshAbs.FileExists(rpath) {
			common.SendErrorResponse(w, "File not exists!")
			return
		}

		//Read the file permission
		filePermission, err := fsp.GetFilePermissions(fsh, rpath)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Send the file permission to client
		js, _ := json.Marshal(filePermission)
		common.SendJSONResponse(w, string(js))
	} else {
		//Set the file mode
		//Check if the file exists
		if !filesystem.FileExists(rpath) {
			common.SendErrorResponse(w, "File not exists!")
			return
		}

		//Check if windows. If yes, ignore this request
		if runtime.GOOS == "windows" {
			common.SendErrorResponse(w, "Windows host not supported")
			return
		}

		//Check if this user has permission to change the file permission
		//Aka user must be 1. This is his own folder or 2. Admin
		fsh, _ := userinfo.GetFileSystemHandlerFromVirtualPath(file)
		if fsh.Hierarchy == "user" {
			//Always ok as this is owned by the user
		} else if fsh.Hierarchy == "public" {
			//Require admin
			if userinfo.IsAdmin() == false {
				common.SendErrorResponse(w, "Permission Denied")
				return
			}
		} else {
			//Not implemeneted. Require admin
			if userinfo.IsAdmin() == false {
				common.SendErrorResponse(w, "Permission Denied")
				return
			}
		}

		//Be noted that if the system is not running in sudo mode,
		//File permission change might not works.

		err := fsp.SetFilePermisson(fsh, rpath, newMode)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		} else {
			common.SendOK(w)
		}
	}
}

//Clear the old files inside the tmp file
func system_fs_clearOldTmpFiles() {
	filesToBeDelete := []string{}
	tmpAbs, _ := filepath.Abs(*tmp_directory)
	filepath.Walk(*tmp_directory, func(path string, info os.FileInfo, err error) error {
		if filepath.Base(path) != "aofs.db" && filepath.Base(path) != "aofs.db.lock" {
			//Check if root folders. Do not delete root folders
			parentAbs, _ := filepath.Abs(filepath.Dir(path))

			if tmpAbs == parentAbs {
				//Root folder. Do not remove
				return nil
			}
			//Get its modification time
			modTime, err := filesystem.GetModTime(path)
			if err != nil {
				return nil
			}

			//Check if mod time is more than 24 hours ago
			if time.Now().Unix()-modTime > int64(*maxTempFileKeepTime) {
				//Delete OK
				filesToBeDelete = append(filesToBeDelete, path)
			}
		}
		return nil
	})

	//Remove all files from the delete list
	for _, fileToBeDelete := range filesToBeDelete {
		os.RemoveAll(fileToBeDelete)
	}

}

/*
	File System Utilities for Buffered type FS

	These functions help create a local representation of file
	buffer from remote file systems like webdav or SMB
	**REMEMBER TO CLEAR THE BUFFER FILES YOURSELF**

	Example Usage
	//Replace a destination path (for file create) with local buffer filepath
	if destFsh.RequireBuffer {
		dest = getFsBufferFilepath(outputFilename)
	}

	//Buffer a remote file to local first before doing any advance file operations
	if thisSrcFsh.RequireBuffer {
		localBufferFilepath, err := bufferRemoteFileToLocal(fsh, remoteRealSrc)
		if err != nil{
			//Handle Error
		}
	}

	//Clean a list of source files that contains local buffer files
	clearnFsBufferFileFromList(realSourceFiles)

*/

//Generate a random buffer filepath. Remember to delete file after usage
func getFsBufferFilepath(originalFilename string, keepOriginalName bool) string {
	thisBuffFilename := uuid.NewV4().String()
	tmpDir := filepath.Join(*tmp_directory, "fsBuff")
	targetFile := filepath.Join(tmpDir, thisBuffFilename+filepath.Ext(originalFilename))
	if keepOriginalName {
		targetFile = filepath.Join(tmpDir, thisBuffFilename, filepath.Base(originalFilename))
	}
	os.MkdirAll(filepath.Dir(targetFile), 0775)

	return filepath.ToSlash(targetFile)
}

//Generate a buffer filepath and buffer the remote file to local. Remember to remove file after done.
func bufferRemoteFileToLocal(targetFsh *filesystem.FileSystemHandler, rpath string, keepOriginalName bool) (string, error) {
	newBufferFilename := getFsBufferFilepath(rpath, keepOriginalName)
	src, err := targetFsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Buffer from remote to local failed: "+err.Error(), err)
		return "", err
	}
	defer src.Close()

	dest, err := os.OpenFile(newBufferFilename, os.O_CREATE|os.O_WRONLY, 0775)
	if err != nil {
		systemWideLogger.PrintAndLog("File System", "Buffer from remote to local failed: "+err.Error(), err)
		return "", err
	}
	io.Copy(dest, src)
	dest.Close()

	return newBufferFilename, nil
}

//Check if a file is buffer filepath
func isFsBufferFilepath(filename string) bool {
	tmpDir := filepath.Join(*tmp_directory, "fsBuff")
	filenameAbs, _ := filepath.Abs(filename)
	filenameAbs = filepath.ToSlash(filenameAbs)
	tmpDirAbs, _ := filepath.Abs(tmpDir)
	tmpDirAbs = filepath.ToSlash(tmpDirAbs)
	return strings.HasPrefix(filenameAbs, tmpDirAbs)
}

func cleanFsBufferFileFromList(filelist []string) {
	for _, thisFilepath := range filelist {
		if isFsBufferFilepath(thisFilepath) {
			os.RemoveAll(thisFilepath)
			folderContent, _ := os.ReadDir(filepath.Dir(thisFilepath))
			if len(folderContent) == 0 {
				//Nothing in this folder. Remove it
				os.Remove(filepath.Dir(thisFilepath))
			}
		}
	}
}
