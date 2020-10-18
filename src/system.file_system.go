package main

import (
	"net/http"
	"path/filepath"
	"strings"
	"encoding/json"
	"os"
	"io"
	"io/ioutil"
	"fmt"
	"time"
	"sort"
	"strconv"
	"mime/multipart"
	"net/url"
	"runtime"
	"errors"
	"compress/flate"
	dircpy "github.com/otiai10/copy"
	archiver "github.com/mholt/archiver/v3"
	mimetype "github.com/gabriel-vasile/mimetype"
	"log"
)

func system_fs_service_init(){
	//Register all endpoints
	http.HandleFunc("/system/file_system/validateFileOpr", system_fs_validateFileOpr)
	http.HandleFunc("/system/file_system/fileOpr", system_fs_handleOpr)
	http.HandleFunc("/system/file_system/listDir", system_fs_handleList)
	http.HandleFunc("/system/file_system/listRoots", system_fs_listRoot)
	http.HandleFunc("/system/file_system/listDrives", system_fs_listDrives)
	http.HandleFunc("/system/file_system/newItem", system_fs_handleNewObjects)
	http.HandleFunc("/system/file_system/preference", system_fs_handleUserPreference)
	http.HandleFunc("/system/file_system/upload", system_fs_handleUpload)
	http.HandleFunc("/system/file_system/listTrash", system_fs_scanTrashBin)
	http.HandleFunc("/system/file_system/clearTrash", system_fs_clearTrashBin)
	http.HandleFunc("/system/file_system/restoreTrash", system_fs_restoreFile)
	http.HandleFunc("/system/file_system/zipHandler", system_fs_zipHandler)
	http.HandleFunc("/system/file_system/getProperties", system_fs_getFileProperties)
	http.HandleFunc("/system/file_system/pathTranslate", system_fs_handlePathTranslate)
	http.HandleFunc("/system/file_system/handleFileWrite", system_fs_handleFileWrite)

	//Register the module
	registerModule(moduleInfo{
		Name: "File Manager",
		Group: "System Tools",
		IconPath: "SystemAO/file_system/img/small_icon.png",
		Version: "1.0",
		StartDir: "SystemAO/file_system/file_explorer.html",
		SupportFW: true,
		InitFWSize: []int{1080,580},
		LaunchFWDir: "SystemAO/file_system/file_explorer.html",
		SupportEmb: false,
	})

	//Register the Trashbin module
	registerModule(moduleInfo{
		Name: "Trash Bin",
		Group: "System Tools",
		IconPath: "SystemAO/file_system/trashbin_img/small_icon.png",
		Version: "1.0",
		StartDir: "SystemAO/file_system/trashbin.html",
		SupportFW: true,
		InitFWSize: []int{1080,580},
		LaunchFWDir: "SystemAO/file_system/trashbin.html",
		SupportEmb: false,
		SupportedExt: []string{"*"},
	})

	//Create user root if not exists
	err := os.MkdirAll(*root_directory + "users/", 0755)
	if (err != nil){
		log.Println("Failed to create system storage root.")
		panic(err);
		os.Exit(0);
	}

	//Create database table if not exists
	err = system_db_newTable(sysdb, "fs");
	if (err != nil){
		log.Println("Failed to create table for file system")
		panic(err)
		os.Exit(0);
	}

}


//Handle upload.
func system_fs_handleUpload(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	//Limit the max upload size to the user defined size
	if (max_upload_size != 0){
		r.Body = http.MaxBytesReader(w, r.Body, max_upload_size)
	}

	//Check if this is running under demo mode. If yes, reject upload
	if (*demo_mode){
		sendErrorResponse(w, "You cannot upload in demo mode")
		return
	}

	err = r.ParseMultipartForm(int64(*upload_buf) << 20)
	if (err != nil){
		//Filesize too big
		sendErrorResponse(w,"File too large");
		return;
	}
	
	file, handler, err := r.FormFile("file")
	if err != nil {
        log.Println("Error Retrieving File from upload by user: " + username)
        sendErrorResponse(w,"Unable to parse file from upload");
		return;
	}

	//Get upload target directory
	uploadTarget, _ := mv(r, "path",true)
	if (uploadTarget == ""){
		sendErrorResponse(w,"Upload target cannot be empty.");
		return;
	}


	//Translate the upload target directory
	realUploadPath, err := virtualPathToRealPath(uploadTarget, username);

	if (err != nil){
		sendErrorResponse(w,"Upload target is invalid or permission denied.");
		return;
	}

	storeFilename :=  handler.Filename //Filename of the uploaded file
	destFilepath := filepath.Clean(realUploadPath) + "/" + storeFilename

	//Check if the upload target is read only.
	if (system_storage_getAccessMode(realUploadPath, username) == "readonly"){
		sendErrorResponse(w,"The upload target is Read Only.");
		return
	}

	//Check if the filesize < user storage remaining quota
	if system_disk_quota_checkIfQuotaApply(destFilepath, username) && !system_disk_quota_validateQuota(username, handler.Size){
		//File too big to fit in user quota
		sendErrorResponse(w, "Storage Quota Fulled")
		return
	}	

	//Prepare the file to be created (uploaded)
	destination, err := os.Create(destFilepath)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	

	//Move the file to destination file location
	go func(r *http.Request, file multipart.File, destination *os.File){
		//Do the file copying using a buffered reader
		defer destination.Close()
		defer file.Close()

		buf := make([]byte, 8192)
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
	}(r, file, destination)

	

	//Finish up the upload
	
	//fmt.Printf("Uploaded File: %+v\n", handler.Filename)
    //fmt.Printf("File Size: %+v\n", handler.Size)
	//fmt.Printf("MIME Header: %+v\n", handler.Header)
	//fmt.Println("Upload target: " + realUploadPath)
	

	//Fnish upload. Fix the tmp filename
	log.Println(username + " uploaded a file: " + handler.Filename);

	//Do file scaning here if needed, like compare file hash to known virus?
	//To be implemented
	
	
	sendOK(w)
	return
}


//Use for copying large file using buffering method. Allowing copying large file with little RAM
func system_fs_bufferedLargeFileCopy(src string, dst string, BUFFERSIZE int64) error {
	sourceFileStat, err := os.Stat(src)
	if err != nil {
		return err
	}

	if !sourceFileStat.Mode().IsRegular() {
		return errors.New("Invalid file source")
	}

	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()

	buf := make([]byte, BUFFERSIZE)
	for {
		n, err := source.Read(buf)
		if err != nil && err != io.EOF {
			return err
		}
		if n == 0 {
			break
		}

		if _, err := destination.Write(buf[:n]); err != nil {
			return err
		}
	}
	return err
}

