package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/ioutil"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	fs "imuslab.com/arozos/mod/filesystem"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	storage "imuslab.com/arozos/mod/storage"
	user "imuslab.com/arozos/mod/user"
)

var (
	thumbRenderHandler *metadata.RenderHandler
)

func FileSystemInit() {
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "File Manager",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	router.HandleFunc("/system/file_system/validateFileOpr", system_fs_validateFileOpr)
	router.HandleFunc("/system/file_system/fileOpr", system_fs_handleOpr)
	router.HandleFunc("/system/file_system/listDir", system_fs_handleList)
	router.HandleFunc("/system/file_system/listDirHash", system_fs_handleDirHash)
	router.HandleFunc("/system/file_system/listRoots", system_fs_listRoot)
	router.HandleFunc("/system/file_system/listDrives", system_fs_listDrives)
	router.HandleFunc("/system/file_system/newItem", system_fs_handleNewObjects)
	router.HandleFunc("/system/file_system/preference", system_fs_handleUserPreference)
	router.HandleFunc("/system/file_system/upload", system_fs_handleUpload)
	router.HandleFunc("/system/file_system/listTrash", system_fs_scanTrashBin)
	router.HandleFunc("/system/file_system/clearTrash", system_fs_clearTrashBin)
	router.HandleFunc("/system/file_system/restoreTrash", system_fs_restoreFile)
	router.HandleFunc("/system/file_system/zipHandler", system_fs_zipHandler)
	router.HandleFunc("/system/file_system/getProperties", system_fs_getFileProperties)
	router.HandleFunc("/system/file_system/pathTranslate", system_fs_handlePathTranslate)
	router.HandleFunc("/system/file_system/handleFileWrite", system_fs_handleFileWrite)
	router.HandleFunc("/system/file_system/handleFolderCache", system_fs_handleFolderCache)
	router.HandleFunc("/system/file_system/handleCacheRender", system_fs_handleCacheRender)

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
		InitFWSize:   []int{1080, 580},
		LaunchFWDir:  "SystemAO/file_system/trashbin.html",
		SupportEmb:   false,
		SupportedExt: []string{"*"},
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

	//Create a RenderHandler for caching thumbnails
	thumbRenderHandler = metadata.NewRenderHandler()
}

//Handle upload.
func system_fs_handleUpload(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	username := userinfo.Username

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
		sendErrorResponse(w, "File too large")
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		log.Println("Error Retrieving File from upload by user: " + username)
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
	destFilepath := filepath.ToSlash(filepath.Clean(realUploadPath)) + "/" + storeFilename

	if !fileExists(filepath.Dir(destFilepath)) {
		os.MkdirAll(filepath.Dir(destFilepath), 0755)
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
		sendErrorResponse(w, "Storage Quota Full")
		return
	}

	//Prepare the file to be created (uploaded)
	destination, err := os.Create(destFilepath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Move the file to destination file location
	go func(r *http.Request, file multipart.File, destination *os.File, userinfo *user.User) {
		//Do the file copying using a buffered reader
		buf := make([]byte, 8192)
		for {
			n, err := file.Read(buf)
			if err != nil && err != io.EOF {
				log.Println(err.Error())
				destination.Close()
				file.Close()
				return
			}
			if n == 0 {
				break
			}

			if _, err := destination.Write(buf[:n]); err != nil {
				log.Println(err.Error())
				destination.Close()
				file.Close()
				return
			}
		}

		destination.Close()
		file.Close()

		//Clear up buffered files
		r.MultipartForm.RemoveAll()

		//Set the ownership of file
		userinfo.SetOwnerOfFile(destFilepath)

	}(r, file, destination, userinfo)

	//Finish up the upload

	//fmt.Printf("Uploaded File: %+v\n", handler.Filename)
	//fmt.Printf("File Size: %+v\n", handler.Size)
	//fmt.Printf("MIME Header: %+v\n", handler.Header)
	//fmt.Println("Upload target: " + realUploadPath)

	//Fnish upload. Fix the tmp filename
	log.Println(username + " uploaded a file: " + handler.Filename)

	//Do upload finishing stuff

	//Completed
	sendOK(w)
	return
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
	var duplicateFiles []string

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
		if fileExists(rdestFile + filepath.Base(rsrcFile)) {
			//File exists already.
			vpath, _ := userinfo.RealPathToVirtualPath(rsrcFile)
			duplicateFiles = append(duplicateFiles, vpath)
		}

	}

	jsonString, _ := json.Marshal(duplicateFiles)
	sendJSONResponse(w, string(jsonString))
	return
}

