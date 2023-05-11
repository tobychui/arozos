package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

// Desktop script initiation
func DesktopInit() {
	systemWideLogger.PrintAndLog("Desktop", "Starting Desktop Services", nil)

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Desktop",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Register all the required API
	router.HandleFunc("/system/desktop/listDesktop", desktop_listFiles)
	router.HandleFunc("/system/desktop/theme", desktop_theme_handler)
	router.HandleFunc("/system/desktop/files", desktop_fileLocation_handler)
	router.HandleFunc("/system/desktop/host", desktop_hostdetailHandler)
	router.HandleFunc("/system/desktop/user", desktop_handleUserInfo)
	router.HandleFunc("/system/desktop/preference", desktop_preference_handler)
	router.HandleFunc("/system/desktop/createShortcut", desktop_shortcutHandler)

	//API related to desktop based operations
	router.HandleFunc("/system/desktop/opr/renameShortcut", desktop_handleShortcutRename)

	//Initialize desktop database
	err := sysdb.NewTable("desktop")
	if err != nil {
		log.Println("Unable to create database table for Desktop. Please validation your installation.")
		log.Fatal(err)
		os.Exit(1)
	}

	//Register Desktop Module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Desktop",
		Desc:        "The Web Desktop experience for everyone",
		Group:       "Interface Module",
		IconPath:    "img/desktop/desktop.png",
		Version:     internal_version,
		StartDir:    "",
		SupportFW:   false,
		LaunchFWDir: "",
		SupportEmb:  false,
	})
}

/*
FUNCTIONS RELATED TO PARSING DESKTOP FILE ICONS

The functions in this section handle file listing and its icon locations.
*/
func desktop_initUserFolderStructure(username string) {
	//Call to filesystem for creating user file struture at root dir
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	userfsh, err := userinfo.GetHomeFileSystemHandler()
	if err != nil {
		systemWideLogger.PrintAndLog("Desktop", "Unable to initiate user desktop folder", err)
		return
	}

	userFsa := userfsh.FileSystemAbstraction
	userDesktopPath, _ := userFsa.VirtualPathToRealPath("user:/Desktop", userinfo.Username)
	if !userFsa.FileExists(userDesktopPath) {
		//Desktop directory not exists. Create one and copy a template desktop
		userFsa.MkdirAll(userDesktopPath, 0755)

		//Copy template file from system folder if exists
		templateFolder := "./system/desktop/template/"
		if fs.FileExists(templateFolder) {
			templateFiles, _ := filepath.Glob(templateFolder + "*")
			for _, tfile := range templateFiles {
				input, _ := os.ReadFile(tfile)
				userFsa.WriteFile(arozfs.ToSlash(filepath.Join(userDesktopPath, filepath.Base(tfile))), input, 0755)
			}
		}
	}

}

// Return the information about the host
func desktop_hostdetailHandler(w http.ResponseWriter, r *http.Request) {
	type returnStruct struct {
		Hostname        string
		DeviceUUID      string
		BuildVersion    string
		InternalVersion string
		DeviceVendor    string
		DeviceModel     string
	}

	jsonString, _ := json.Marshal(returnStruct{
		Hostname:        *host_name,
		DeviceUUID:      deviceUUID,
		BuildVersion:    build_version,
		InternalVersion: internal_version,
		DeviceVendor:    deviceVendor,
		DeviceModel:     deviceModel,
	})

	utils.SendJSONResponse(w, string(jsonString))
}