//Validate if the copy and target process will involve file overwriting problem.
func system_fs_validateFileOpr(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		redirectToLoginPage(w,r)
		return;
	}
	vsrcFiles, _ := mv(r, "src", true);
	vdestFile, _ := mv(r, "dest",true);
	var duplicateFiles []string;

	//Loop through all files are see if there are duplication during copy and paste
	sourceFiles := []string{}
	decodedSourceFiles, _ := url.QueryUnescape(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles),&sourceFiles)
	if (err != nil){
		sendErrorResponse(w,"Source file JSON parse error.");
		return;
	}

	rdestFile, _ := virtualPathToRealPath(vdestFile,username);
	for _, file := range sourceFiles{
		rsrcFile, _ := virtualPathToRealPath(string(file),username);
		if (fileExists(rdestFile + filepath.Base(rsrcFile))){
			//File exists already. 
			vpath, _ := realpathToVirtualpath(rsrcFile,username);
			duplicateFiles = append(duplicateFiles, vpath)
		}

	}

	jsonString,_ := json.Marshal(duplicateFiles);
	sendJSONResponse(w, string(jsonString));
	return;
}

//Scan all the directory and get trash files within the system
func system_fs_scanTrashBin(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}
	type trashedFile struct{
		Filename string;
		Filepath string;
		FileExt string;
		IsDir bool;
		Filesize int64;
		RemoveTimestamp int64;
		RemoveDate string;
		OriginalPath string;
		OriginalFilename string;
	}

	results := []trashedFile{}
	files, err := system_fs_listTrash(username)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}
	//Get information of each files and process it into results
	for _, file := range files{
		timestamp := filepath.Ext(file)[1:];
		originalName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(filepath.Base(file)))
		originalExt := filepath.Ext(filepath.Base(originalName));
		virtualFilepath, _ := realpathToVirtualpath(file, username)
		virtualOrgPath, _ := realpathToVirtualpath(filepath.Dir(filepath.Dir(file)), username);
		rawsize, _, _, _ := system_fs_getFileSize(file)
		timestampInt64, _ := StringToInt64(timestamp)
		removeTimeDate := time.Unix(timestampInt64, 0)
		if IsDir(file){
			originalExt = ""
		}
		results = append(results, trashedFile{
			Filename: filepath.Base(file),
			Filepath: virtualFilepath,
			FileExt: originalExt,
			IsDir: IsDir(file),
			Filesize: int64(rawsize),
			RemoveTimestamp: timestampInt64, 
			RemoveDate: timeToString(removeTimeDate),
			OriginalPath: virtualOrgPath,
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
func system_fs_restoreFile(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	targetTrashedFile, err := mv(r, "src", true)
	if (err != nil){
		sendErrorResponse(w, "Invalid src given")
		return
	}

	//Translate it to realpath
	realpath, _ := virtualPathToRealPath(targetTrashedFile, username)
	if !fileExists(realpath){
		sendErrorResponse(w, "File not exists")
		return
	}

	//Check if this is really a trashed file
	if (filepath.Base(filepath.Dir(realpath)) != ".trash"){
		sendErrorResponse(w, "File not in trashbin")
		return;
	}

	//OK to proceed.
	targetPath := filepath.ToSlash(filepath.Dir(filepath.Dir(realpath))) + "/" + strings.TrimSuffix(filepath.Base(realpath), filepath.Ext(filepath.Base(realpath)))
	//log.Println(targetPath);
	os.Rename(realpath, targetPath)

	//Check if the parent dir has no more files. If yes, remove it
	filescounter, _ := filepath.Glob(filepath.Dir(realpath) + "/*");
	if len(filescounter) == 0{
		os.Remove(filepath.Dir(realpath));
	}

	sendOK(w);
}

//Clear all trashed file in the system
func system_fs_clearTrashBin(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	fileList, err := system_fs_listTrash(username)
	if (err != nil){
		sendErrorResponse(w, "Unable to clear trash: " + err.Error())
		return
	}

	//Get list success. Remove each of them.
	for _, file := range fileList{
		os.RemoveAll(file);
		//Check if its parent directory have no files. If yes, remove the dir itself as well.
		filesInThisTrashBin, _ := filepath.Glob(filepath.Dir(file) + "/*")
		if (len(filesInThisTrashBin) == 0){
			os.Remove(filepath.Dir(file))
		}
	}

	sendOK(w);
}

//Get all trash in a string list
func system_fs_listTrash(username string) ([]string, error){
	userRoot, _ := virtualPathToRealPath("user:/", username)
	scanningRoots := []string{
		userRoot,
	}
	//Get all roots to scan
	for _, storage := range storages{
		storageRoot, err := virtualPathToRealPath(storage.Uuid + ":/", username)
		if (err != nil){
			//Unable to decode this root. Skip this
			continue;
		}
		scanningRoots = append(scanningRoots, storageRoot)
	}

	files := []string{}
	for _, rootPath := range scanningRoots{
		err := filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
			oneLevelUpper := filepath.Base(filepath.Dir(path))
			if oneLevelUpper == ".trash"{
				//This is a trashbin dir.
				files = append(files, path)
			}
			return nil
		})
		if (err != nil){
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

func system_fs_handleNewObjects(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		redirectToLoginPage(w,r)
		return;
	}
	fileType, _ := mv(r, "type", true) //File creation type, {file, folder}
	vsrc, _ := mv(r, "src", true)	//Virtual file source folder, do not include filename
	filename, _ := mv(r, "filename", true)	//Filename for the new file
	
	if (fileType == "" && filename == ""){
		//List all the supported new filetype
		if (!fileExists("system/newitem/")){
			os.MkdirAll("system/newitem/",0755)
		}

		type newItemObject struct{
			Desc string;
			Ext string;
		}

		var newItemList []newItemObject;
		newItemTemplate,_ := filepath.Glob("system/newitem/*");
		for _, file := range newItemTemplate{
			thisItem := new(newItemObject)
			thisItem.Desc = strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
			thisItem.Ext = filepath.Ext(file)[1:]
			newItemList = append(newItemList, *thisItem)
		}
		
		jsonString, err := json.Marshal(newItemList)
		if (err != nil){
			log.Fatal("Unable to parse JSON string for new item list!")
			sendErrorResponse(w,"Unable to parse new item list. See server log for more information.")
			return;
		}
		sendJSONResponse(w,string(jsonString));
		return;
	}else if (fileType != "" && filename != ""){
		if (vsrc == ""){
			sendErrorResponse(w,"Missing paramter: 'src'")
			return;
		}
		//Translate the path to realpath
		rpath, err := virtualPathToRealPath(vsrc, username)
		if (err != nil){
			sendErrorResponse(w,"Invalid path given.")
			return;
		}
		
		//Check if directory is readonly
		if (system_storage_getAccessMode(rpath, username) == "readonly"){
			sendErrorResponse(w,"This directory is Read Only.");
			return
		}
		//Check if the file already exists. If yes, fix its filename.
		newfilePath := rpath + filename

		if (fileType == "file"){
			for fileExists(newfilePath){
				sendErrorResponse(w,"Given filename already exists.")
				return;
			}
			ext := filepath.Ext(filename)
			
			if (ext == ""){
				//This is a file with no extension.
				f, err := os.Create(newfilePath)
				if err != nil {
					log.Fatal(err)
					sendErrorResponse(w,err.Error())
					return
				}
				f.Close()
			}else{
				templateFile, _ := filepath.Glob("system/newitem/*" + ext);
				if (len(templateFile) == 0){
					//This file extension is not in template
					f, err := os.Create(newfilePath)
					if err != nil {
						log.Fatal(err)
						sendErrorResponse(w,err.Error())
						return
					}
					f.Close()
				}else{
					//Copy file from templateFile[0] to current dir with the given name
					input, _ := ioutil.ReadFile(templateFile[0])
					err := ioutil.WriteFile(newfilePath, input, 0755)
					if err != nil {
						log.Fatal(err)
						sendErrorResponse(w,err.Error())
						return
					}
				}
			}
	
			
		}else if (fileType == "folder"){
			if (fileExists(newfilePath)){
				sendErrorResponse(w,"Given folder already exists.")
				return;
			}
			//Create the folder at target location
			err := os.Mkdir(newfilePath,0755)
			if (err != nil){
				sendErrorResponse(w,err.Error())
				return;
			}
		}

		sendJSONResponse(w, "\"OK\"");
	}else{
		sendErrorResponse(w,"Missing paramter(s).")
		return;
	}
}

/*
	Handle file operations

	Support {move, copy, delete, recycle, rename}
*/
//Handle file operations.
func system_fs_handleOpr(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		redirectToLoginPage(w,r)
		return;
	}

	operation, _ := mv(r, "opr",true);
	vsrcFiles, _ := mv(r, "src", true);
	vdestFile, _ := mv(r, "dest",true);
	vnfilenames, _ := mv(r,"new",true); //Only use when rename or create new file / folder

	//Check if operation valid.
	if (operation == ""){
		//Undefined operations.
		sendErrorResponse(w,"Undefined operations paramter: Missing 'opr' in request header.")
		return;
	}

	//As the user can pass in multiple source files at the same time, parse sourceFiles from json string
	var sourceFiles []string;
	//This line is required in order to allow passing of special charaters
	decodedSourceFiles := system_fs_specialURIDecode(vsrcFiles)
	err = json.Unmarshal([]byte(decodedSourceFiles),&sourceFiles)
	if (err != nil){
		sendErrorResponse(w,"Source file JSON parse error.");
		return;
	}

	//Check if new filenames are also valid. If yes, translate it into string array
	var newFilenames []string
	if (vnfilenames != ""){
		vnfilenames, _ := url.QueryUnescape(vnfilenames)
		err = json.Unmarshal([]byte(vnfilenames),&newFilenames)
		if (err != nil){
			sendErrorResponse(w,"Unable to parse JSOn for new filenames");
			return;
		}
	}

	for i, vsrcFile := range sourceFiles{
		//Convert the virtual path to realpath on disk
		rsrcFile, _ := virtualPathToRealPath(string(vsrcFile),username);
		rdestFile, _ := virtualPathToRealPath(vdestFile,username);
		//Check if the source file exists
		if (!fileExists(rsrcFile)){
			sendErrorResponse(w,"Source file not exists.");
			return;
		}

		if (operation == "rename"){
			//Check if the usage is correct.
			if (vdestFile != ""){
				sendErrorResponse(w,"Rename only accept 'src' and 'new'. Please use move if you want to move a file.");
				return;
			}
			//Check if new name paramter is passed in.
			if (len(newFilenames) == 0){
				sendErrorResponse(w,"Missing paramter (JSON string): 'new'");
				return;
			}
			//Check if the source filenames and new filenanmes match
			if (len(newFilenames) != len(sourceFiles)){
				sendErrorResponse(w,"New filenames do not match with source filename's length.");
				return
			}

			//Check if the target dir is not readonly
			if (system_storage_getAccessMode(rsrcFile, username) == "readonly"){
				sendErrorResponse(w,"This directory is Read Only.");
				return
			}
			
			thisFilename := newFilenames[i]
			//Check if the name already exists. If yes, return false
			if (fileExists(filepath.Dir(rsrcFile) + "/" + thisFilename)){
				sendErrorResponse(w,"File already exists");
				return;
			}

			//Everything is ok. Rename the file.
			targetNewName := filepath.Dir(rsrcFile) + "/" + thisFilename;
			err = os.Rename(rsrcFile,targetNewName)
			if (err != nil){
				sendErrorResponse(w,err.Error());
				return;
			}
			
		}else if (operation == "move"){
			//File move operation. Check if the source file / dir and target directory exists
			/*
				//Example usage from file explorer
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
			if (!fileExists(rsrcFile)){
				sendErrorResponse(w,"Source file not exists");
				return;
			}

			//Check if the source file is read only.
			if (system_storage_getAccessMode(rsrcFile, username) == "readonly"){
				sendErrorResponse(w,"This source file is Read Only.");
				return
			}

			if (rdestFile == ""){
				sendErrorResponse(w, "Undefined dest location.");
				return;
			}

			srcRealpath, _ := filepath.Abs(rsrcFile);
			destRealpath, _ := filepath.Abs(rdestFile);
			if (IsDir(rsrcFile) && strings.Contains(destRealpath, srcRealpath)){
				//Recursive operation. Reject
				sendErrorResponse(w,"Recursive move operation.");
				return;
			}

			if (!fileExists(rdestFile)){
				if (fileExists(filepath.Dir(rdestFile))){
					//User pass in the whole path for the folder. Report error usecase.
					sendErrorResponse(w,"Dest location should be an existing folder instead of the full path of the moved file.");
					return;
				}
					sendErrorResponse(w, "Dest folder not found");
					return;
			}
			//Fix the lacking / at the end if true
			if (rdestFile[len(rdestFile)-1:] != "/"){
				rdestFile = rdestFile + "/"
			}

			//Check if the source and destination folder are under the same root. If yes, use os.Rename for faster move operations
			underSameRoot := false;
			//Check if the two files are under the same user root path
			thisRoot, _ := filepath.Abs(*root_directory + "users/" + username + "/");
			srcAbs, _ := filepath.Abs(rsrcFile);
			destAbs, _ := filepath.Abs(rdestFile);
			
			if (strings.Contains(srcAbs, thisRoot) && strings.Contains(destAbs, thisRoot)){
				//File is both under user root.
				underSameRoot = true;
			}else{
				//Check other storage path and see if they are under the same root
				for _, rootPath := range storages{
					thisRoot = rootPath.Path
					thisRootAbs, err := filepath.Abs(thisRoot)
					if (err != nil){
						continue;
					}
					if (strings.Contains(srcAbs,thisRootAbs) && strings.Contains(destAbs,thisRootAbs)){
						underSameRoot = true;
					}
				}
			}

			//Check if the target file already exists.
			movedFilename := filepath.Base(rsrcFile);
			existsOpr, _ := mv(r, "existsresp",true)
			if (fileExists(rdestFile + filepath.Base(rsrcFile))){
				//Handle cases where file already exists
				if (existsOpr == ""){
					//Do not specific file exists principle
					sendErrorResponse(w, "Destination file already exists.");
					return;
				}else if (existsOpr == "skip"){
					//Skip this file
					break;
				}else if (existsOpr == "overwrite"){
					//Continue with the following code
					//Check if the copy and paste dest are identical
					if (rsrcFile == (rdestFile + filepath.Base(rsrcFile))){
						//Source and target identical. Cannot overwrite.
						sendErrorResponse(w,"Source and destination paths are identical.");
						return;
					}
		
				}else if (existsOpr == "keep"){
					//Keep the file but saved with 'Copy' suffix
					newFilename := strings.TrimSuffix(filepath.Base(rsrcFile), filepath.Ext(rsrcFile)) + " - Copy" + filepath.Ext(rsrcFile);
					//Check if the newFilename already exists. If yes, continue adding suffix
					duplicateCounter := 0;
					for fileExists(rdestFile + newFilename){
						duplicateCounter++;
						newFilename = strings.TrimSuffix(filepath.Base(rsrcFile), filepath.Ext(rsrcFile)) + " - Copy(" + strconv.Itoa(duplicateCounter)+ ")" + filepath.Ext(rsrcFile);
						if (duplicateCounter > 1024){
							//Maxmium loop encountered. For thread safty, terminate here
							sendErrorResponse(w, "Too many copies of identical files.");
							return;
						}
					}
					movedFilename = newFilename
				}else{
					//This exists opr not supported.
					sendErrorResponse(w, "Unknown file exists rules given.");
					return;
				}
			}
			
			if (underSameRoot){
				//Ready to move with the quick rename method
				realDest := rdestFile + movedFilename;
				os.Rename(rsrcFile,realDest)
			}else{
				//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
				if (IsDir(rsrcFile)){
					//Source file is directory. CopyFolder
					realDest := rdestFile + movedFilename;
					err := dircpy.Copy(rsrcFile, realDest)
					if (err != nil){
						sendErrorResponse(w,err.Error());
						return;
					}
					//Move completed. Remove source file.
					os.RemoveAll(rsrcFile)

				}else{
					//Source is file only. Copy file.
					realDest := rdestFile + movedFilename;
					source, err := os.Open(rsrcFile)
					if err != nil {
						sendErrorResponse(w,err.Error());
						return;
					}
			
					destination, err := os.Create(realDest)
					if err != nil {
						sendErrorResponse(w,err.Error());
						return;
					}

					io.Copy(destination, source)
					source.Close()
					destination.Close()
					//Delete the source file after copy
					err = os.Remove(rsrcFile)
					if (err != nil){
						sendErrorResponse(w,err.Error());
						return;
					}
				}
			}


		}else if (operation == "copy"){
			//Copy file. See move example and change 'opr' to 'copy'
			if (!fileExists(rsrcFile)){
				sendErrorResponse(w,"Source file not exists");
				return;
			}

			//Check if the desintation is read only.
			if (system_storage_getAccessMode(rdestFile, username) == "readonly"){
				sendErrorResponse(w,"This directory is Read Only.");
				return
			}

			if (!fileExists(rdestFile)){
				if (fileExists(filepath.Dir(rdestFile))){
					//User pass in the whole path for the folder. Report error usecase.
					sendErrorResponse(w,"Dest location should be an existing folder instead of the full path of the copied file.");
					return;
				}
					sendErrorResponse(w, "Dest folder not found");
					return;
			}

			srcRealpath, _ := filepath.Abs(rsrcFile);
			destRealpath, _ := filepath.Abs(rdestFile);
			if (IsDir(rsrcFile) && strings.Contains(destRealpath, srcRealpath)){
				//Recursive operation. Reject
				sendErrorResponse(w,"Recursive copy operation.");
				return;
			}

			//Check if the copy destination file already have an identical file
			copiedFilename := filepath.Base(rsrcFile);
			existsOpr, _ := mv(r, "existsresp",true)
			if (fileExists(rdestFile + filepath.Base(rsrcFile))){
				if (existsOpr == ""){
					//Do not specific file exists principle
					sendErrorResponse(w, "Destination file already exists.");
					return;
				}else if (existsOpr == "skip"){
					//Skip this file
					break;
				}else if (existsOpr == "overwrite"){
					//Continue with the following code
					//Check if the copy and paste dest are identical
					if (rsrcFile == (rdestFile + filepath.Base(rsrcFile))){
						//Source and target identical. Cannot overwrite.
						sendErrorResponse(w,"Source and destination paths are identical.");
						return;
					}
		
				}else if (existsOpr == "keep"){
					//Keep the file but saved with 'Copy' suffix
					newFilename := strings.TrimSuffix(filepath.Base(rsrcFile), filepath.Ext(rsrcFile)) + " - Copy" + filepath.Ext(rsrcFile);
					//Check if the newFilename already exists. If yes, continue adding suffix
					duplicateCounter := 0;
					for fileExists(rdestFile + newFilename){
						duplicateCounter++;
						newFilename = strings.TrimSuffix(filepath.Base(rsrcFile), filepath.Ext(rsrcFile)) + " - Copy(" + strconv.Itoa(duplicateCounter)+ ")" + filepath.Ext(rsrcFile);
						if (duplicateCounter > 1024){
							//Maxmium loop encountered. For thread safty, terminate here
							sendErrorResponse(w, "Too many copies of identical files.");
							return;
						}
					}
					copiedFilename = newFilename
				}else{
					//This exists opr not supported.
					sendErrorResponse(w, "Unknown file exists rules given.");
					return;
				}
				
			}

			//Fix the lacking / at the end if true
			if (rdestFile[len(rdestFile)-1:] != "/"){
				rdestFile = rdestFile + "/"
			}

			//Ready to move. Check if both folder are located in the same root devices. If not, use copy and delete method.
			if (IsDir(rsrcFile)){
				//Source file is directory. CopyFolder
				realDest := rdestFile + copiedFilename;
				err := dircpy.Copy(rsrcFile, realDest)
				if (err != nil){
					sendErrorResponse(w,err.Error());
					return;
				}

			}else{
				//Source is file only. Copy file.
				realDest := rdestFile + copiedFilename;
				source, err := os.Open(rsrcFile)
				if err != nil {
					sendErrorResponse(w,err.Error());
					return;
				}
		
				destination, err := os.Create(realDest)
				if err != nil {
					sendErrorResponse(w,err.Error());
					return;
				}

				_, err = io.Copy(destination, source)
				if (err != nil){
					sendErrorResponse(w,err.Error());
					return;
				}
				source.Close()
				destination.Close()
			}
		
		}else if (operation == "delete"){
			//Delete the file permanently
			if (!fileExists(rsrcFile)){
				sendErrorResponse(w,"Source file not exists");
				return;
			}

			//Check if the desintation is read only.
			if (system_storage_getAccessMode(rsrcFile, username) == "readonly"){
				sendErrorResponse(w,"This directory is Read Only.");
				return
			}

			os.RemoveAll(rsrcFile);

		}else if (operation == "recycle"){
			//Put it into a subfolder named trash and allow it to to be removed later
			if (!fileExists(rsrcFile)){
				sendErrorResponse(w, "Source file not exists.")
				return;
			}

			//Check if the upload target is read only.
			if (system_storage_getAccessMode(rsrcFile, username) == "readonly"){
				sendErrorResponse(w,"This directory is Read Only.");
				return
			}

			//Create a trash directory for this folder
			trashDir := filepath.ToSlash(filepath.Dir(rsrcFile)) + "/.trash/";
			os.MkdirAll(trashDir, 0755)
			os.Rename(rsrcFile, trashDir + filepath.Base(rsrcFile) + "." + Int64ToString(GetUnixTime()))
		}else{
			sendErrorResponse(w,"Unknown file opeartion given.")
			return;
		}
	}
	sendJSONResponse(w,"\"OK\"");
	return;
}

//Allow systems to store key value pairs in the database as preferences.
func system_fs_handleUserPreference(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		redirectToLoginPage(w,r)
		return;
	}

	key, _ := mv(r, "key",false)
	value, _ := mv(r, "value",false)
	if (key != "" && value == ""){
		//Get mode. Read the prefernece with given key
		result := ""
		err := system_db_read(sysdb, "fs", "pref/" + key + "/" + username, &result);
		if (err != nil){
			sendJSONResponse(w,"{\"error\":\"Key not found.\"}")
			return;
		}
		sendTextResponse(w,result);
	}else if (key != "" && value != ""){
		//Set mode. Set the preference with given key
		system_db_write(sysdb, "fs","pref/" + key + "/" + username, value)
		sendJSONResponse(w,"\"OK\"")
	}
}

func system_fs_listDrives(w http.ResponseWriter, r *http.Request){
	if (system_auth_chkauth(w,r) == false){
		redirectToLoginPage(w,r)
		return;
	}
	type driveInfo struct{
		Drivepath string;
		DriveFreeSpace uint64;
		DriveTotalSpace uint64;
		DriveAvailSpace uint64;
	}
	var drives []driveInfo;
	if runtime.GOOS == "windows" {
		//Under windows
        for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ"{
			f, err := os.Open(string(drive)+":\\")
			if err == nil {
				thisdrive := new(driveInfo);
				thisdrive.Drivepath = string(drive) + ":\\"
				free, total, avail := system_storage_getDriveCapacity(string(drive) + ":\\");
				thisdrive.DriveFreeSpace = free;
				thisdrive.DriveTotalSpace = total; 
				thisdrive.DriveAvailSpace = avail;
				drives = append(drives,*thisdrive)
				f.Close()
			}
		}
    } else {
		//Under linux environment
		//Append all the virtual directories root as root instead
		storageDevices := []string{ *root_directory + "users"}
		for _, vstorage := range storages{
			storageDevices = append(storageDevices, vstorage.Path)
		}

		//List all storage information of each devices
		for _, dev := range storageDevices{
			thisdrive := new(driveInfo);
			thisdrive.Drivepath = filepath.Base(dev)
			free, total, avail := system_storage_getDriveCapacity(string(dev));
			thisdrive.DriveFreeSpace = free;
			thisdrive.DriveTotalSpace = total; 
			thisdrive.DriveAvailSpace = avail;
			drives = append(drives,*thisdrive)
		}
		
	}
	
	jsonString, _ := json.Marshal(drives);
	sendJSONResponse(w,string(jsonString))
}

func system_fs_listRoot(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		//user not logged in. Redirect to login page.
		redirectToLoginPage(w,r)
		return;
	}
	userRoot, _ := mv(r,"user",false);
	if (userRoot == "true"){
		type fileObject struct{
			Filename string;
			Filepath string;
			IsDir bool;
		}
		//List the root media folders under user:/
		var filesInUserRoot []fileObject;
		filesInRoot, _ := filepath.Glob( *root_directory + "users/" + username + "/*")
		for _, file := range filesInRoot{
			thisFile := new(fileObject)
			thisFile.Filename = filepath.Base(file);
			thisFile.Filepath, _ = realpathToVirtualpath(file,username);
			thisFile.IsDir = IsDir(file);
			filesInUserRoot = append(filesInUserRoot, *thisFile)
		}
		jsonString, _ := json.Marshal(filesInUserRoot)
		sendJSONResponse(w,string(jsonString));
	}else{
		type rootObject struct{
			RootName string;
			RootPath string;
		}
		var roots []rootObject;
		roots = append(roots,rootObject{
			"User",
			"user:/",
		})
		for _, store := range storages{
			var thisDevice = new(rootObject)
			thisDevice.RootName = store.Name
			thisDevice.RootPath = store.Uuid + ":/"
			roots = append(roots, *thisDevice)
		}
		jsonString, _ := json.Marshal(roots)
		sendJSONResponse(w,string(jsonString));
	}
	
}

/*
	Special Glob for handling path with [ or ] inside. 
	You can also pass in normal path for globing if you are not sure.
*/

func system_fs_specialGlob(path string) ([]string, error){
	files, err := filepath.Glob(path)
	if (err != nil){
		return []string{}, err
	}
	
	if (strings.Contains(path, "[") == true || strings.Contains(path, "]") == true){
		if (len(files) == 0){
			//Handle reverse check. Replace all [ and ] with *
			newSearchPath := strings.ReplaceAll(path, "[","?")
			newSearchPath = strings.ReplaceAll(newSearchPath, "]","?")
			//Scan with all the similar structure except [ and ]
			tmpFilelist, _ := filepath.Glob(newSearchPath)
			for _, file := range tmpFilelist{
				file = filepath.ToSlash(file)
				if strings.Contains(file, filepath.ToSlash(filepath.Dir(path))){
					files = append(files, file)
				}
			}
		}
	}
	//Convert all filepaths to slash
	for i:=0; i < len(files); i++{
		files[i] = filepath.ToSlash(files[i])
	}
	return files, nil
}

func system_fs_specialURIDecode(inputPath string) string{
	inputPath = strings.ReplaceAll(inputPath, "+","{{plus_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{plus_sign}}","+")
	return inputPath;
}

func system_fs_matchFileExt(inputFilename string, extArray []string) bool{
	inputExt := filepath.Ext(inputFilename);
	if (stringInSlice(inputExt,extArray)){
		return true
	}
	return false;
}

//Handle file properties request
func system_fs_getFileProperties(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	vpath, err := mv(r, "path", true)
	if (err != nil){
		sendErrorResponse(w, "path not defined")
		return
	}

	rpath, err := virtualPathToRealPath(vpath, username);
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}

	fileStat, err := os.Stat(rpath)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}

	type fileProperties struct{
		VirtualPath string
		StoragePath string
		Basename string
		VirtualDirname string
		StorageDirname string
		Ext string
		MimeType string
		Filesize int64
		Permission string
		LastModTime string
		LastModUnix int64
		IsDirectory bool
	}

	mime := "text/directory"
	if (!fileStat.IsDir()){
		m, _, err := system_fs_getMime(rpath)
		if (err != nil){
			mime = ""
		}
		mime = m
	}
	
	filesize := fileStat.Size()
	//Get file overall size if this is folder
	if (fileStat.IsDir()){
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
		VirtualPath: vpath,
		StoragePath: rpath,
		Basename: filepath.Base(rpath),
		VirtualDirname: filepath.ToSlash(filepath.Dir(vpath)),
		StorageDirname: filepath.ToSlash(filepath.Dir(rpath)),
		Ext: filepath.Ext(rpath),
		MimeType: mime,
		Filesize: filesize,
		Permission: fileStat.Mode().Perm().String(),
		LastModTime: timeToString(fileStat.ModTime()),
		LastModUnix: fileStat.ModTime().Unix(),
		IsDirectory: fileStat.IsDir(),
	}

	jsonString, _ := json.Marshal(result);
	sendJSONResponse(w, string(jsonString))
}


//Get the mime type of a given file, return MIME TYPE, Original MIME Extension and Error
func system_fs_getMime(filepath string) (string, string, error){
	mime, err := mimetype.DetectFile(filepath)
	return mime.String(), mime.Extension(), err
}

/*
	List directory in the given path

	Usage: Pass in dir like the following examples:
	AOR:/Desktop	<= Open /user/{username}/Desktop
	S1:/			<= Open {uuid=S1}/


*/

func system_fs_handleList(w http.ResponseWriter, r *http.Request){
	currentDir, _ := mv(r, "dir",true);
	currentDir, _ = url.QueryUnescape(currentDir)
	sortMode, _ := mv(r,"sort",true);
	showHidden, _ := mv(r, "showHidden", true)
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		//user not logged in. Redirect to login page.
		redirectToLoginPage(w,r)
		return;
	}
	if (currentDir == ""){
		sendErrorResponse(w, "Invalid dir given.")
		return;
	}

	//Pad a slash at the end of currentDir if not exists
	if (currentDir[len(currentDir) - 1 : ] != "/"){
		currentDir = currentDir + "/"
	}
	//Convert the virutal path to realpath
	realpath, err := virtualPathToRealPath(currentDir,username);
	//log.Println(realpath)
	if (err != nil){
		sendTextResponse(w,"Error. Unable to parse path. " + err.Error());
		return
	}
	if (!fileExists(realpath)){
		userRoot, _ := virtualPathToRealPath("user:", username);
		if (filepath.Clean(realpath) == filepath.Clean(userRoot)){
			//Initiate user folder
			system_file_initUserRoot(username);
		}else{
			//Folder not exists
			sendJSONResponse(w,"{\"error\":\"Folder not exists\"}");
			return;
		}
		
	}
	if (sortMode == ""){
		sortMode = "default"
	}

	//Check for really special exception in where the path contains [ or ] which cannot be handled via Golang Glob function
	files, _ := system_fs_specialGlob(filepath.Clean(realpath) + "/*")
	/*
	//Moved to system_fs_specialGlob function
	files, _ := filepath.Glob(realpath + "*")
	if (strings.Contains(realpath, "[") == true || strings.Contains(realpath, "]") == true){
		if (len(files) == 0){
			//Handle reverse check. Replace all [ and ] with *
			newSearchPath := strings.ReplaceAll(realpath, "[","*")
			newSearchPath = strings.ReplaceAll(newSearchPath, "]","*")
			//Scan with all the similar structure except [ and ]
			tmpFilelist, _ := filepath.Glob(newSearchPath + "*")
			for _, file := range tmpFilelist{
				file = filepath.ToSlash(file)
				if strings.Contains(file, realpath){
					files = append(files, file)
				}
			}
		}
	}
	*/

	type fileData struct{
		Filename string;
		Filepath string;
		Realpath string;
		IsDir bool;
		Filesize float64;
		Displaysize string;
	}
	var parsedFilelist []fileData;

	for _, v := range files{
		if showHidden != "true" && filepath.Base(v)[:1] == "."{
			//Skipping hidden files
			continue;
		}
		thisFile := new(fileData);
		rawsize, filesize, unit, _ := system_fs_getFileSize(v)
		thisFile.Filename = filepath.Base(v);
		thisFile.Filepath = currentDir + filepath.Base(v);
		thisFile.Realpath = v;
		thisFile.IsDir = IsDir(v);
		thisFile.Filesize = rawsize
		thisFile.Displaysize = fmt.Sprintf("%.2f", filesize) + unit
		parsedFilelist = append(parsedFilelist,*thisFile)
	}

	//Sort the filelist
	if (sortMode == "default"){
		//Sort by name, convert filename to window sorting methods
		sort.Slice(parsedFilelist, func(i, j int) bool { return strings.ToLower(parsedFilelist[i].Filename) < strings.ToLower(parsedFilelist[j].Filename) })
	}else if (sortMode == "reverse"){
		//Sort by reverse name
		sort.Slice(parsedFilelist, func(i, j int) bool { return strings.ToLower(parsedFilelist[i].Filename) > strings.ToLower(parsedFilelist[j].Filename) })
	}else if (sortMode == "smallToLarge"){
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize < parsedFilelist[j].Filesize })
	}else if (sortMode == "largeToSmall"){
		sort.Slice(parsedFilelist, func(i, j int) bool { return parsedFilelist[i].Filesize > parsedFilelist[j].Filesize })
	}
	
	jsonString, _ := json.Marshal(parsedFilelist);
	sendJSONResponse(w,string(jsonString))

}

