package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/ioutil"
	"log"
	"math"
	"mime/multipart"
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

	"imuslab.com/arozos/mod/compatibility"
	"imuslab.com/arozos/mod/disk/hybridBackup"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	fsp "imuslab.com/arozos/mod/filesystem/fspermission"
	"imuslab.com/arozos/mod/filesystem/fuzzy"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/share"
	"imuslab.com/arozos/mod/share/shareEntry"
	storage "imuslab.com/arozos/mod/storage"
	user "imuslab.com/arozos/mod/user"
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
			sendErrorResponse(w, "Permission Denied")
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
	router.HandleFunc("/system/file_system/pathTranslate", system_fs_handlePathTranslate)

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
	err := os.MkdirAll(*root_directory+"users/", 0755)
	if err != nil {
		log.Println("Failed to create system storage root.")
		panic(err)
	}

	//Create database table if not exists
	err = sysdb.NewTable("fs")
	if err != nil {
		log.Println("Failed to create table for file system")
		panic(err)
	}

	//Create new table for sort preference
	err = sysdb.NewTable("fs-sortpref")
	if err != nil {
		log.Println("Failed to create table for file system")
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

}

/*
	File Search

	Handle file search in wildcard and recursive search

*/

func system_fs_handleFileSearch(w http.ResponseWriter, r *http.Request) {
	//Get the user information
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get the search target root path
	vpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "Invalid vpath given")
		return
	}

	keyword, err := mv(r, "keyword", true)
	if err != nil {
		sendErrorResponse(w, "Invalid keyword given")
		return
	}

	//Check if case sensitive is enabled
	casesensitve, _ := mv(r, "casesensitive", true)

	vrootID, subpath, err := fs.GetIDFromVirtualPath(vpath)
	var targetFSH *filesystem.FileSystemHandler = nil
	if err != nil {

		sendErrorResponse(w, "Invalid path given")
		return
	} else {
		targetFSH, _ = GetFsHandlerByUUID(vrootID)
	}
	rpath := ""
	if targetFSH != nil && targetFSH.Filesystem != "virtual" {
		//Translate the vpath to realpath if this is an actual path on disk
		resolvedPath, err := userinfo.VirtualPathToRealPath(vpath)
		if err != nil {
			sendErrorResponse(w, "Invalid path given")
			return
		}

		rpath = resolvedPath
	}

	//Check if the search mode is recursive keyword or wildcard
	if len(keyword) > 1 && keyword[:1] == "/" {
		//Wildcard

		//Updates 31-12-2021: Do not allow wildcard search on virtual type's FSH
		if targetFSH != nil && targetFSH.Filesystem == "virtual" {
			sendErrorResponse(w, "This virtual storage device do not allow wildcard search")
			return
		}

		wildcard := keyword[1:]
		matchingFiles, err := filepath.Glob(filepath.Join(rpath, wildcard))
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Prepare result struct
		results := []fs.FileData{}

		//Process the matching files. Do not allow directory escape
		srcAbs, _ := filepath.Abs(rpath)
		srcAbs = filepath.ToSlash(srcAbs)
		escaped := false
		for _, matchedFile := range matchingFiles {
			absMatch, _ := filepath.Abs(matchedFile)
			absMatch = filepath.ToSlash(absMatch)
			if !strings.Contains(absMatch, srcAbs) {
				escaped = true
			}

			thisVpath, _ := userinfo.RealPathToVirtualPath(matchedFile)
			results = append(results, fs.GetFileDataFromPath(thisVpath, matchedFile, 2))

		}

		if escaped {
			sendErrorResponse(w, "Search keywords contain escape character!")
			return
		}

		//OK. Tidy up the results
		js, _ := json.Marshal(results)
		sendJSONResponse(w, string(js))
	} else {
		//Updates 2022-02-16: Build the fuzzy matcher if it is not a wildcard search
		matcher := fuzzy.NewFuzzyMatcher(keyword, casesensitve == "true")

		//Recursive keyword
		results := []fs.FileData{}
		var err error = nil
		if targetFSH != nil && targetFSH.Filesystem == "virtual" {
			//To be done: Move hardcoded vroot ID to interface for all virtual storage devices
			if vrootID == "share" {
				if casesensitve != "true" {
					keyword = strings.ToLower(keyword)
				}
				err = shareEntryTable.Walk(subpath, userinfo.Username, userinfo.GetUserPermissionGroupNames(), func(fileData fs.FileData) error {
					filename := filepath.Base(fileData.Filename)
					if casesensitve != "true" {
						filename = strings.ToLower(filename)
					}
					if matcher.Match(filename) {
						//This is a matching file
						if !fs.IsInsideHiddenFolder(fileData.Filepath) {
							results = append(results, fileData)
						}
					}
					return nil
				})
			} else {
				log.Println("Dynamic virtual root walk is not supported yet: ", vrootID)
			}
		} else {
			if casesensitve != "true" {
				keyword = strings.ToLower(keyword)
			}

			err = filepath.Walk(rpath, func(path string, info os.FileInfo, err error) error {
				thisFilename := filepath.Base(path)
				if casesensitve != "true" {
					thisFilename = strings.ToLower(thisFilename)
				}

				if !fs.IsInsideHiddenFolder(path) {
					if matcher.Match(thisFilename) {
						//This is a matching file
						thisVpath, _ := userinfo.RealPathToVirtualPath(path)
						results = append(results, fs.GetFileDataFromPath(thisVpath, path, 2))

					}
				}

				return nil
			})
		}

		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
		//OK. Tidy up the results
		js, _ := json.Marshal(results)
		sendJSONResponse(w, string(js))
	}

}