//Scan all the directory and get trash files within the system
func system_fs_scanTrashBin(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	username := userinfo.Username
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
		storageRoot := storage.Path
		scanningRoots = append(scanningRoots, storageRoot)
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
			log.Fatal("Unable to parse JSON string for new item list!")
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
			sendErrorResponse(w, "Invalid path given.")
			return
		}

		//Check if directory is readonly
		accmode := userinfo.GetPathAccessPermission(vsrc)
		if accmode == "readonly" {
			sendErrorResponse(w, "This directory is Read Only.")
			return
		} else if accmode == "denied" {
			sendErrorResponse(w, "Access Denied")
			return
		}
		//Check if the file already exists. If yes, fix its filename.
		newfilePath := rpath + filename

		if fileType == "file" {
			for fileExists(newfilePath) {
				sendErrorResponse(w, "Given filename already exists.")
				return
			}
			ext := filepath.Ext(filename)

			if ext == "" {
				//This is a file with no extension.
				f, err := os.Create(newfilePath)
				if err != nil {
					log.Fatal(err)
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
						log.Fatal(err)
						sendErrorResponse(w, err.Error())
						return
					}
					f.Close()
				} else {
					//Copy file from templateFile[0] to current dir with the given name
					input, _ := ioutil.ReadFile(templateFile[0])
					err := ioutil.WriteFile(newfilePath, input, 0755)
					if err != nil {
						log.Fatal(err)
						sendErrorResponse(w, err.Error())
						return
					}
				}
			}

		} else if fileType == "folder" {
			if fileExists(newfilePath) {
				sendErrorResponse(w, "Given folder already exists.")
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
	Handle file operations

	Support {move, copy, delete, recycle, rename}
*/
//Handle file operations.
func system_fs_handleOpr(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
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

	for i, vsrcFile := range sourceFiles {
		//Convert the virtual path to realpath on disk
		rsrcFile, _ := userinfo.VirtualPathToRealPath(string(vsrcFile))
		rdestFile, _ := userinfo.VirtualPathToRealPath(vdestFile)
		//Check if the source file exists
		if !fileExists(rsrcFile) {
			sendErrorResponse(w, "Source file not exists.")
			return
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
				sendErrorResponse(w, "This directory is Read Only.")
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
				sendErrorResponse(w, "This source file is Read Only.")
				return
			} else if accmode == "denied" {
				sendErrorResponse(w, "Access Denied")
				return
			}

			if rdestFile == "" {
				sendErrorResponse(w, "Undefined dest location.")
				return
			}

			//Get exists overwrite mode
			existsOpr, _ := mv(r, "existsresp", true)

			//Check if use fast move instead
			//Check if the source and destination folder are under the same root. If yes, use os.Rename for faster move operations

			underSameRoot := false
			//Check if the two files are under the same user root path

			srcAbs, _ := filepath.Abs(rsrcFile)
			destAbs, _ := filepath.Abs(rdestFile)

			//Check other storage path and see if they are under the same root
			for _, rootPath := range userinfo.GetAllFileSystemHandler() {
				thisRoot := rootPath.Path
				thisRootAbs, err := filepath.Abs(thisRoot)
				if err != nil {
					continue
				}
				if strings.Contains(srcAbs, thisRootAbs) && strings.Contains(destAbs, thisRootAbs) {
					underSameRoot = true
				}
			}

			//Updates 19-10-2020: Added ownership management to file move and copy
			userinfo.RemoveOwnershipFromFile(rsrcFile)

			err = fs.FileMove(rsrcFile, rdestFile, existsOpr, underSameRoot)
			if err != nil {
				sendErrorResponse(w, err.Error())
				//Restore the ownership if remove failed
				userinfo.SetOwnerOfFile(rsrcFile)
				return
			}

			//Set user to own the new file
			userinfo.SetOwnerOfFile(filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile))

		} else if operation == "copy" {
			//Copy file. See move example and change 'opr' to 'copy'
			if !fileExists(rsrcFile) {
				sendErrorResponse(w, "Source file not exists")
				return
			}

			//Check if the desintation is read only.
			accmode := userinfo.GetPathAccessPermission(vdestFile)
			if accmode == "readonly" {
				sendErrorResponse(w, "This directory is Read Only.")
				return
			} else if accmode == "denied" {
				sendErrorResponse(w, "Access Denied")
				return
			}

			if !fileExists(rdestFile) {
				if fileExists(filepath.Dir(rdestFile)) {
					//User pass in the whole path for the folder. Report error usecase.
					sendErrorResponse(w, "Dest location should be an existing folder instead of the full path of the copied file.")
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

			err = fs.FileCopy(rsrcFile, rdestFile, existsOpr)
			if err != nil {
				sendErrorResponse(w, err.Error())
				return
			}

			//Set user to own this file
			userinfo.SetOwnerOfFile(filepath.ToSlash(filepath.Clean(rdestFile)) + "/" + filepath.Base(rsrcFile))

		} else if operation == "delete" {
			//Delete the file permanently
			if !fileExists(rsrcFile) {
				sendErrorResponse(w, "Source file not exists")
				return
			}

			//Check if the desintation is read only.
			accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
			if accmode == "readonly" {
				sendErrorResponse(w, "This directory is Read Only.")
				return
			} else if accmode == "denied" {
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
			if fileExists(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/" + filepath.Base(rsrcFile) + ".jpg") {
				os.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/" + filepath.Base(rsrcFile) + ".jpg")
			}

			os.RemoveAll(rsrcFile)

		} else if operation == "recycle" {
			//Put it into a subfolder named trash and allow it to to be removed later
			if !fileExists(rsrcFile) {
				sendErrorResponse(w, "Source file not exists.")
				return
			}

			//Check if the upload target is read only.
			accmode := userinfo.GetPathAccessPermission(string(vsrcFile))
			if accmode == "readonly" {
				sendErrorResponse(w, "This directory is Read Only.")
				return
			} else if accmode == "denied" {
				sendErrorResponse(w, "Access Denied")
				return
			}
			//Check if this file has any cached files. If yes, remove it
			if fileExists(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/" + filepath.Base(rsrcFile) + ".jpg") {
				os.Remove(filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.cache/" + filepath.Base(rsrcFile) + ".jpg")
			}

			//Create a trash directory for this folder
			trashDir := filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.trash/"
			os.MkdirAll(trashDir, 0755)
			hidden.HideFile(trashDir)
			os.Rename(rsrcFile, trashDir+filepath.Base(rsrcFile)+"."+Int64ToString(GetUnixTime()))
		} else {
			sendErrorResponse(w, "Unknown file opeartion given.")
			return
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
	if key != "" && value == "" {
		//Get mode. Read the prefernece with given key
		result := ""
		err := sysdb.Read("fs", "pref/"+key+"/"+username, &result)
		if err != nil {
			sendJSONResponse(w, "{\"error\":\"Key not found.\"}")
			return
		}
		sendTextResponse(w, result)
	} else if key != "" && value != "" {
		//Set mode. Set the preference with given key
		sysdb.Write("fs", "pref/"+key+"/"+username, value)
		sendJSONResponse(w, "\"OK\"")
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
		var filesInUserRoot []fileObject
		filesInRoot, _ := filepath.Glob(*root_directory + "users/" + username + "/*")
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
			RootName string
			RootPath string
		}
		var roots []rootObject
		for _, store := range userinfo.GetAllFileSystemHandler() {
			var thisDevice = new(rootObject)
			thisDevice.RootName = store.Name
			thisDevice.RootPath = store.UUID + ":/"
			roots = append(roots, *thisDevice)
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

func system_fs_matchFileExt(inputFilename string, extArray []string) bool {
	inputExt := filepath.Ext(inputFilename)
	if stringInSlice(inputExt, extArray) {
		return true
	}
	return false
}

//Handle file properties request
func system_fs_getFileProperties(w http.ResponseWriter, r *http.Request) {
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

	result := fileProperties{
		VirtualPath:    vpath,
		StoragePath:    rpath,
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
	currentDir, _ = url.QueryUnescape(currentDir)
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
	//Convert the virutal path to realpath
	realpath, err := userinfo.VirtualPathToRealPath(currentDir)
	//log.Println(realpath)
	if err != nil {
		sendTextResponse(w, "Error. Unable to parse path. "+err.Error())
		return
	}
	if !fileExists(realpath) {
		userRoot, _ := userinfo.VirtualPathToRealPath("user:/")
		if filepath.Clean(realpath) == filepath.Clean(userRoot) {
			//Initiate user folder (Initiaed in user object)
			userinfo.GetHomeDirectory()
		} else {
			//Folder not exists
			sendJSONResponse(w, "{\"error\":\"Folder not exists\"}")
			return
		}

	}
	if sortMode == "" {
		sortMode = "default"
	}

	//Check for really special exception in where the path contains [ or ] which cannot be handled via Golang Glob function
	files, _ := system_fs_specialGlob(filepath.Clean(realpath) + "/*")

	type fileData struct {
		Filename    string
		Filepath    string
		Realpath    string
		IsDir       bool
		Filesize    float64
		Displaysize string
		ModTime     int64
	}
	var parsedFilelist []fileData

	for _, v := range files {
		if showHidden != "true" && filepath.Base(v)[:1] == "." {
			//Skipping hidden files
			continue
		}
		rawsize := fs.GetFileSize(v)
		modtime, _ := fs.GetModTime(v)
		thisFile := fileData{
			Filename:    filepath.Base(v),
			Filepath:    currentDir + filepath.Base(v),
			Realpath:    v,
			IsDir:       IsDir(v),
			Filesize:    float64(rawsize),
			Displaysize: fs.GetFileDisplaySize(rawsize, 2),
			ModTime:     modtime,
		}

		parsedFilelist = append(parsedFilelist, thisFile)
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

	//Perform cache rendering
	thumbRenderHandler.HandleLoadCache(w, r, rpath)

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

//Functions for handling quick file write without the need to go through agi for simple apps
func system_fs_handleFileWrite(w http.ResponseWriter, r *http.Request) {
	//Get the username for this user
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get the file content and the filepath
	content, _ := mv(r, "content", true)
	targetFilepath, err := mv(r, "filepath", true)
	if err != nil {
		sendErrorResponse(w, "Filepath cannot be empty")
		return
	}

	//Convert the filepath to realpath
	rpath, err := userinfo.VirtualPathToRealPath(targetFilepath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Check if the path dir exists. If not, return error
	if !fileExists(filepath.Dir(rpath)) {
		sendErrorResponse(w, "Directory not exists")
		return
	}

	//OK. Write to that file
	err = ioutil.WriteFile(rpath, []byte(content), 0755)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	sendOK(w)

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