/*
	Virtual Path to Real path translator

	Convert a virtual path like
	user:/Desktop
	S1:/demo

	to a realpath like
	./files/users/{username}/Desktop
	/media/storage1/demo/
*/

func system_file_initUserRoot(username string){
	//Create user subfolders
	os.MkdirAll(*root_directory + "users/" + username + "/Desktop", 0755);
	os.MkdirAll(*root_directory + "users/" + username + "/Music", 0755);
	os.MkdirAll(*root_directory + "users/" + username + "/Video", 0755);
	os.MkdirAll(*root_directory + "users/" + username + "/Document", 0755);
	os.MkdirAll(*root_directory + "users/" + username + "/Photo", 0755);
}

func virtualPathToRealPath(virtualPath string, username string) (string, error){
	virtualPath = strings.ReplaceAll(virtualPath,"\\","/")
	virtualPath = strings.ReplaceAll(virtualPath,"../","")
	if (strings.Contains(virtualPath,":") == false){
		return "",errors.New("Path missing Virtual Device ID (e.g. user:/). Given: " + virtualPath)
	}
	//Parse the ID of the targeted virtual disk
	tmp := strings.Split(virtualPath,":")
	vdID := tmp[0]
	pathSlice := tmp[1:]
	path := strings.Join(pathSlice,":")

	var realpath string;
	if (vdID == "user"){
		realpath = *root_directory + "users/" + username  + path
	}else if (vdID == "tmp"){
		os.MkdirAll(filepath.Clean(*tmp_directory) + "/users/" + username, 0777)
		realpath = filepath.Clean(*tmp_directory) + "/users/" + username + path
	}else{
		//Search for index located in the external storages
		var storageRealPath string = "";
		var targetStorageDevice storageDevice;
		for _, storage := range storages{
			if (storage.Uuid == vdID){
				//This is the corret storage location
				storageRealPath = storage.Path
				targetStorageDevice = storage;
			}
		}
		if (storageRealPath == ""){
			//Storage device not found.
			return "",errors.New("Storage device not found.")
		}
		if (storageRealPath[len(storageRealPath) - 1:] != "/"){
			storageRealPath = storageRealPath + "/"
		}
		//Build real path
		if (targetStorageDevice.Hierarchy == "public"){
			realpath = storageRealPath + path;
		}else if (targetStorageDevice.Hierarchy == "users"){
			if (!fileExists(storageRealPath + "/users/")){
				//Folder structure not initialized. Create this user now.
				os.MkdirAll(storageRealPath + "users/" + username + "/",0755);
			}
			realpath = storageRealPath + "users/" + username + "/" + path;
		}

	}
	realpath = strings.ReplaceAll(realpath, "//","/")
	return realpath, nil
}