/*
	Handle low-memory upload operations

	This function is specailly designed to work with low memory devices
	(e.g. ZeroPi / Orange Pi Zero with 512MB RAM)
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
	filename, err := mv(r, "filename", false)
	if filename == "" || err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Invalid filename given"))
		return
	}

	//Get upload target directory
	uploadTarget, err := mv(r, "path", false)
	if uploadTarget == "" || err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Invalid path given"))
		return
	}

	//Check if the user can write to this folder
	if !userinfo.CanWrite(uploadTarget) {
		//No permission
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - Access Denied"))
		return
	}

	//Translate the upload target directory
	realUploadPath, err := userinfo.VirtualPathToRealPath(uploadTarget)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Path translation failed"))
		return
	}

	//Generate an UUID for this upload
	uploadUUID := uuid.NewV4().String()
	uploadFolder := filepath.Join(*tmp_directory, "uploads", uploadUUID)
	os.MkdirAll(uploadFolder, 0700)
	targetUploadLocation := filepath.Join(realUploadPath, filename)
	if !fileExists(realUploadPath) {
		os.MkdirAll(realUploadPath, 0755)
	}

	//Start websocket connection
	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Failed to upgrade websocket connection: ", err.Error())
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
					log.Println("Upload WebSocket connection timeout. Disconnecting.")
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
			log.Println("Upload terminated by client. Cleaning tmp folder.")
			//Clear the tmp folder
			time.Sleep(1 * time.Second)
			os.RemoveAll(uploadFolder)
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
			ioutil.WriteFile(chunkFilepath, message, 0700)

			//Update the last upload chunk time
			lastChunkArrivalTime = time.Now().Unix()

			//Check if the file size is too big
			totalFileSize += fs.GetFileSize(chunkFilepath)
			if totalFileSize > max_upload_size {
				//File too big
				c.WriteMessage(1, []byte(`{\"error\":\"File size too large.\"}`))

				//Close the connection
				c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
				time.Sleep(1 * time.Second)
				c.Close()

				//Clear the tmp files
				os.RemoveAll(uploadFolder)
				return
			} else if !userinfo.StorageQuota.HaveSpace(totalFileSize) {
				//Quota exceeded
				c.WriteMessage(1, []byte(`{\"error\":\"User Storage Quota Exceeded\"}`))

				//Close the connection
				c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
				time.Sleep(1 * time.Second)
				c.Close()

				//Clear the tmp files
				os.RemoveAll(uploadFolder)

			}
			blockCounter++

			//Request client to send the next chunk
			c.WriteMessage(1, []byte("next"))

		}
		//log.Println("recv:", len(message), "type", mt)
	}

	//Try to decode the location if possible
	decodedUploadLocation, err := url.QueryUnescape(targetUploadLocation)
	if err != nil {
		decodedUploadLocation = targetUploadLocation
	}

	//Do not allow % sign in filename. Replace all with underscore
	decodedUploadLocation = strings.ReplaceAll(decodedUploadLocation, "%", "_")

	//Merge the file
	out, err := os.OpenFile(decodedUploadLocation, os.O_CREATE|os.O_WRONLY, 0755)
	if err != nil {
		log.Println("Failed to open file:", err)
		c.WriteMessage(1, []byte(`{\"error\":\"Failed to open destination file\"}`))
		c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
		time.Sleep(1 * time.Second)
		c.Close()
		return
	}

	for _, filesrc := range chunkName {
		srcChunkReader, err := os.Open(filesrc)
		if err != nil {
			log.Println("Failed to open Source Chunk", filesrc, " with error ", err.Error())
			c.WriteMessage(1, []byte(`{\"error\":\"Failed to open Source Chunk\"}`))
			return
		}
		io.Copy(out, srcChunkReader)
		srcChunkReader.Close()
	}

	out.Close()

	//Check if the size fit in user quota
	fi, err := os.Stat(decodedUploadLocation)
	if err != nil {
		// Could not obtain stat, handle error
		log.Println("Failed to validate uploaded file: ", decodedUploadLocation, ". Error Message: ", err.Error())
		c.WriteMessage(1, []byte(`{\"error\":\"Failed to validate uploaded file\"}`))
		return
	}

	if !userinfo.StorageQuota.HaveSpace(fi.Size()) {
		c.WriteMessage(1, []byte(`{\"error\":\"User Storage Quota Exceeded\"}`))
		os.RemoveAll(decodedUploadLocation)
		return
	}

	//Log the upload filename
	log.Println(userinfo.Username + " uploaded a file: " + filepath.Base(decodedUploadLocation))

	//Set owner of the new uploaded file
	userinfo.SetOwnerOfFile(decodedUploadLocation)

	//Return complete signal
	c.WriteMessage(1, []byte("OK"))

	//Stop the timeout listner
	done <- true

	//Clear the tmp folder
	time.Sleep(300 * time.Millisecond)
	err = os.RemoveAll(uploadFolder)
	if err != nil {
		log.Println(err)
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
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Limit the max upload size to the user defined size
	if max_upload_size != 0 {
		r.Body = http.MaxBytesReader(w, r.Body, max_upload_size)
	}

	//Check if this is running under demo mode. If yes, reject upload
	if *demo_mode {
		sendErrorResponse(w, "You cannot upload in demo mode")
		return
	}

	err = r.ParseMultipartForm(int64(*upload_buf) << 20)
	if err != nil {
		//Filesize too big
		log.Println(err)
		sendErrorResponse(w, "File too large")
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		log.Println("Error Retrieving File from upload by user: " + userinfo.Username)
		sendErrorResponse(w, "Unable to parse file from upload")
		return
	}

	//Get upload target directory
	uploadTarget, _ := mv(r, "path", true)
	if uploadTarget == "" {
		sendErrorResponse(w, "Upload target cannot be empty.")
		return
	}

	//Translate the upload target directory
	realUploadPath, err := userinfo.VirtualPathToRealPath(uploadTarget)
	if err != nil {
		sendErrorResponse(w, "Upload target is invalid or permission denied.")
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

	destFilepath := filepath.ToSlash(filepath.Clean(realUploadPath)) + "/" + storeFilename

	if !fileExists(filepath.Dir(destFilepath)) {
		os.MkdirAll(filepath.Dir(destFilepath), 0775)
	}

	//Check if the upload target is read only.
	accmode := userinfo.GetPathAccessPermission(uploadTarget)
	if accmode == "readonly" {
		sendErrorResponse(w, "The upload target is Read Only.")
		return
	} else if accmode == "denied" {
		sendErrorResponse(w, "Access Denied")
		return
	}

	//Check for storage quota
	uploadFileSize := handler.Size
	if !userinfo.StorageQuota.HaveSpace(uploadFileSize) {
		sendErrorResponse(w, "User Storage Quota Exceeded")
		return
	}

	//Do not allow % sign in filename. Replace all with underscore
	destFilepath = strings.ReplaceAll(destFilepath, "%", "_")

	//Prepare the file to be created (uploaded)
	destination, err := os.Create(destFilepath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	defer destination.Close()
	defer file.Close()

	//Move the file to destination file location
	if *enable_asyncFileUpload {
		//Use Async upload method
		go func(r *http.Request, file multipart.File, destination *os.File, userinfo *user.User) {
			//Do the file copying using a buffered reader
			buf := make([]byte, *file_opr_buff)
			for {
				n, err := file.Read(buf)
				if err != nil && err != io.EOF {
					log.Println(err.Error())
					return
				}
				if n == 0 {
					break
				}

				if _, err := destination.Write(buf[:n]); err != nil {
					log.Println(err.Error())
					return
				}
			}

			//Clear up buffered files
			r.MultipartForm.RemoveAll()

			//Set the ownership of file
			userinfo.SetOwnerOfFile(destFilepath)

			//Perform a GC afterward
			runtime.GC()

		}(r, file, destination, userinfo)
	} else {
		//Use blocking upload and move method
		buf := make([]byte, *file_opr_buff)
		for {
			n, err := file.Read(buf)
			if err != nil && err != io.EOF {
				log.Println(err.Error())
				return
			}
			if n == 0 {
				break
			}

			if _, err := destination.Write(buf[:n]); err != nil {
				log.Println(err.Error())
				return
			}
		}

		//Clear up buffered files
		r.MultipartForm.RemoveAll()

		//Set the ownership of file
		userinfo.SetOwnerOfFile(destFilepath)
	}

	//Finish up the upload
	/*
		fmt.Printf("Uploaded File: %+v\n", handler.Filename)
		fmt.Printf("File Size: %+v\n", handler.Size)
		fmt.Printf("MIME Header: %+v\n", handler.Header)
		fmt.Println("Upload target: " + realUploadPath)
	*/

	//Fnish upload. Fix the tmp filename
	log.Println(userinfo.Username + " uploaded a file: " + handler.Filename)

	//Do upload finishing stuff

	//Add a delay to the complete message to make sure browser catch the return value
	currentTimeMilli := time.Now().UnixNano() / int64(time.Millisecond)
	if currentTimeMilli-uploadStartTime < 100 {
		//Sleep until at least 300 ms
		time.Sleep(time.Duration(100 - (currentTimeMilli - uploadStartTime)))
	}
	//Completed
	sendOK(w)
}