func desktop_handleShortcutRename(w http.ResponseWriter, r *http.Request) {
	//Check if the user directory already exists
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	//Get the shortcut file that is renaming
	target, err := utils.GetPara(r, "src")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid shortcut file path given")
		return
	}

	//Get the new name
	new, err := utils.GetPara(r, "new")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid new name given")
		return
	}

	fsh, subpath, _ := GetFSHandlerSubpathFromVpath(target)
	fshAbs := fsh.FileSystemAbstraction

	//Check if the file actually exists and it is on desktop
	rpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if target[:14] != "user:/Desktop/" {
		utils.SendErrorResponse(w, "Shortcut not on desktop")
		return
	}

	if !fshAbs.FileExists(rpath) {
		utils.SendErrorResponse(w, "File not exists")
		return
	}

	//OK. Change the name of the shortcut
	originalShortcut, err := fshAbs.ReadFile(rpath)
	if err != nil {
		utils.SendErrorResponse(w, "Shortcut file read failed")
		return
	}

	lines := strings.Split(string(originalShortcut), "\n")
	if len(lines) < 4 {
		//Invalid shortcut properties
		utils.SendErrorResponse(w, "Invalid shortcut file")
		return
	}

	//Change the 2nd line to the new name
	lines[1] = new
	newShortcutContent := strings.Join(lines, "\n")
	err = fshAbs.WriteFile(rpath, []byte(newShortcutContent), 0755)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func desktop_listFiles(w http.ResponseWriter, r *http.Request) {
	//Check if the user directory already exists
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "user not logged in!")
		return
	}
	username := userinfo.Username

	//Initiate the user folder structure. Do nothing if the structure already exists.
	desktop_initUserFolderStructure(username)

	//List all files inside the user desktop directory
	fsh, subpath, err := GetFSHandlerSubpathFromVpath("user:/Desktop/")
	if err != nil {
		utils.SendErrorResponse(w, "Desktop file load failed")
		return
	}
	fshAbs := fsh.FileSystemAbstraction
	userDesktopRealpath, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	files, err := fshAbs.Glob(userDesktopRealpath + "/*")
	if err != nil {
		utils.SendErrorResponse(w, "Desktop file load failed")
		return
	}

	//Desktop object structure
	type desktopObject struct {
		Filepath      string
		Filename      string
		Ext           string
		IsDir         bool
		IsEmptyDir    bool
		IsShortcut    bool
		IsShared      bool
		ShortcutImage string
		ShortcutType  string
		ShortcutName  string
		ShortcutPath  string
		IconX         int
		IconY         int
	}

	desktopFiles := []desktopObject{}
	for _, this := range files {
		//Always use linux convension for directory seperator
		if filepath.Base(this)[:1] == "." {
			//Skipping hidden files
			continue
		}
		this = filepath.ToSlash(this)
		thisFileObject := new(desktopObject)
		thisFileObject.Filepath, _ = fshAbs.RealPathToVirtualPath(this, userinfo.Username)
		thisFileObject.Filename = filepath.Base(this)
		thisFileObject.Ext = filepath.Ext(this)
		thisFileObject.IsDir = fshAbs.IsDir(this)
		if thisFileObject.IsDir {
			//Check if this dir is empty
			filesInFolder, _ := fshAbs.Glob(filepath.ToSlash(filepath.Clean(this)) + "/*")
			fc := 0
			for _, f := range filesInFolder {
				if filepath.Base(f)[:1] != "." {
					fc++
				}
			}
			if fc > 0 {
				thisFileObject.IsEmptyDir = false
			} else {
				thisFileObject.IsEmptyDir = true
			}
		} else {
			//File object. Default true
			thisFileObject.IsEmptyDir = true
		}
		//Check if the file is a shortcut
		isShortcut := false
		if filepath.Ext(this) == ".shortcut" {
			isShortcut = true
			shortcutInfo, _ := fshAbs.ReadFile(this)
			infoSegments := strings.Split(strings.ReplaceAll(string(shortcutInfo), "\r\n", "\n"), "\n")
			if len(infoSegments) < 4 {
				thisFileObject.ShortcutType = "invalid"
			} else {
				thisFileObject.ShortcutType = infoSegments[0]
				thisFileObject.ShortcutName = infoSegments[1]
				thisFileObject.ShortcutPath = infoSegments[2]
				thisFileObject.ShortcutImage = infoSegments[3]
			}

		}
		thisFileObject.IsShortcut = isShortcut

		//Check if this file is shared
		thisFileObject.IsShared = shareManager.FileIsShared(userinfo, this)
		//Check the file location
		username, _ := authAgent.GetUserName(w, r)
		x, y, _ := getDesktopLocatioFromPath(thisFileObject.Filename, username)
		//This file already have a location on desktop
		thisFileObject.IconX = x
		thisFileObject.IconY = y

		desktopFiles = append(desktopFiles, *thisFileObject)
	}

	//Convert the struct to json string
	jsonString, _ := json.Marshal(desktopFiles)
	utils.SendJSONResponse(w, string(jsonString))
}