func realpathToVirtualpath(realpath string, username string) (string,error){
	realpath = filepath.ToSlash(realpath)
	realpath = strings.ReplaceAll(realpath,"../","")

	//Get relative path of all allowed storage path. Find the one without directory travsal
	var rootPaths []string;
	var rootUUID []string;
	var rootHierarchy []string;
	//Append user root path into the rootpaths as default
	rootUUID = append(rootUUID, "user:/")
	rootPaths = append(rootPaths, filepath.Clean(*root_directory) + "/users/" + username + "/") 
	rootHierarchy = append(rootHierarchy, "users")

	//Append the tmp directory as well
	rootUUID = append(rootUUID, "tmp:/")
	rootPaths = append(rootPaths, filepath.Clean(*tmp_directory) + "/users/" + username + "/") 
	rootHierarchy = append(rootHierarchy, "users")

	//Process extra storage locations
	for _, v := range storages{
		thispath :=  v.Path;
		if thispath[len(thispath) - 1:] != "/"{
			thispath = thispath + "/"
		}
		rootPaths = append(rootPaths,thispath)
		rootUUID = append(rootUUID,v.Uuid + ":/");
		rootHierarchy = append(rootHierarchy, v.Hierarchy)
	}

	var relativePaths []string;
	for _, path := range rootPaths{
		thisRelative, err := filepath.Rel(path,realpath);
		if (err != nil){
			relativePaths = append(relativePaths,"../");
		}else{
			relativePaths = append(relativePaths,thisRelative);
		}
		
	}

	//Loop through each of the relative path to see which do not have ../
	var validRelativePath string = "";
	var virtualRoot string = "";
	var targetHierarchy string = "";
	for i, path := range relativePaths{
		path = strings.ReplaceAll(path,"\\","/")
		if (strings.Contains(path,"../") == false){
			validRelativePath = path;
			virtualRoot = rootUUID[i]
			targetHierarchy = rootHierarchy[i]
		}
	}
	if (validRelativePath == ""){
		return "", errors.New("Cannot parse virtualpath for this realpath")
	}

	//Match the storage type if it is under users mode (aka S1:/user/{username}/* => S1:/*)
	if (targetHierarchy == "public"){
		//Return the current path without post-processing
		return virtualRoot + validRelativePath, nil
	}else if (targetHierarchy == "users"){
		userRootPath := "users/" + username + "/"
		userRelativeVirtualPath := strings.Replace(validRelativePath,userRootPath,"",1)
		userRelativeVirtualPath = virtualRoot + userRelativeVirtualPath;
		return userRelativeVirtualPath, nil
	}
	//Unknown type. Return nothing
	return "",nil
}