//Validate if the copy and target process will involve file overwriting problem.
func system_fs_validateFileOpr(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	vsrcFiles, _ := mv(r, "src", true)
	vdestFile, _ := mv(r, "dest", true)
	var duplicateFiles []string = []string{}

	//Loop through all files are see if there are duplication during copy and paste
	sourceFiles := []string{}
	decodedSourceFiles, _ := url.QueryUnescape(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		sendErrorResponse(w, "Source file JSON parse error.")
		return
	}

	rdestFile, _ := userinfo.VirtualPathToRealPath(vdestFile)
	for _, file := range sourceFiles {
		rsrcFile, _ := userinfo.VirtualPathToRealPath(string(file))
		if fileExists(filepath.Join(rdestFile, filepath.Base(rsrcFile))) {
			//File exists already.
			vpath, _ := userinfo.RealPathToVirtualPath(rsrcFile)
			duplicateFiles = append(duplicateFiles, vpath)
		}

	}

	jsonString, _ := json.Marshal(duplicateFiles)
	sendJSONResponse(w, string(jsonString))
}

//Scan all directory and get trash file and send back results with WebSocket
func system_fs_WebSocketScanTrashBin(w http.ResponseWriter, r *http.Request) {
	//Get and check user permission
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
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
	scanningRoots := []string{}
	//Get all roots to scan
	for _, storage := range userinfo.GetAllFileSystemHandler() {
		if storage.Hierarchy == "backup" {
			//Skip this fsh
			continue
		}

		if storage.Hierarchy == "user" {
			storageRoot := filepath.ToSlash(filepath.Join(storage.Path, "users", userinfo.Username))
			scanningRoots = append(scanningRoots, storageRoot)
		} else {
			storageRoot := storage.Path
			scanningRoots = append(scanningRoots, storageRoot)
		}

	}

	for _, rootPath := range scanningRoots {
		err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
			oneLevelUpper := filepath.Base(filepath.Dir(path))
			if oneLevelUpper == ".trash" {
				//This is a trashbin dir.
				file := path

				//Parse the trashFile struct
				timestamp := filepath.Ext(file)[1:]
				originalName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(filepath.Base(file)))
				originalExt := filepath.Ext(filepath.Base(originalName))
				virtualFilepath, _ := userinfo.RealPathToVirtualPath(file)
				virtualOrgPath, _ := userinfo.RealPathToVirtualPath(filepath.Dir(filepath.Dir(file)))
				rawsize := fs.GetFileSize(file)
				timestampInt64, _ := StringToInt64(timestamp)
				removeTimeDate := time.Unix(timestampInt64, 0)
				if IsDir(file) {
					originalExt = ""
				}

				thisTrashFileObject := trashedFile{
					Filename:         filepath.Base(file),
					Filepath:         virtualFilepath,
					FileExt:          originalExt,
					IsDir:            IsDir(file),
					Filesize:         int64(rawsize),
					RemoveTimestamp:  timestampInt64,
					RemoveDate:       timeToString(removeTimeDate),
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
		sendErrorResponse(w, err.Error())
		return
	}
	username := userinfo.Username

	results := []trashedFile{}
	files, err := system_fs_listTrash(username)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	//Get information of each files and process it into results
	for _, file := range files {
		timestamp := filepath.Ext(file)[1:]
		originalName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(filepath.Base(file)))
		originalExt := filepath.Ext(filepath.Base(originalName))
		virtualFilepath, _ := userinfo.RealPathToVirtualPath(file)
		virtualOrgPath, _ := userinfo.RealPathToVirtualPath(filepath.Dir(filepath.Dir(file)))
		rawsize := fs.GetFileSize(file)
		timestampInt64, _ := StringToInt64(timestamp)
		removeTimeDate := time.Unix(timestampInt64, 0)
		if IsDir(file) {
			originalExt = ""
		}
		results = append(results, trashedFile{
			Filename:         filepath.Base(file),
			Filepath:         virtualFilepath,
			FileExt:          originalExt,
			IsDir:            IsDir(file),
			Filesize:         int64(rawsize),
			RemoveTimestamp:  timestampInt64,
			RemoveDate:       timeToString(removeTimeDate),
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
	sendJSONResponse(w, string(jsonString))
}

//Restore a trashed file to its parent dir
func system_fs_restoreFile(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	targetTrashedFile, err := mv(r, "src", true)
	if err != nil {
		sendErrorResponse(w, "Invalid src given")
		return
	}

	//Translate it to realpath
	realpath, _ := userinfo.VirtualPathToRealPath(targetTrashedFile)
	if !fileExists(realpath) {
		sendErrorResponse(w, "File not exists")
		return
	}

	//Check if this is really a trashed file
	if filepath.Base(filepath.Dir(realpath)) != ".trash" {
		sendErrorResponse(w, "File not in trashbin")
		return
	}

	//OK to proceed.
	targetPath := filepath.ToSlash(filepath.Dir(filepath.Dir(realpath))) + "/" + strings.TrimSuffix(filepath.Base(realpath), filepath.Ext(filepath.Base(realpath)))
	//log.Println(targetPath);
	os.Rename(realpath, targetPath)

	//Check if the parent dir has no more fileds. If yes, remove it
	filescounter, _ := filepath.Glob(filepath.Dir(realpath) + "/*")
	if len(filescounter) == 0 {
		os.Remove(filepath.Dir(realpath))
	}

	sendOK(w)
}

//Clear all trashed file in the system
func system_fs_clearTrashBin(w http.ResponseWriter, r *http.Request) {
	u, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	username := u.Username

	fileList, err := system_fs_listTrash(username)
	if err != nil {
		sendErrorResponse(w, "Unable to clear trash: "+err.Error())
		return
	}

	//Get list success. Remove each of them.
	for _, file := range fileList {
		isOwner := u.IsOwnerOfFile(file)
		if isOwner {
			//This user own this system. Remove this file from his quota
			u.RemoveOwnershipFromFile(file)
		}

		os.RemoveAll(file)
		//Check if its parent directory have no files. If yes, remove the dir itself as well.
		filesInThisTrashBin, _ := filepath.Glob(filepath.Dir(file) + "/*")
		if len(filesInThisTrashBin) == 0 {
			os.Remove(filepath.Dir(file))
		}
	}

	sendOK(w)
}

//Get all trash in a string list
func system_fs_listTrash(username string) ([]string, error) {
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	scanningRoots := []string{}
	//Get all roots to scan
	for _, storage := range userinfo.GetAllFileSystemHandler() {
		if storage.Hierarchy == "backup" {
			//Skip this fsh
			continue
		}

		if storage.Hierarchy == "user" {
			storageRoot := filepath.ToSlash(filepath.Join(storage.Path, "users", userinfo.Username))
			scanningRoots = append(scanningRoots, storageRoot)
		} else {
			storageRoot := storage.Path
			scanningRoots = append(scanningRoots, storageRoot)
		}

	}

	files := []string{}
	for _, rootPath := range scanningRoots {
		err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
			oneLevelUpper := filepath.Base(filepath.Dir(path))
			if oneLevelUpper == ".trash" {
				//This is a trashbin dir.
				files = append(files, path)
			}
			return nil
		})
		if err != nil {
			return []string{}, errors.New("Failed to scan file system.")
		}
	}

	return files, nil
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
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Validate the token
	tokenValid := CSRFTokenManager.HandleTokenValidation(w, r)
	if !tokenValid {
		http.Error(w, "Invalid CSRF token", 401)
		return
	}

	fileType, _ := mv(r, "type", true)     //File creation type, {file, folder}
	vsrc, _ := mv(r, "src", true)          //Virtual file source folder, do not include filename
	filename, _ := mv(r, "filename", true) //Filename for the new file

	if fileType == "" && filename == "" {
		//List all the supported new filetype
		if !fileExists("system/newitem/") {
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
			log.Println("*File System* Unable to parse JSON string for new item list!")
			sendErrorResponse(w, "Unable to parse new item list. See server log for more information.")
			return
		}
		sendJSONResponse(w, string(jsonString))
		return
	} else if fileType != "" && filename != "" {
		if vsrc == "" {
			sendErrorResponse(w, "Missing paramter: 'src'")
			return
		}
		//Translate the path to realpath
		rpath, err := userinfo.VirtualPathToRealPath(vsrc)
		if err != nil {
			sendErrorResponse(w, "Invalid path given")
			return
		}

		//Check if directory is readonly
		accmode := userinfo.GetPathAccessPermission(vsrc)
		if accmode == "readonly" {
			sendErrorResponse(w, "This directory is Read Only")
			return
		} else if accmode == "denied" {
			sendErrorResponse(w, "Access Denied")
			return
		}

		//Check if the file already exists. If yes, fix its filename.
		newfilePath := filepath.ToSlash(filepath.Join(rpath, filename))

		if fileType == "file" {
			for fileExists(newfilePath) {
				sendErrorResponse(w, "Given filename already exists")
				return
			}
			ext := filepath.Ext(filename)

			if ext == "" {
				//This is a file with no extension.
				f, err := os.Create(newfilePath)
				if err != nil {
					log.Println("*File System* " + err.Error())
					sendErrorResponse(w, err.Error())
					return
				}
				f.Close()
			} else {
				templateFile, _ := filepath.Glob("system/newitem/*" + ext)
				if len(templateFile) == 0 {
					//This file extension is not in template
					f, err := os.Create(newfilePath)
					if err != nil {
						log.Println("*File System* " + err.Error())
						sendErrorResponse(w, err.Error())
						return
					}
					f.Close()
				} else {
					//Copy file from templateFile[0] to current dir with the given name
					input, _ := ioutil.ReadFile(templateFile[0])
					err := ioutil.WriteFile(newfilePath, input, 0755)
					if err != nil {
						log.Println("*File System* " + err.Error())
						sendErrorResponse(w, err.Error())
						return
					}
				}
			}

		} else if fileType == "folder" {
			if fileExists(newfilePath) {
				sendErrorResponse(w, "Given folder already exists")
				return
			}
			//Create the folder at target location
			err := os.Mkdir(newfilePath, 0755)
			if err != nil {
				sendErrorResponse(w, err.Error())
				return
			}
		}

		sendJSONResponse(w, "\"OK\"")
	} else {
		sendErrorResponse(w, "Missing paramter(s).")
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
		sendErrorResponse(w, "User not logged in")
		return
	}

	operation, _ := mv(r, "opr", false) //Accept copy and move
	vsrcFiles, _ := mv(r, "src", false)
	vdestFile, _ := mv(r, "dest", false)
	existsOpr, _ := mv(r, "existsresp", false)

	if existsOpr == "" {
		existsOpr = "keep"
	}

	//Decode the source file list
	var sourceFiles []string
	tmp := []string{}
	decodedSourceFiles, _ := url.QueryUnescape(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		log.Println("Source file JSON parse error.", err.Error())
		sendErrorResponse(w, "Source file JSON parse error.")
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
	rdestFile, _ := userinfo.VirtualPathToRealPath(vdestFile)

	//Permission checking
	if !userinfo.CanWrite(vdestFile) {
		log.Println("Access denied for " + userinfo.Username + " try to access " + vdestFile)
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - Access Denied"))
		return
	}

	//Check if opr is suported
	if operation == "move" || operation == "copy" || operation == "zip" || operation == "unzip" {

	} else {
		log.Println("This file operation is not supported on WebSocket file operations endpoint. Please use the legacy endpoint instead. Received: ", operation)
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
		outputFilename := filepath.Join(rdestFile, filepath.Base(rdestFile)) + ".zip"
		if len(sourceFiles) == 1 {
			//Use the basename of the source file as zip file name
			outputFilename = filepath.Join(rdestFile, filepath.Base(sourceFiles[0])) + ".zip"
		}

		//Translate source Files into real paths
		realSourceFiles := []string{}
		for _, vsrcs := range sourceFiles {
			rsrc, err := userinfo.VirtualPathToRealPath(vsrcs)
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

			realSourceFiles = append(realSourceFiles, rsrc)
		}

		//Create the zip file
		fs.ArozZipFileWithProgress(realSourceFiles, outputFilename, false, func(currentFilename string, _ int, _ int, progress float64) {
			currentStatus := ProgressUpdate{
				LatestFile: currentFilename,
				Progress:   int(math.Ceil(progress)),
				Error:      "",
			}

			js, _ := json.Marshal(currentStatus)
			c.WriteMessage(1, js)
		})
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
		os.MkdirAll(rdestFile, 0755)

		//Convert the src files into realpaths
		realSourceFiles := []string{}
		for _, vsrcs := range sourceFiles {
			rsrc, err := userinfo.VirtualPathToRealPath(vsrcs)
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

			realSourceFiles = append(realSourceFiles, rsrc)
		}

		//Unzip the files
		fs.ArozUnzipFileWithProgress(realSourceFiles, rdestFile, func(currentFile string, filecount int, totalfile int, progress float64) {
			//Generate the status update struct

			currentStatus := ProgressUpdate{
				LatestFile: filepath.Base(currentFile),
				Progress:   int(math.Ceil(progress)),
				Error:      "",
			}

			js, _ := json.Marshal(currentStatus)
			c.WriteMessage(1, js)
		})

	} else {
		//Other operations that allow multiple source files to handle one by one
		for i := 0; i < len(sourceFiles); i++ {
			vsrcFile := sourceFiles[i]
			rsrcFile, _ := userinfo.VirtualPathToRealPath(vsrcFile)
			//c.WriteMessage(1, message)
			if !fileExists(rsrcFile) {
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
				underSameRoot, _ := fs.UnderTheSameRoot(rsrcFile, rdestFile)
				err := fs.FileMove(rsrcFile, rdestFile, existsOpr, underSameRoot, func(progress int, currentFile string) {
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
				metadata.RemoveCache(rsrcFile)

			} else if operation == "copy" {
				err := fs.FileCopy(rsrcFile, rdestFile, existsOpr, func(progress int, currentFile string) {
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
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Validate the token
	tokenValid := CSRFTokenManager.HandleTokenValidation(w, r)
	if !tokenValid {
		http.Error(w, "Invalid CSRF token", 401)
		return
	}

	operation, _ := mv(r, "opr", true)
	vsrcFiles, _ := mv(r, "src", true)
	vdestFile, _ := mv(r, "dest", true)
	vnfilenames, _ := mv(r, "new", true) //Only use when rename or create new file / folder

	//Check if operation valid.
	if operation == "" {
		//Undefined operations.
		sendErrorResponse(w, "Undefined operations paramter: Missing 'opr' in request header.")
		return
	}

	//As the user can pass in multiple source files at the same time, parse sourceFiles from json string
	var sourceFiles []string
	//This line is required in order to allow passing of special charaters
	decodedSourceFiles := system_fs_specialURIDecode(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles), &sourceFiles)
	if err != nil {
		sendErrorResponse(w, "Source file JSON parse error.")
		return
	}

	//Check if new filenames are also valid. If yes, translate it into string array
	var newFilenames []string
	if vnfilenames != "" {
		vnfilenames, _ := url.QueryUnescape(vnfilenames)
		err = json.Unmarshal([]byte(vnfilenames), &newFilenames)
		if err != nil {
			sendErrorResponse(w, "Unable to parse JSON for new filenames")
			return
		}
	}

	if operation == "zip" {
		//Zip operation. Parse the real filepath list
		rsrcFiles := []string{}
		rdestFile, _ := userinfo.VirtualPathToRealPath(vdestFile)
		for _, vsrcFile := range sourceFiles {
			rsrcFile, _ := userinfo.VirtualPathToRealPath(string(vsrcFile))
			if fileExists(rsrcFile) {
				rsrcFiles = append(rsrcFiles, rsrcFile)
			}
		}

		zipFilename := rdestFile
		if fs.IsDir(rdestFile) {
			//Append the filename to it
			if len(rsrcFiles) == 1 {
				zipFilename = filepath.Join(rdestFile, strings.TrimSuffix(filepath.Base(rsrcFiles[0]), filepath.Ext(filepath.Base(rsrcFiles[0])))+".zip")
			} else if len(rsrcFiles) > 1 {
				zipFilename = filepath.Join(rdestFile, filepath.Base(filepath.Dir(rsrcFiles[0]))+".zip")
			}
		}

		//Create a zip file at target location
		err := fs.ArozZipFile(rsrcFiles, zipFilename, false)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
	} else {
		//For operations that is handled file by file
		for i, vsrcFile := range sourceFiles {
			//Convert the virtual path to realpath on disk
			rsrcFile, _ := userinfo.VirtualPathToRealPath(string(vsrcFile))
			rdestFile, _ := userinfo.VirtualPathToRealPath(vdestFile)
			//Check if the source file exists
			if !fileExists(rsrcFile) {
				/*
					Special edge case handler:

					There might be edge case that files are stored in URIEncoded methods
					e.g. abc def.mp3 --> abc%20cdf.mp3

					In this case, this logic statement should be able to handle this
				*/

				edgeCaseFilename := filepath.Join(filepath.Dir(rsrcFile), system_fs_specialURIEncode(filepath.Base(rsrcFile)))
				if fileExists(edgeCaseFilename) {
					rsrcFile = edgeCaseFilename
				} else {
					sendErrorResponse(w, "Source file not exists")
					return
				}

			}

			if operation == "rename" {
				//Check if the usage is correct.
				if vdestFile != "" {
					sendErrorResponse(w, "Rename only accept 'src' and 'new'. Please use move if you want to move a file.")
					return
				}
				//Check if new name paramter is passed in.
				if len(newFilenames) == 0 {
					sendErrorResponse(w, "Missing paramter (JSON string): 'new'")
					return
				}
				//Check if the source filenames and new filenanmes match
				if len(newFilenames) != len(sourceFiles) {
					sendErrorResponse(w, "New filenames do not match with source filename's length.")
					return
				}

				//Check if the target dir is not readonly
				accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
				if accmode == "readonly" {
					sendErrorResponse(w, "This directory is Read Only")
					return
				} else if accmode == "denied" {
					sendErrorResponse(w, "Access Denied")
					return
				}

				thisFilename := newFilenames[i]
				//Check if the name already exists. If yes, return false
				if fileExists(filepath.Dir(rsrcFile) + "/" + thisFilename) {
					sendErrorResponse(w, "File already exists")
					return
				}

				//Everything is ok. Rename the file.
				targetNewName := filepath.Dir(rsrcFile) + "/" + thisFilename
				err = os.Rename(rsrcFile, targetNewName)
				if err != nil {
					sendErrorResponse(w, err.Error())
					return
				}

				//Remove the cache for the original file
				metadata.RemoveCache(rsrcFile)

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

				if !fileExists(rsrcFile) {
					sendErrorResponse(w, "Source file not exists")
					return
				}

				//Check if the source file is read only.
				accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
				if accmode == "readonly" {
					sendErrorResponse(w, "This source file is Read Only")
					return
				} else if accmode == "denied" {
					sendErrorResponse(w, "Access Denied")
					return
				}

				if rdestFile == "" {
					sendErrorResponse(w, "Undefined dest location")
					return
				}

				//Get exists overwrite mode
				existsOpr, _ := mv(r, "existsresp", true)

				//Check if use fast move instead
				//Check if the source and destination folder are under the same root. If yes, use os.Rename for faster move operations

				//Check if the two files are under the same user root path

				srcAbs, _ := filepath.Abs(rsrcFile)
				destAbs, _ := filepath.Abs(rdestFile)

				//Check other storage path and see if they are under the same root
				/*
					for _, rootPath := range userinfo.GetAllFileSystemHandler() {
						thisRoot := rootPath.Path
						thisRootAbs, err := filepath.Abs(thisRoot)
						if err != nil {
							continue
						}
						if strings.Contains(srcAbs, thisRootAbs) && strings.Contains(destAbs, thisRootAbs) {
							underSameRoot = true
						}
					}*/

				underSameRoot, _ := fs.UnderTheSameRoot(srcAbs, destAbs)

				//Updates 19-10-2020: Added ownership management to file move and copy
				userinfo.RemoveOwnershipFromFile(rsrcFile)

				err = fs.FileMove(rsrcFile, rdestFile, existsOpr, underSameRoot, nil)
				if err != nil {
					sendErrorResponse(w, err.Error())
					//Restore the ownership if remove failed
					userinfo.SetOwnerOfFile(rsrcFile)
					return
				}

				//Set user to own the new file
				userinfo.SetOwnerOfFile(filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile))

				//Remove cache for the original file
				metadata.RemoveCache(rsrcFile)
			} else if operation == "copy" {
				//Copy file. See move example and change 'opr' to 'copy'
				if !fileExists(rsrcFile) {
					sendErrorResponse(w, "Source file not exists")
					return
				}

				//Check if the desintation is read only.
				if !userinfo.CanWrite(vdestFile) {
					sendErrorResponse(w, "Access Denied")
					return
				}

				if !fileExists(rdestFile) {
					if fileExists(filepath.Dir(rdestFile)) {
						//User pass in the whole path for the folder. Report error usecase.
						sendErrorResponse(w, "Dest location should be an existing folder instead of the full path of the copied file")
						return
					}
					sendErrorResponse(w, "Dest folder not found")
					return
				}

				existsOpr, _ := mv(r, "existsresp", true)

				//Check if the user have space for the extra file
				if !userinfo.StorageQuota.HaveSpace(fs.GetFileSize(rdestFile)) {
					sendErrorResponse(w, "Storage Quota Full")
					return
				}

				err = fs.FileCopy(rsrcFile, rdestFile, existsOpr, nil)
				if err != nil {
					sendErrorResponse(w, err.Error())
					return
				}

				//Set user to own this file
				userinfo.SetOwnerOfFile(filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile))

			} else if operation == "delete" {
				//Delete the file permanently
				if !fileExists(rsrcFile) {
					//Check if it is a non escapted file instead
					sendErrorResponse(w, "Source file not exists")
					return

				}

				if !userinfo.CanWrite(vsrcFile) {
					sendErrorResponse(w, "Access Denied")
					return
				}

				//Check if the user own this file
				isOwner := userinfo.IsOwnerOfFile(rsrcFile)
				if isOwner {
					//This user own this system. Remove this file from his quota
					userinfo.RemoveOwnershipFromFile(rsrcFile)
				}

				//Check if this file has any cached files. If yes, remove it
				metadata.RemoveCache(rsrcFile)

				//Clear the cache folder if there is no files inside
				fc, _ := filepath.Glob(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/*")
				if len(fc) == 0 {
					os.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/")
				}

				os.RemoveAll(rsrcFile)

			} else if operation == "recycle" {
				//Put it into a subfolder named trash and allow it to to be removed later
				if !fileExists(rsrcFile) {
					//Check if it is a non escapted file instead
					sendErrorResponse(w, "Source file not exists")
					return

				}

				//Check if the upload target is read only.
				//Updates 20 Jan 2021: Replace with CanWrite handler
				/*
					accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
					if accmode == "readonly" {
						sendErrorResponse(w, "This directory is Read Only.")
						return
					} else if accmode == "denied" {
						sendErrorResponse(w, "Access Denied")
						return
					}*/
				if !userinfo.CanWrite(vsrcFile) {
					sendErrorResponse(w, "Access Denied")
					return
				}

				//Check if this file has any cached files. If yes, remove it
				metadata.RemoveCache(rsrcFile)

				//Clear the cache folder if there is no files inside
				fc, _ := filepath.Glob(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/*")
				if len(fc) == 0 {
					os.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/")
				}

				//Create a trash directory for this folder
				trashDir := filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.trash/"
				os.MkdirAll(trashDir, 0755)
				hidden.HideFile(trashDir)
				os.Rename(rsrcFile, trashDir+filepath.Base(rsrcFile)+"."+Int64ToString(GetUnixTime()))
			} else if operation == "unzip" {
				//Unzip the file to destination

				//Check if the user can write to the target dest file
				if userinfo.CanWrite(string(vdestFile)) == false {
					sendErrorResponse(w, "Access Denied")
					return
				}

				//Make the rdest directory if not exists
				if !fileExists(rdestFile) {
					err = os.MkdirAll(rdestFile, 0755)
					if err != nil {
						sendErrorResponse(w, err.Error())
						return
					}
				}

				//OK! Unzip to destination
				err := fs.Unzip(rsrcFile, rdestFile)
				if err != nil {
					sendErrorResponse(w, err.Error())
					return
				}

			} else {
				sendErrorResponse(w, "Unknown file opeartion given")
				return
			}
		}

	}
	sendJSONResponse(w, "\"OK\"")
	return
}

//Allow systems to store key value pairs in the database as preferences.
func system_fs_handleUserPreference(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	key, _ := mv(r, "key", false)
	value, _ := mv(r, "value", false)
	remove, _ := mv(r, "remove", false)

	if key != "" && value == "" && remove == "" {
		//Get mode. Read the prefernece with given key
		result := ""
		err := sysdb.Read("fs", "pref/"+key+"/"+username, &result)
		if err != nil {
			sendJSONResponse(w, "{\"error\":\"Key not found.\"}")
			return
		}
		sendTextResponse(w, result)
	} else if key != "" && value == "" && remove == "true" {
		//Remove mode. Delete this key from sysdb
		err := sysdb.Delete("fs", "pref/"+key+"/"+username)
		if err != nil {
			sendErrorResponse(w, err.Error())
		}

		sendOK(w)
	} else if key != "" && value != "" {
		//Set mode. Set the preference with given key
		if len(value) > 1024 {
			//Size too big. Reject storage
			sendErrorResponse(w, "Preference value too long. Preference value can only store maximum 1024 characters.")
			return
		}
		sysdb.Write("fs", "pref/"+key+"/"+username, value)
		sendOK(w)
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
		sendErrorResponse(w, "User not logged in")
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
	sendJSONResponse(w, string(jsonString))
}

func system_fs_listRoot(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	username := userinfo.Username
	userRoot, _ := mv(r, "user", false)
	if userRoot == "true" {
		type fileObject struct {
			Filename string
			Filepath string
			IsDir    bool
		}
		//List the root media folders under user:/
		filesInUserRoot := []fileObject{}
		filesInRoot, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(*root_directory)) + "/users/" + username + "/*")
		for _, file := range filesInRoot {
			thisFile := new(fileObject)
			thisFile.Filename = filepath.Base(file)
			thisFile.Filepath, _ = userinfo.RealPathToVirtualPath(file)
			thisFile.IsDir = IsDir(file)
			filesInUserRoot = append(filesInUserRoot, *thisFile)
		}
		jsonString, _ := json.Marshal(filesInUserRoot)
		sendJSONResponse(w, string(jsonString))
	} else {
		type rootObject struct {
			rootID      string //The vroot id
			RootName    string //The name of this vroot
			RootPath    string //The path of this vroot
			RootBackups bool   //If there are backup for this vroot
		}

		roots := []*rootObject{}
		backupRoots := []string{}
		for _, store := range userinfo.GetAllFileSystemHandler() {
			if store.Hierarchy == "user" || store.Hierarchy == "public" {
				//Normal drives
				var thisDevice = new(rootObject)
				thisDevice.RootName = store.Name
				thisDevice.RootPath = store.UUID + ":/"
				thisDevice.rootID = store.UUID
				roots = append(roots, thisDevice)
			} else if store.Hierarchy == "backup" {
				//Backup drive.
				backupRoots = append(backupRoots, store.HierarchyConfig.(hybridBackup.BackupTask).ParentUID)
			} else if store.Hierarchy == "share" {
				//Share emulated drive
				var thisDevice = new(rootObject)
				thisDevice.RootName = store.Name
				thisDevice.RootPath = store.UUID + ":/"
				thisDevice.rootID = store.UUID
				roots = append(roots, thisDevice)
			}
		}

		//Update root configs for backup roots
		for _, backupRoot := range backupRoots {
			//For this backup root, check if the parent root mounted
			for _, root := range roots {
				if root.rootID == backupRoot {
					//Parent root mounted. Label the parent root as "have backup"
					root.RootBackups = true
				}
			}
		}

		jsonString, _ := json.Marshal(roots)
		sendJSONResponse(w, string(jsonString))
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
		sendErrorResponse(w, err.Error())
		return
	}

	vpath, err := mv(r, "path", true)
	if err != nil {
		sendErrorResponse(w, "path not defined")
		return
	}

	vrootID, subpath, _ := filesystem.GetIDFromVirtualPath(vpath)
	if vrootID == "share" && subpath == "" {
		result = fileProperties{
			VirtualPath:    vpath,
			StoragePath:    "(Emulated File System)",
			Basename:       "Share",
			VirtualDirname: filepath.ToSlash(filepath.Dir(vpath)),
			StorageDirname: "N/A",
			Ext:            "N/A",
			MimeType:       "emulated/fs",
			Filesize:       -1,
			Permission:     "N/A",
			LastModTime:    "N/A",
			LastModUnix:    0,
			IsDirectory:    true,
			Owner:          "system",
		}
	} else {
		rpath, err := userinfo.VirtualPathToRealPath(vpath)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		fileStat, err := os.Stat(rpath)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		mime := "text/directory"
		if !fileStat.IsDir() {
			m, _, err := fs.GetMime(rpath)
			if err != nil {
				mime = ""
			}
			mime = m
		}

		filesize := fileStat.Size()
		//Get file overall size if this is folder
		if fileStat.IsDir() {
			var size int64
			filepath.Walk(rpath, func(_ string, info os.FileInfo, err error) error {
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
		owner := userinfo.GetFileOwner(rpath)

		if owner == "" {
			//Handle special virtual roots
			vrootID, subpath, _ := filesystem.GetIDFromVirtualPath(vpath)
			if vrootID == "share" {
				//Share objects
				shareOption, _ := shareEntryTable.ResolveShareOptionFromShareSubpath(subpath)
				if shareOption != nil {
					owner = shareOption.Owner
				} else {
					owner = "Unknown"
				}
			} else {
				owner = "Unknown"
			}

		}

		result = fileProperties{
			VirtualPath:    vpath,
			StoragePath:    filepath.Clean(rpath),
			Basename:       filepath.Base(rpath),
			VirtualDirname: filepath.ToSlash(filepath.Dir(vpath)),
			StorageDirname: filepath.ToSlash(filepath.Dir(rpath)),
			Ext:            filepath.Ext(rpath),
			MimeType:       mime,
			Filesize:       filesize,
			Permission:     fileStat.Mode().Perm().String(),
			LastModTime:    timeToString(fileStat.ModTime()),
			LastModUnix:    fileStat.ModTime().Unix(),
			IsDirectory:    fileStat.IsDir(),
			Owner:          owner,
		}

	}

	jsonString, _ := json.Marshal(result)
	sendJSONResponse(w, string(jsonString))

}

/*
	List directory in the given path

	Usage: Pass in dir like the following examples:
	AOR:/Desktop	<= Open /user/{username}/Desktop
	S1:/			<= Open {uuid=S1}/


*/

func system_fs_handleList(w http.ResponseWriter, r *http.Request) {
	currentDir, _ := mv(r, "dir", true)
	//Commented this line to handle dirname that contains "+" sign
	//currentDir, _ = url.QueryUnescape(currentDir)
	sortMode, _ := mv(r, "sort", true)
	showHidden, _ := mv(r, "showHidden", true)
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//user not logged in. Redirect to login page.
		sendErrorResponse(w, "User not logged in")
		return
	}

	if currentDir == "" {
		sendErrorResponse(w, "Invalid dir given.")
		return
	}

	//Pad a slash at the end of currentDir if not exists
	if currentDir[len(currentDir)-1:] != "/" {
		currentDir = currentDir + "/"
	}

	VirtualRootID, subpath, err := fs.GetIDFromVirtualPath(currentDir)
	if err != nil {
		sendErrorResponse(w, "Unable to resolve requested path: "+err.Error())
		return
	}

	var parsedFilelist []fs.FileData
	var realpath string = ""
	//Handle some special virtual file systems / mount points
	if VirtualRootID == "share" && subpath == "" {
		userpgs := userinfo.GetUserPermissionGroupNames()
		files := shareEntryTable.ListRootForUser(userinfo.Username, userpgs)
		parsedFilelist = files
	} else {
		//Normal file systems

		//Convert the virutal path to realpath
		realpath, err = userinfo.VirtualPathToRealPath(currentDir)

		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		if !fileExists(realpath) {
			userRoot, _ := userinfo.VirtualPathToRealPath("user:/")
			if filepath.Clean(realpath) == filepath.Clean(userRoot) {
				//Initiate user folder (Initiaed in user object)
				userinfo.GetHomeDirectory()
			} else if !strings.Contains(filepath.ToSlash(filepath.Clean(currentDir)), "/") {
				//User root not created. Create the root folder
				os.MkdirAll(filepath.Clean(realpath), 0775)
			} else {
				//Folder not exists
				log.Println("[File Explorer] Requested path: ", realpath, " does not exists!")
				sendErrorResponse(w, "Folder not exists")
				return
			}

		}
		if sortMode == "" {
			sortMode = "default"
		}

		//Check for really special exception in where the path contains [ or ] which cannot be handled via Golang Glob function
		files, _ := system_fs_specialGlob(filepath.Clean(realpath) + "/*")
		var shortCutInfo *shortcut.ShortcutData = nil
		for _, v := range files {
			//Check if it is hidden file
			isHidden, _ := hidden.IsHidden(v, false)
			if showHidden != "true" && isHidden {
				//Skipping hidden files
				continue
			}

			//Check if this is an aodb file
			if filepath.Base(v) == "aofs.db" || filepath.Base(v) == "aofs.db.lock" {
				//Database file (reserved)
				continue
			}

			//Check if it is shortcut file. If yes, render a shortcut data struct
			if filepath.Ext(v) == ".shortcut" {
				//This is a shortcut file
				shorcutData, err := shortcut.ReadShortcut(v)
				if err == nil {
					shortCutInfo = shorcutData
				}
			}

			rawsize := fs.GetFileSize(v)
			modtime, _ := fs.GetModTime(v)
			thisFile := fs.FileData{
				Filename:    filepath.Base(v),
				Filepath:    currentDir + filepath.Base(v),
				Realpath:    v,
				IsDir:       IsDir(v),
				Filesize:    rawsize,
				Displaysize: fs.GetFileDisplaySize(rawsize, 2),
				ModTime:     modtime,
				IsShared:    shareManager.FileIsShared(v),
				Shortcut:    shortCutInfo,
			}

			parsedFilelist = append(parsedFilelist, thisFile)
		}
	}

	//Sort the filelist
	if sortMode == "default" {
		//Sort by name, convert filename to window sorting methods
		sort.Slice(parsedFilelist, func(i, j int) bool {
			return strings.ToLower(parsedFilelist[i].Filename) < strings.ToLower(parsedFilelist[j].Filename)
		})
	} else if sortMode == "reverse" {
		//Sort by reverse name
		sort.Slice(parsedFilelist, func(i, j int) bool {
			return strings.ToLower(parsedFilelist[i].Filename) > strings.ToLower(parsedFilelist[j].Filename)
		})
	} else if sortMode == "smallToLarge" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize < parsedFilelist[j].Filesize })
	} else if sortMode == "largeToSmall" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize > parsedFilelist[j].Filesize })
	} else if sortMode == "mostRecent" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].ModTime > parsedFilelist[j].ModTime })
	} else if sortMode == "leastRecent" {
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].ModTime < parsedFilelist[j].ModTime })
	}

	jsonString, _ := json.Marshal(parsedFilelist)
	sendJSONResponse(w, string(jsonString))

}