// functions to handle desktop icon locations. Location is directly written into the center db.
func getDesktopLocatioFromPath(filename string, username string) (int, int, error) {
	//As path include username, there is no different if there are username in the key
	locationdata := ""
	err := sysdb.Read("desktop", username+"/filelocation/"+filename, &locationdata)
	if err != nil {
		//The file location is not set. Return error
		return -1, -1, errors.New("This file do not have a location registry")
	}
	type iconLocation struct {
		X int
		Y int
	}
	thisFileLocation := iconLocation{
		X: -1,
		Y: -1,
	}
	//Start parsing the from the json data
	json.Unmarshal([]byte(locationdata), &thisFileLocation)
	return thisFileLocation.X, thisFileLocation.Y, nil
}

// Set the icon location of a given filepath
func setDesktopLocationFromPath(filename string, username string, x int, y int) error {
	//You cannot directly set path of others people's deskop. Hence, fullpath needed to be parsed from auth username
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	fsh, subpath, _ := GetFSHandlerSubpathFromVpath("user:/Desktop/")
	fshAbs := fsh.FileSystemAbstraction
	desktoppath, _ := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	path := filepath.Join(desktoppath, filename)
	type iconLocation struct {
		X int
		Y int
	}

	newLocation := new(iconLocation)
	newLocation.X = x
	newLocation.Y = y

	//Check if the file exits
	if !fshAbs.FileExists(path) {
		return errors.New("Given filename not exists.")
	}

	//Parse the location to json
	jsonstring, err := json.Marshal(newLocation)
	if err != nil {
		systemWideLogger.PrintAndLog("Desktop", "Unable to parse new file location on desktop for file: "+path, err)
		return err
	}

	//systemWideLogger.PrintAndLog(key,string(jsonstring),nil)
	//Write result to database
	sysdb.Write("desktop", username+"/filelocation/"+filename, string(jsonstring))
	return nil
}

func delDesktopLocationFromPath(filename string, username string) {
	//Delete a file icon location from db
	sysdb.Delete("desktop", username+"/filelocation/"+filename)
}

// Return the user information to the client
func desktop_handleUserInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	nic, _ := utils.PostPara(r, "noicon")
	noicon := (nic == "true")

	type returnStruct struct {
		Username          string
		UserIcon          string
		UserGroups        []string
		IsAdmin           bool
		StorageQuotaTotal int64
		StorageQuotaLeft  int64
	}

	//Calculate the storage quota left
	remainingQuota := userinfo.StorageQuota.TotalStorageQuota - userinfo.StorageQuota.UsedStorageQuota
	if userinfo.StorageQuota.TotalStorageQuota == -1 {
		remainingQuota = -1
	}

	//Get the list of user permission group names
	pgs := []string{}
	for _, pg := range userinfo.GetUserPermissionGroup() {
		pgs = append(pgs, pg.Name)
	}

	rs := returnStruct{
		Username:          userinfo.Username,
		UserIcon:          userinfo.GetUserIcon(),
		IsAdmin:           userinfo.IsAdmin(),
		UserGroups:        pgs,
		StorageQuotaTotal: userinfo.StorageQuota.GetUserStorageQuota(),
		StorageQuotaLeft:  remainingQuota,
	}

	if noicon {
		rs.UserIcon = ""
	}

	jsonString, _ := json.Marshal(rs)
	utils.SendJSONResponse(w, string(jsonString))
}

// Icon handling function for web endpoint
func desktop_fileLocation_handler(w http.ResponseWriter, r *http.Request) {
	get, _ := utils.PostPara(r, "get") //Check if there are get request for a given filepath
	set, _ := utils.PostPara(r, "set") //Check if there are any set request for a given filepath
	del, _ := utils.PostPara(r, "del") //Delete the given filename coordinate

	if set != "" {
		//Set location with given paramter
		x := 0
		y := 0
		sx, _ := utils.PostPara(r, "x")
		sy, _ := utils.PostPara(r, "y")
		path := set

		x, err := strconv.Atoi(sx)
		if err != nil {
			x = 0
		}

		y, err = strconv.Atoi(sy)
		if err != nil {
			y = 0
		}

		//Set location of icon from path
		username, _ := authAgent.GetUserName(w, r)
		err = setDesktopLocationFromPath(path, username, x, y)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendJSONResponse(w, string("\"OK\""))
	} else if get != "" {
		username, _ := authAgent.GetUserName(w, r)
		x, y, _ := getDesktopLocatioFromPath(get, username)
		result := []int{x, y}
		json_string, _ := json.Marshal(result)
		utils.SendJSONResponse(w, string(json_string))
	} else if del != "" {
		username, _ := authAgent.GetUserName(w, r)
		delDesktopLocationFromPath(del, username)
	} else {
		//No argument has been set
		utils.SendJSONResponse(w, "Paramter missing.")
	}
}