/*
	Filesize function, return the rawsize, human readable filesize in float64 and its unit in string

	Required
	@path (string)
	@humanReadable(bool) => If this is set to false, it will return filesize in bytes only
*/
func system_fs_getFileSize(path string) (float64, float64, string, error){
	file, err := os.Open(path)
	if err != nil {
		return -1, -1, "", errors.New("File not exists")
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return -1, -1,"",errors.New("Cannot read file statistic")
	}

	var bytes float64
	bytes = float64(stat.Size())

	var kilobytes float64
	kilobytes = (bytes / 1024)
	if (kilobytes < 1){
		return bytes, bytes,"Bytes",nil
	}
	var megabytes float64
	megabytes = (float64)(kilobytes / 1024)
	if (megabytes < 1){
		return bytes, kilobytes,"KB",nil
	}
	var gigabytes float64
	gigabytes = (megabytes / 1024)
	if (gigabytes < 1){
		return bytes, megabytes,"MB",nil
	}
	var terabytes float64
	terabytes = (gigabytes / 1024)
	if (terabytes < 1){
		return bytes, gigabytes,"GB",nil
	}
	var petabytes float64
	petabytes = (terabytes / 1024)
	if (petabytes < 1){
		return bytes, terabytes,"TB",nil
	}
	var exabytes float64
	exabytes = (petabytes / 1024)
	if (exabytes < 1){
		return bytes, petabytes,"PB",nil
	}
	var zettabytes float64
	zettabytes = (exabytes / 1024)
	if (zettabytes < 1){
		return bytes, exabytes,"EB",nil
	}

	
	return -1, -1,"Too big to meausre",nil
}