//Handle getting a hash from a given contents in the given path
func system_fs_handleDirHash(w http.ResponseWriter, r *http.Request) {
	currentDir, err := mv(r, "dir", true)
	if err != nil {
		sendErrorResponse(w, "Invalid dir given")
		return
	}

	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	VirtualRootID, subpath, _ := fs.GetIDFromVirtualPath(currentDir)
	if VirtualRootID == "share" && subpath == "" {
		sendTextResponse(w, hex.EncodeToString([]byte("0")))
		return
	}

	rpath, err := userinfo.VirtualPathToRealPath(currentDir)
	if err != nil {
		sendErrorResponse(w, "Invalid dir given")
		return
	}

	//Get a list of files in this directory
	currentDir = filepath.ToSlash(filepath.Clean(rpath)) + "/"
	filesInDir, err := system_fs_specialGlob(currentDir + "*")
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	filenames := []string{}
	for _, file := range filesInDir {
		if len(filepath.Base(file)) > 0 && string([]rune(filepath.Base(file))[0]) != "." {
			//Ignore hidden files
			filenames = append(filenames, filepath.Base(file))
		}

	}

	sort.Strings(filenames)

	//Build a hash base on the filelist
	h := sha256.New()
	h.Write([]byte(strings.Join(filenames, ",")))
	sendTextResponse(w, hex.EncodeToString((h.Sum(nil))))
}