////////////////////////////////   END OF DESKTOP FILE ICON HANDLER ///////////////////////////////////////////////////

func desktop_theme_handler(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	username := userinfo.Username

	//Check if the set GET paramter is set.
	targetTheme, _ := utils.GetPara(r, "set")
	getUserTheme, _ := utils.GetPara(r, "get")
	loadUserTheme, _ := utils.GetPara(r, "load")
	if targetTheme == "" && getUserTheme == "" && loadUserTheme == "" {
		//List all the currnet themes in the list
		themes, err := filepath.Glob("web/img/desktop/bg/*")
		if err != nil {
			systemWideLogger.PrintAndLog("Desktop", "Unable to search bg from destkop image root. Are you sure the web data folder exists?", err)
			return
		}
		//Prase the results to json array
		//Tips: You must use captial letter for varable in struct that is accessable as public :)
		type desktopTheme struct {
			Theme  string
			Bglist []string
		}

		var desktopThemeList []desktopTheme
		acceptBGFormats := []string{
			".jpg",
			".png",
			".gif",
		}
		for _, file := range themes {
			if fs.IsDir(file) {
				thisTheme := new(desktopTheme)
				thisTheme.Theme = filepath.Base(file)
				bglist, _ := filepath.Glob(file + "/*")
				var thisbglist []string
				for _, bg := range bglist {
					ext := filepath.Ext(bg)
					//if (sliceutil.Contains(acceptBGFormats, ext) ){
					if utils.StringInArray(acceptBGFormats, ext) {
						//This file extension is supported
						thisbglist = append(thisbglist, filepath.Base(bg))
					}

				}
				thisTheme.Bglist = thisbglist
				desktopThemeList = append(desktopThemeList, *thisTheme)
			}
		}

		//Return the results as JSON string
		jsonString, err := json.Marshal(desktopThemeList)
		if err != nil {
			systemWideLogger.PrintAndLog("Desktop", "Unable to render desktop wallpaper list", err)
			utils.SendJSONResponse(w, string("[]"))
			return
		}
		utils.SendJSONResponse(w, string(jsonString))
		return
	} else if getUserTheme == "true" {
		//Get the user's theme from database
		result := ""
		sysdb.Read("desktop", username+"/theme", &result)
		if result == "" {
			//This user has not set a theme yet. Use default
			utils.SendJSONResponse(w, string("\"default\""))
			return
		} else {
			//This user already set a theme. Use its set theme
			utils.SendJSONResponse(w, string("\""+result+"\""))
			return
		}
	} else if loadUserTheme != "" {
		//Load user theme base on folder path
		targetFsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(loadUserTheme)
		if err != nil {
			utils.SendErrorResponse(w, "Unable to resolve user root path")
			return
		}

		fshAbs := targetFsh.FileSystemAbstraction
		rpath, err := fshAbs.VirtualPathToRealPath(loadUserTheme, userinfo.Username)
		if err != nil {
			utils.SendErrorResponse(w, "Custom folder load failed")
			return
		}

		//Check if the folder exists
		if !fshAbs.FileExists(rpath) {
			utils.SendErrorResponse(w, "Custom folder load failed")
			return
		}

		if !userinfo.CanRead(loadUserTheme) {
			//No read permission
			utils.SendErrorResponse(w, "Permission denied")
			return
		}

		//Scan for jpg, gif or png
		imageList := []string{}
		/*
			scanPath := filepath.ToSlash(filepath.Clean(rpath)) + "/"
			pngFiles, _ := filepath.Glob(scanPath + "*.png")
			jpgFiles, _ := filepath.Glob(scanPath + "*.jpg")
			gifFiles, _ := filepath.Glob(scanPath + "*.gif")

			//Merge all 3 slice into one image list
			imageList = append(imageList, pngFiles...)
			imageList = append(imageList, jpgFiles...)
			imageList = append(imageList, gifFiles...)
		*/

		files, err := fshAbs.ReadDir(rpath)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		for _, file := range files {
			ext := filepath.Ext(file.Name())
			if utils.StringInArray([]string{".png", ".jpg", ".gif"}, ext) {
				imageList = append(imageList, arozfs.ToSlash(filepath.Join(rpath, file.Name())))
			}
		}

		//Convert the image list back to vpaths
		virtualImageList := []string{}
		for _, image := range imageList {
			vpath, err := fshAbs.RealPathToVirtualPath(image, userinfo.Username)
			if err != nil {
				continue
			}

			virtualImageList = append(virtualImageList, vpath)
		}

		js, _ := json.Marshal(virtualImageList)
		utils.SendJSONResponse(w, string(js))

	} else if targetTheme != "" {
		//Set the current user theme
		sysdb.Write("desktop", username+"/theme", targetTheme)
		utils.SendJSONResponse(w, "\"OK\"")
		return
	}

}