/*
	File zipping and unzipping functions

*/

//Handle all zip related API
func system_fs_zipHandler(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w, "User not logged in");
		return;
	}

	opr, err := mv(r, "opr", true)
	if (err != nil){
		sendErrorResponse(w, "Invalid opr or opr not defined")
		return
	}

	vsrc, _ := mv(r, "src",true)
	if (vsrc == ""){
		sendErrorResponse(w, "Invalid src paramter")
		return
	}

	vdest, _ := mv(r, "dest", true)
	rdest := ""

	//Convert source path from JSON string to object
	virtualSourcePaths := []string{}
	err = json.Unmarshal([]byte(vsrc), &virtualSourcePaths);
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return;
	}

	//Check each of the path
	realSourcePaths := []string{}
	for _, vpath := range virtualSourcePaths{
		thisrpath, err := virtualPathToRealPath(vpath, username)
		if (err != nil || !fileExists(thisrpath)){
			sendErrorResponse(w, "File not exists: " + vpath)
			return
		}
		realSourcePaths = append(realSourcePaths, thisrpath)
	}
	
	///Convert dest to real if given
	if (vdest != ""){
		realdest, _ := virtualPathToRealPath(vdest, username)
		rdest = realdest
	}


	if (opr == "zip"){
		//Check if destination location exists
		if (rdest == "" || !fileExists(filepath.Dir(rdest))){
			sendErrorResponse(w, "Invalid dest location")
			return
		}

		//OK. Create the zip at the desired location
		err := system_fs_createZipFile(realSourcePaths, rdest, false);
		if (err != nil){
			sendErrorResponse(w, err.Error())
			return;
		}

		sendOK(w);
	}else if (opr == "tmpzip"){
		//Zip to tmp folder
		userTmpFolder, _ := virtualPathToRealPath("tmp:/", username)
		filename := Int64ToString(GetUnixTime()) + ".zip";
		rdest := filepath.Clean(userTmpFolder) + "/" + filename
		log.Println(realSourcePaths, rdest);
		err := system_fs_createZipFile(realSourcePaths, rdest, false);
		if (err != nil){
			sendErrorResponse(w, err.Error())
			return;
		}

		//Send the tmp filename to the user
		sendTextResponse(w, "tmp:/" + filename);

	}else if (opr == "inspect"){

	}else if (opr == "unzip"){

	}

}