/*
	File zipping and unzipping functions
*/

//Handle all zip related API
func system_fs_zipHandler(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	opr, err := mv(r, "opr", true)
	if err != nil {
		sendErrorResponse(w, "Invalid opr or opr not defined")
		return
	}

	vsrc, _ := mv(r, "src", true)
	if vsrc == "" {
		sendErrorResponse(w, "Invalid src paramter")
		return
	}

	vdest, _ := mv(r, "dest", true)
	rdest := ""

	//Convert source path from JSON string to object
	virtualSourcePaths := []string{}
	err = json.Unmarshal([]byte(vsrc), &virtualSourcePaths)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Check each of the path
	realSourcePaths := []string{}
	for _, vpath := range virtualSourcePaths {
		thisrpath, err := userinfo.VirtualPathToRealPath(vpath)
		if err != nil || !fileExists(thisrpath) {
			sendErrorResponse(w, "File not exists: "+vpath)
			return
		}
		realSourcePaths = append(realSourcePaths, thisrpath)
	}

	///Convert dest to real if given
	if vdest != "" {
		realdest, _ := userinfo.VirtualPathToRealPath(vdest)
		rdest = realdest
	}

	//This function will be deprecate soon in ArozOS 1.120
	log.Println("*DEPRECATE* zipHandler will be deprecating soon! Please use fileOpr endpoint")

	if opr == "zip" {
		//Check if destination location exists
		if rdest == "" || !fileExists(filepath.Dir(rdest)) {
			sendErrorResponse(w, "Invalid dest location")
			return
		}

		//OK. Create the zip at the desired location
		err := fs.ArozZipFile(realSourcePaths, rdest, false)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		sendOK(w)
	} else if opr == "tmpzip" {
		//Zip to tmp folder
		userTmpFolder, _ := userinfo.VirtualPathToRealPath("tmp:/")
		filename := Int64ToString(GetUnixTime()) + ".zip"
		rdest := filepath.ToSlash(filepath.Clean(userTmpFolder)) + "/" + filename

		log.Println(realSourcePaths, rdest)
		err := fs.ArozZipFile(realSourcePaths, rdest, false)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Send the tmp filename to the user
		sendTextResponse(w, "tmp:/"+filename)

	} else if opr == "inspect" {

	} else if opr == "unzip" {

	}

}

