package main

import (
	"net/http"
	"log"
	"strings"
	"path/filepath"
	"encoding/json"
	"os"
	"fmt"
	"strconv"
)

/*
	AirMUsic - Maybe the best music playback app on ArOZ Online 

	CopyRight Toby Chui, 2020
*/

func module_Music_init(){
	http.HandleFunc("/Music/listSong", module_airMusic_listSong)
	http.HandleFunc("/Music/getMeta", module_airMusic_getMeta)
	http.HandleFunc("/Music/getFileInfo", module_airMusic_getFileInfo)
	

	//Register this module to system
	registerModule(moduleInfo{
		Name: "Music",
		Desc: "The basic music player for ArOZ Online",
		Group: "Media",
		IconPath: "Music/img/module_icon.png",
		Version: "0.0.4",
		StartDir: "Music/index.html",
		SupportFW: true,
		LaunchFWDir: "Music/index.html",
		SupportEmb: true,
		LaunchEmb: "Music/embedded.html",
		InitFWSize: []int{475, 700},
		InitEmbSize: []int{360, 240},
		SupportedExt: []string{".mp3",".flac",".wav",".ogg",".aac",".webm",".mp4"},
	})
}

func module_airMusic_getMeta(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w,"User not logged in")
		return;
	}

	playingFile, _ := mv(r, "file", false)
	playingFile = system_fs_specialURIDecode(playingFile)
	rPlayingFilePath, _ := virtualPathToRealPath(playingFile, username)
	fileDir := filepath.ToSlash(filepath.Dir(rPlayingFilePath))
	supportedFileExt := []string{".mp3",".flac",".wav",".ogg",".aac",".webm",".mp4"}
	var fileInfos [][]string
	objs, _ := system_fs_specialGlob(fileDir + "/*")
	for _, obj := range objs{
		if (!IsDir(obj) && stringInSlice(filepath.Ext(obj), supportedFileExt)){
			//This is a file that we want to list
			var thisFileInfo []string
			fileExt := filepath.Ext(obj)[1:]
			fileName := filepath.Base(obj)
			filePath, _ := realpathToVirtualpath(obj, username)
			_, hsize, unit, _ := system_fs_getFileSize(obj)
			size := fmt.Sprintf("%.2f", hsize) + unit;

			thisFileInfo = append(thisFileInfo, fileName)
			thisFileInfo = append(thisFileInfo, filePath)
			thisFileInfo = append(thisFileInfo, fileExt)
			thisFileInfo = append(thisFileInfo, size)

			fileInfos = append(fileInfos, thisFileInfo)
		}
	}
	
	jsonString, _ := json.Marshal(fileInfos);
	sendJSONResponse(w, string(jsonString));
}