func system_fs_createZipFile(filelist []string, outputfile string, includeTopLevelFolder bool) error{
	z := archiver.Zip{
		CompressionLevel:       flate.DefaultCompression,
		MkdirAll:               true,
		SelectiveCompression:   true,
		OverwriteExisting:      false,
		ImplicitTopLevelFolder: includeTopLevelFolder,
	}
	
	err := z.Archive(filelist, outputfile)
	return err
}

func system_fs_inspectZipFile(filepath string) ([]string, error){
	z := archiver.Zip{}
	filelist := []string{}
	err := z.Walk(filepath, func(f archiver.File) error {
		filelist = append(filelist, f.Name())
		return nil
	})

	return filelist, err
}

//Translate path from and to virtual and realpath
func system_fs_handlePathTranslate(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	path, err := mv(r, "path", false)
	if (err != nil){
		sendErrorResponse(w, "Invalid path given")
		return
	}
	rpath, err := virtualPathToRealPath(path, username)
	if (err != nil){
		//Try to convert it to virtualPath
		vpath, err := realpathToVirtualpath(path, username)
		if (err != nil){
			sendErrorResponse(w, "Unknown path given")
		}else{
			jsonstring, _ := json.Marshal(vpath)
			sendJSONResponse(w, string(jsonstring))
		}
	}else{
		abrpath, _ := filepath.Abs(rpath);
		jsonstring, _ := json.Marshal([]string{rpath, filepath.ToSlash(abrpath)})
		sendJSONResponse(w, string(jsonstring))
	}

}

//Functions for handling quick file write without the need to go through agi for simple apps
func system_fs_handleFileWrite(w http.ResponseWriter, r *http.Request){
	//Get the username for this user
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	//Get the file content and the filepath
	content, _ := mv(r, "content", true)
	targetFilepath, err := mv(r, "filepath", true)
	if err != nil{
		sendErrorResponse(w, "Filepath cannot be empty")
		return
	}

	//Convert the filepath to realpath
	rpath, err := virtualPathToRealPath(targetFilepath, username)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	//Check if the path dir exists. If not, return error
	if !fileExists(filepath.Dir(rpath)){
		sendErrorResponse(w, "Directory not exists")
		return
	}

	//OK. Write to that file
	err = ioutil.WriteFile(rpath, []byte(content), 0755)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}

	sendOK(w);

}