//Translate path from and to virtual and realpath
func system_fs_handlePathTranslate(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	path, err := mv(r, "path", false)
	if err != nil {
		sendErrorResponse(w, "Invalid path given")
		return
	}
	rpath, err := userinfo.VirtualPathToRealPath(path)
	if err != nil {
		//Try to convert it to virtualPath
		vpath, err := userinfo.RealPathToVirtualPath(path)
		if err != nil {
			sendErrorResponse(w, "Unknown path given")
		} else {
			jsonstring, _ := json.Marshal(vpath)
			sendJSONResponse(w, string(jsonstring))
		}
	} else {
		abrpath, _ := filepath.Abs(rpath)
		jsonstring, _ := json.Marshal([]string{rpath, filepath.ToSlash(abrpath)})
		sendJSONResponse(w, string(jsonstring))
	}

}

//Handle cache rendering with websocket pipeline
func system_fs_handleCacheRender(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vpath, err := mv(r, "folder", false)
	if err != nil {
		sendErrorResponse(w, "Invalid folder paramter")
		return
	}

	//Convert vpath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get folder sort mode
	sortMode := "default"
	folder := filepath.ToSlash(filepath.Clean(vpath))
	if sysdb.KeyExists("fs-sortpref", userinfo.Username+"/"+folder) {
		sysdb.Read("fs-sortpref", userinfo.Username+"/"+folder, &sortMode)
	}

	//Perform cache rendering
	thumbRenderHandler.HandleLoadCache(w, r, rpath, sortMode)
}