func module_airMusic_listSong(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		redirectToLoginPage(w,r)
		return;
	}
	
	var musicDirs []string
	var playLists []string

	//Initialize user folder structure if it is not yet init
	uploadDir, _ := virtualPathToRealPath("user:/Music/",username)
	playList, _ := virtualPathToRealPath("user:/Music/playlist",username)
	os.MkdirAll(uploadDir, 0755)
	os.MkdirAll(playList, 0755)
	musicDirs = append(musicDirs, uploadDir);
	playLists = append(playLists, playList);

	for _, extStorage := range storages{
		path := extStorage.Path;
		if (path[len(path) - 1:] != "/"){
			path = path + "/"
		}
		musicDirs = append(musicDirs, path)
	}

	//Get which folder the user want to list
	lsDir, _ := mv(r, "listdir", false)
	listSong, _ := mv(r, "listSong", false)
	listFolder, _ := mv(r, "listfolder", false)
	supportedFileExt := []string{".mp3",".flac",".wav",".ogg",".aac",".webm"}

	//Decode url component if needed
	if (lsDir != ""){
		lsDir = strings.ReplaceAll(lsDir, "%2B","+")
	}
	

	if (listSong != ""){
		//List song mode. List the song in the directories
		if (listSong == "all"){
			songData := [][]string{}
			for _, directory := range musicDirs{
				
				filepath.Walk(directory,
					func(path string, info os.FileInfo, err error) error {
					if err != nil {
						return err
					}
					path = filepath.ToSlash(path)
					
					if (stringInSlice(filepath.Ext(path),supportedFileExt)){
						//This is an audio file. Append to songData
						var audioFiles []string
						_, hsize, unit, _ := system_fs_getFileSize(path)
						size := fmt.Sprintf("%.2f", hsize) + unit;
						vpath, _ := realpathToVirtualpath(path, username);
						audioFiles = append(audioFiles, "/media?file=" + vpath);
						audioFiles = append(audioFiles, strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)));
						audioFiles = append(audioFiles, filepath.Ext(path)[1:]);
						audioFiles = append(audioFiles, size);
						songData = append(songData, audioFiles)
					}
					return nil
				})			
			}

			jsonString, _ := json.Marshal(songData);
			sendJSONResponse(w, string(jsonString));

		}else if (strings.Contains(listSong, "search:")){
			keyword := listSong[7:]
			songData := [][]string{}
			for _, directory := range musicDirs{
				
				filepath.Walk(directory,
					func(path string, info os.FileInfo, err error) error {
					if err != nil {
						return err
					}
					path = filepath.ToSlash(path)
					
					if (stringInSlice(filepath.Ext(path),supportedFileExt) && strings.Contains(filepath.Base(path),keyword)){
						//This is an audio file. Append to songData
						var audioFiles []string
						_, hsize, unit, _ := system_fs_getFileSize(path)
						size := fmt.Sprintf("%.2f", hsize) + unit;
						vpath, _ := realpathToVirtualpath(path, username);
						audioFiles = append(audioFiles, "/media?file=" + vpath);
						audioFiles = append(audioFiles, strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)));
						audioFiles = append(audioFiles, filepath.Ext(path)[1:]);
						audioFiles = append(audioFiles, size);
						songData = append(songData, audioFiles)
					}
					return nil
				})			
			}

			jsonString, _ := json.Marshal(songData);
			sendJSONResponse(w, string(jsonString));
		}else{
			log.Println("Work in progress")
		}
	}else if (lsDir != ""){
		//List diretory
		if (lsDir == "root"){
			var rootInfo [][]string
			for _, dir := range musicDirs{
				var thisRootInfo []string
				//thisRootInfo = append(thisRootInfo, filepath.Base(dir))
				virtualStorageRootName, err := system_storage_getRootNameByPath(dir, username)
				if (err != nil){
					thisRootInfo = append(thisRootInfo, filepath.Base(dir))
				}else{
					thisRootInfo = append(thisRootInfo, virtualStorageRootName)
				}
				
				vpath, _ := realpathToVirtualpath(dir,username);
				thisRootInfo = append(thisRootInfo, vpath + "/")
				objects, _ := filepath.Glob(dir + "/*")
				var files []string
				var folders []string
				for _, f := range objects{
					if (IsDir(f)){
						folders = append(folders, f)
					}else if (stringInSlice(filepath.Ext(f),supportedFileExt)) {
						files = append(files, f)
					}
				}
				thisRootInfo = append(thisRootInfo, strconv.Itoa(len(files)))
				thisRootInfo = append(thisRootInfo, strconv.Itoa(len(folders)))
				rootInfo = append(rootInfo, thisRootInfo)
			}
			jsonString, _ := json.Marshal(rootInfo)
			sendJSONResponse(w, string(jsonString))
		}else{
			listingTarget, _ := virtualPathToRealPath(lsDir, username);
			if (listingTarget == ""){
				//User try to leave the accessable area. Reject access.
				sendErrorResponse(w, "Permission denied")
				return;
			}
			var results [][][]string
			//List all objects in the current directory and catergorize them
			folders := []string{}
			files :=  []string{}
			//Special glob for handling path with [ or ]
			objects, _ := system_fs_specialGlob(filepath.Clean(listingTarget) + "/*")
			for _, obj := range objects{
				if (IsDir(obj)){
					folders = append(folders, obj)
				}else if (stringInSlice(filepath.Ext(obj),supportedFileExt)){
					files = append(files, obj)
				}
			}

			folderInfos := [][]string{}
			for _, folder := range folders{
				var thisFolderInfo []string
				folderName := filepath.Base(folder)
				folderPath, _ := realpathToVirtualpath(folder, username)
				filesInDir := 0;
				DirInDir := 0;
				objInDir, _ := system_fs_specialGlob(filepath.ToSlash(folder) + "/*")
				for _, obj := range objInDir{
					if (IsDir(obj)){
						DirInDir++;
					}else if (stringInSlice(filepath.Ext(obj),supportedFileExt)){
						filesInDir++;
					}
				}
				thisFolderInfo = append(thisFolderInfo, folderName)
				thisFolderInfo = append(thisFolderInfo, folderPath + "/")
				thisFolderInfo = append(thisFolderInfo, strconv.Itoa(filesInDir))
				thisFolderInfo = append(thisFolderInfo, strconv.Itoa(DirInDir))
				folderInfos = append(folderInfos, thisFolderInfo)
			}

			fileInfos := [][]string{}
			for _, file := range files{
				var thisFileInfo []string
				vfilepath, _ := realpathToVirtualpath(file, username)
				filename := filepath.Base(file)
				ext := filepath.Ext(file)[1:]
				_, hsize, unit, _ := system_fs_getFileSize(file)
				size := fmt.Sprintf("%.2f", hsize) + unit;

				thisFileInfo = append(thisFileInfo, "/media?file=" + vfilepath)
				thisFileInfo = append(thisFileInfo, filename)
				thisFileInfo = append(thisFileInfo, ext)
				thisFileInfo = append(thisFileInfo, size)
				fileInfos = append(fileInfos, thisFileInfo)
			}

			results = append(results, folderInfos)
			results = append(results, fileInfos)
			jsonString, _ := json.Marshal(results)
			sendJSONResponse(w, string(jsonString))
			
		}
	}else if (listFolder != ""){
		
	}
}

func module_airMusic_getFileInfo(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
	if (err != nil){
		sendErrorResponse(w, "User not logged in")
		return;
	}
	vpath, _ := mv(r, "filepath", false)
	
	//Strip away the access path
	if (vpath[:12] == "/media?file="){
		vpath = vpath[12:];
	}

	//Convert the virtual path to realpath
	realpath, err := virtualPathToRealPath(vpath, username)
	if (err != nil){
		sendErrorResponse(w, "Invalid filepath")
		return;
	}

	if (!fileExists(realpath)){
		sendErrorResponse(w, "File not exists")
		return;
	}

	//Buiild the information for sendout
	results := []string{}
	results = append(results, filepath.Base(realpath))
	vdir, _ := realpathToVirtualpath(filepath.Dir(realpath), username)
	results = append(results, vdir)
	rawsize, hsize, unit, _ := system_fs_getFileSize(realpath)
	size := fmt.Sprintf("%.2f", hsize) + unit;
	results = append(results, size)
	results = append(results, fmt.Sprintf("%.2f", rawsize))
	info, err := os.Stat(realpath)
	results = append(results, info.ModTime().Format("2006-01-02 15:04:05"))

	jsonString, _ := json.Marshal(results)
	sendJSONResponse(w, string(jsonString))
}