func desktop_preference_handler(w http.ResponseWriter, r *http.Request) {
	preferenceType, _ := utils.PostPara(r, "preference")
	value, _ := utils.PostPara(r, "value")
	remove, _ := utils.PostPara(r, "remove")
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		//user not logged in. Redirect to login page.
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	if preferenceType == "" && value == "" {
		//Invalid options. Return error reply.
		utils.SendErrorResponse(w, "Error. Undefined paramter.")
		return
	} else if preferenceType != "" && value == "" && remove == "" {
		//Getting config from the key.
		result := ""
		sysdb.Read("desktop", username+"/preference/"+preferenceType, &result)
		jsonString, _ := json.Marshal(result)
		utils.SendJSONResponse(w, string(jsonString))
		return
	} else if preferenceType != "" && value == "" && remove == "true" {
		//Remove mode
		sysdb.Delete("desktop", username+"/preference/"+preferenceType)
		utils.SendOK(w)
		return
	} else if preferenceType != "" && value != "" {
		//Setting config from the key
		sysdb.Write("desktop", username+"/preference/"+preferenceType, value)
		utils.SendOK(w)
		return
	} else {
		utils.SendErrorResponse(w, "Error. Undefined paramter.")
		return
	}

}

func desktop_shortcutHandler(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//user not logged in. Redirect to login page.
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	shortcutType, err := utils.PostPara(r, "stype")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	shortcutText, err := utils.PostPara(r, "stext")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	shortcutPath, err := utils.PostPara(r, "spath")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	shortcutIcon, err := utils.PostPara(r, "sicon")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	shortcutCreationDest, err := utils.PostPara(r, "sdest")
	if err != nil {
		//Default create on desktop
		shortcutCreationDest = "user:/Desktop/"
	}

	if !userinfo.CanWrite(shortcutCreationDest) {
		utils.SendErrorResponse(w, "Permission denied")
		return
	}

	//Resolve vpath to fsh and subpath
	fsh, subpath, err := GetFSHandlerSubpathFromVpath(shortcutCreationDest)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	fshAbs := fsh.FileSystemAbstraction

	shorcutRealDest, err := fshAbs.VirtualPathToRealPath(subpath, userinfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Filter illegal characters in the shortcut filename
	shortcutText = arozfs.FilterIllegalCharInFilename(shortcutText, " ")

	//If dest not exists, create it
	if !fshAbs.FileExists(shorcutRealDest) {
		fshAbs.MkdirAll(shorcutRealDest, 0755)
	}

	//Generate a filename for the shortcut
	shortcutFilename := shorcutRealDest + "/" + shortcutText + ".shortcut"
	counter := 1
	for fshAbs.FileExists(shortcutFilename) {
		shortcutFilename = shorcutRealDest + "/" + shortcutText + "(" + strconv.Itoa(counter) + ")" + ".shortcut"
		counter++
	}

	//Write the shortcut to file
	shortcutContent := shortcut.GenerateShortcutBytes(shortcutPath, shortcutType, shortcutText, shortcutIcon)
	err = fshAbs.WriteFile(shortcutFilename, shortcutContent, 0775)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