//Handle loading of one thumbnail
func system_fs_handleThumbnailLoad(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vpath, err := mv(r, "vpath", false)
	if err != nil {
		sendErrorResponse(w, "vpath not defined")
		return
	}

	rpath, err := userinfo.VirtualPathToRealPath(vpath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	byteMode, _ := mv(r, "bytes", false)
	if byteMode == "true" {
		thumbnailBytes, err := thumbRenderHandler.LoadCacheAsBytes(rpath, false)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
		filetype := http.DetectContentType(thumbnailBytes)
		w.Header().Add("Content-Type", filetype)
		w.Write(thumbnailBytes)
	} else {
		thumbnailPath, err := thumbRenderHandler.LoadCache(rpath, false)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		js, _ := json.Marshal(thumbnailPath)
		sendJSONResponse(w, string(js))
	}
}

//Handle file thumbnail caching
func system_fs_handleFolderCache(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	vfolderpath, err := mv(r, "folder", false)
	if err != nil {
		sendErrorResponse(w, "folder not defined")
		return
	}

	rpath, err := userinfo.VirtualPathToRealPath(vfolderpath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	thumbRenderHandler.BuildCacheForFolder(rpath)
	sendOK(w)
}

//Handle the get and set of sort mode of a particular folder
func system_fs_handleFolderSortModePreference(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	folder, err := mv(r, "folder", true)
	if err != nil {
		sendErrorResponse(w, "Invalid folder given")
		return
	}

	opr, _ := mv(r, "opr", true)

	folder = filepath.ToSlash(filepath.Clean(folder))

	if opr == "" || opr == "get" {
		sortMode := "default"
		if sysdb.KeyExists("fs-sortpref", userinfo.Username+"/"+folder) {
			sysdb.Read("fs-sortpref", userinfo.Username+"/"+folder, &sortMode)
		}

		js, err := json.Marshal(sortMode)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
		sendJSONResponse(w, string(js))
	} else if opr == "set" {
		sortMode, err := mv(r, "mode", true)
		if err != nil {
			sendErrorResponse(w, "Invalid sort mode given")
			return
		}

		if !stringInSlice(sortMode, []string{"default", "reverse", "smallToLarge", "largeToSmall", "mostRecent", "leastRecent"}) {
			sendErrorResponse(w, "Not supported sort mode: "+sortMode)
			return
		}

		sysdb.Write("fs-sortpref", userinfo.Username+"/"+folder, sortMode)
		sendOK(w)
	} else {
		sendErrorResponse(w, "Invalid opr mode")
		return
	}
}

//Handle setting and loading of file permission on Linux
func system_fs_handleFilePermission(w http.ResponseWriter, r *http.Request) {
	file, err := mv(r, "file", true)
	if err != nil {
		sendErrorResponse(w, "Invalid file")
		return
	}

	//Translate the file to real path
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	rpath, err := userinfo.VirtualPathToRealPath(file)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	newMode, _ := mv(r, "mode", true)
	if newMode == "" {
		//Read the file mode

		//Check if the file exists
		if !fileExists(rpath) {
			sendErrorResponse(w, "File not exists!")
			return
		}

		//Read the file permission
		filePermission, err := fsp.GetFilePermissions(rpath)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Send the file permission to client
		js, _ := json.Marshal(filePermission)
		sendJSONResponse(w, string(js))
	} else {
		//Set the file mode
		//Check if the file exists
		if !fileExists(rpath) {
			sendErrorResponse(w, "File not exists!")
			return
		}

		//Check if windows. If yes, ignore this request
		if runtime.GOOS == "windows" {
			sendErrorResponse(w, "Windows host not supported")
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
				sendErrorResponse(w, "Permission Denied")
				return
			}
		} else {
			//Not implemeneted. Require admin
			if userinfo.IsAdmin() == false {
				sendErrorResponse(w, "Permission Denied")
				return
			}
		}

		//Be noted that if the system is not running in sudo mode,
		//File permission change might not works.

		err := fsp.SetFilePermisson(rpath, newMode)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		} else {
			sendOK(w)
		}
	}
}

//Check if the given filepath is and must inside the given directory path.
//You can pass both as relative
func system_fs_checkFileInDirectory(filesourcepath string, directory string) bool {
	filepathAbs, err := filepath.Abs(filesourcepath)
	if err != nil {
		return false
	}

	directoryAbs, err := filepath.Abs(directory)
	if err != nil {
		return false
	}

	//Check if the filepathabs contain directoryAbs
	if strings.Contains(filepathAbs, directoryAbs) {
		return true
	} else {
		return false
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
			modTime, err := fs.GetModTime(path)
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
