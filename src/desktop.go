package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
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
		systemWideLogger.PrintAndLog("System", "Unable to create database table for Desktop. Please validation your installation.", nil)
		systemWideLogger.PrintAndLog("System", fmt.Sprint(err), nil)
		os.Exit(1)
	}

	//Register Desktop settings sub-items
	registerSetting(settingModule{
		Name:     "Wallpaper",
		Desc:     "Desktop Wallpaper Settings",
		IconPath: "SystemAO/desktop/img/personalization.png",
		Group:    "Desktop",
		StartDir: "SystemAO/desktop/settings/wallpaper.html",
	})
	registerSetting(settingModule{
		Name:     "Sounds",
		Desc:     "System Sound Settings",
		IconPath: "SystemAO/desktop/img/personalization.png",
		Group:    "Desktop",
		StartDir: "SystemAO/desktop/settings/sounds.html",
	})
	registerSetting(settingModule{
		Name:     "Theme",
		Desc:     "System Theme Color",
		IconPath: "SystemAO/desktop/img/personalization.png",
		Group:    "Desktop",
		StartDir: "SystemAO/desktop/settings/theme.html",
	})
	registerSetting(settingModule{
		Name:     "Mobile UX",
		Desc:     "Mobile Desktop Shortcuts",
		IconPath: "SystemAO/desktop/img/personalization.png",
		Group:    "Desktop",
		StartDir: "SystemAO/desktop/settings/mobile_ux.html",
	})

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
		thisFileObject.IsShared = shareManager.FileIsShared(userinfo, thisFileObject.Filepath)
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

	type PublicUserInfo struct {
		Username          string
		UserIcon          string
		UserGroups        []string
		IsAdmin           bool
		StorageQuotaTotal int64
		StorageQuotaLeft  int64
	}

	//Check if the user is requesting another user's public info
	targetUser, err := utils.GetPara(r, "target")
	if err == nil {
		//User asking for another user's desktop icon
		userIcon := ""
		searchingUser, err := userHandler.GetUserInfoFromUsername(targetUser)
		if err != nil {
			utils.SendErrorResponse(w, "User not found")
			return
		}

		//Load the profile image
		userIcon = searchingUser.GetUserIcon()

		js, _ := json.Marshal(PublicUserInfo{
			Username: searchingUser.Username,
			UserIcon: userIcon,
			IsAdmin:  searchingUser.IsAdmin(),
		})

		utils.SendJSONResponse(w, string(js))
		return
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

	rs := PublicUserInfo{
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

	//Module icons are edge to edge by design. Render a padded squircle desktop
	//icon for the web app if it does not ship one of its own, so the shortcut
	//does not end up with a fully filled icon on the desktop.
	if shortcutType == "module" {
		_, err := desktop_ensureDesktopIcon(shortcutIcon)
		if err != nil {
			systemWideLogger.PrintAndLog("Desktop", "Unable to generate desktop icon for "+shortcutIcon, err)
		}
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

/*
	Desktop Icon Generator

	A web app's module icon (the one declared in its init.agi) is designed to be
	edge to edge, which looks wrong when placed on the desktop where icons are
	expected to have padding around them. When a web app does not ship its own
	desktop_icon.png, the functions below render one on the fly: the module icon
	is scaled down and centered on top of an opaque squircle backplate, which is
	then written back into the web app folder next to the module icon.
*/

const (
	/*
		desktopIconSquircleFactor is the "squareness" factor f of the generated
		squircle backplate. The backplate is the superellipse (Lame curve)

			|x/r|^n + |y/r|^n = 1,  where n = 2 / (1 - f)

		so f = 0 renders a perfect circle, f = 0.5 the classic squircle and
		f approaching 1 approaches a plain square. Tune this value to change the
		roundness of every generated desktop icon.
	*/
	desktopIconSquircleFactor = 0.75

	//desktopIconSize is the output resolution in px of the generated
	//desktop_icon.png, matching the hand made desktop icons of the built-in apps
	desktopIconSize = 128

	//desktopIconBackplateRatio is the width of the squircle backplate relative
	//to the canvas size. The hand drawn desktop icons of the built-in web apps
	//all sit at around 0.70 of their canvas, so match that to keep the generated
	//icons the same visual size as the rest of the desktop.
	desktopIconBackplateRatio = 0.70

	//desktopIconContentRatio is the width of the module icon relative to the
	//*backplate* (not the canvas), so the backplate size can be tuned above
	//without having to re-balance the padding. The remainder is the padding
	//drawn around the icon.
	desktopIconContentRatio = 0.66

	//desktopIconSampleSteps is the supersampling grid size (n x n samples per
	//pixel) used to antialias the edge of the squircle backplate
	desktopIconSampleSteps = 4

	//desktopIconLumaThreshold is the perceived luminance (0 - 1) above which a
	//module icon counts as "bright" and gets a black backplate instead of white
	desktopIconLumaThreshold = 0.5

	//desktopIconSVGRenderSize is the resolution the SVG module icons are
	//rasterized at before being scaled down onto the backplate
	desktopIconSVGRenderSize = 512
)

// desktop_ensureDesktopIcon makes sure a desktop_icon.png exists next to the
// given module icon. moduleIconPath is a path relative to the web root, e.g.
// "Photo/img/module_icon.png". If the desktop icon is already there nothing is
// done; otherwise one is generated from the module icon and written into the
// web app folder. The web root relative path of the desktop icon is returned.
func desktop_ensureDesktopIcon(moduleIconPath string) (string, error) {
	moduleIconRel, err := desktop_resolveWebAssetPath(moduleIconPath)
	if err != nil {
		return "", err
	}

	desktopIconRel := path.Join(path.Dir(moduleIconRel), "desktop_icon.png")
	desktopIconAbs := filepath.Join("./web", filepath.FromSlash(desktopIconRel))
	if utils.FileExists(desktopIconAbs) {
		//This web app already ships a desktop icon. Nothing to do.
		return desktopIconRel, nil
	}

	if strings.EqualFold(path.Base(moduleIconRel), "desktop_icon.png") {
		//The module icon is the desktop icon we are trying to create. Bail out
		//instead of recursing on a file that does not exist.
		return "", errors.New("desktop icon not found and cannot be generated from itself")
	}

	moduleIcon, err := desktop_loadWebImage(moduleIconRel)
	if err != nil {
		return "", err
	}

	var generatedIcon bytes.Buffer
	err = png.Encode(&generatedIcon, desktop_renderDesktopIcon(moduleIcon))
	if err != nil {
		return "", err
	}

	err = os.WriteFile(desktopIconAbs, generatedIcon.Bytes(), 0775)
	if err != nil {
		return "", err
	}

	systemWideLogger.PrintAndLog("Desktop", "Generated desktop icon for "+desktopIconRel, nil)
	return desktopIconRel, nil
}

// desktop_resolveWebAssetPath cleans a user supplied web root relative asset
// path and rejects anything that tries to escape the web root.
func desktop_resolveWebAssetPath(relPath string) (string, error) {
	relPath = strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if relPath == "" {
		return "", errors.New("empty asset path")
	}

	//Cleaning against the root collapses any ".." segments trying to climb out
	//of the web root. Use path (not filepath) so this behaves the same on the
	//platforms where the OS separator is not a slash.
	cleanedPath := strings.TrimPrefix(path.Clean("/"+strings.TrimLeft(relPath, "/")), "/")
	if cleanedPath == "" || cleanedPath == "." {
		return "", errors.New("invalid asset path: " + relPath)
	}

	return cleanedPath, nil
}

// desktop_loadWebImage decodes an image stored under the web root. Both the
// raster formats used by the web apps and SVG module icons are supported.
func desktop_loadWebImage(webRelPath string) (image.Image, error) {
	imageContent, err := os.ReadFile(filepath.Join("./web", filepath.FromSlash(webRelPath)))
	if err != nil {
		return nil, err
	}

	if strings.EqualFold(path.Ext(webRelPath), ".svg") {
		return desktop_rasterizeSVG(imageContent, desktopIconSVGRenderSize)
	}

	loadedImage, _, err := image.Decode(bytes.NewReader(imageContent))
	return loadedImage, err
}

// desktop_rasterizeSVG renders an SVG into a square RGBA image of the given
// size, preserving the aspect ratio of the source viewBox.
func desktop_rasterizeSVG(svgContent []byte, renderSize int) (image.Image, error) {
	parsedIcon, err := oksvg.ReadIconStream(bytes.NewReader(svgContent))
	if err != nil {
		return nil, err
	}

	viewWidth := parsedIcon.ViewBox.W
	viewHeight := parsedIcon.ViewBox.H
	if viewWidth <= 0 || viewHeight <= 0 {
		viewWidth, viewHeight = float64(renderSize), float64(renderSize)
	}

	scale := math.Min(float64(renderSize)/viewWidth, float64(renderSize)/viewHeight)
	targetWidth := viewWidth * scale
	targetHeight := viewHeight * scale
	parsedIcon.SetTarget((float64(renderSize)-targetWidth)/2, (float64(renderSize)-targetHeight)/2, targetWidth, targetHeight)
	desktop_scaleSVGStrokes(parsedIcon, scale)

	renderedIcon := image.NewRGBA(image.Rect(0, 0, renderSize, renderSize))
	scanner := rasterx.NewScannerGV(renderSize, renderSize, renderedIcon, renderedIcon.Bounds())
	parsedIcon.Draw(rasterx.NewDasher(renderSize, renderSize, scanner), 1.0)
	return renderedIcon, nil
}

// desktop_scaleSVGStrokes multiplies the stroke widths of an SVG icon by the
// given scale factor.
//
// oksvg only applies the SetTarget transform to the path geometry: the stroke
// width handed to the rasterizer is the raw value in viewBox units. Rendering a
// 64x64 viewBox at 512px therefore leaves every stroke 8 times too thin, which
// makes line art module icons come out as hairlines. Pre-scaling the stroke
// styling to match the transform restores the intended thickness.
func desktop_scaleSVGStrokes(parsedIcon *oksvg.SvgIcon, scale float64) {
	if scale <= 0 || scale == 1 {
		return
	}

	for i := range parsedIcon.SVGPaths {
		svgPath := &parsedIcon.SVGPaths[i]
		svgPath.LineWidth *= scale
		svgPath.DashOffset *= scale
		for j := range svgPath.Dash {
			svgPath.Dash[j] *= scale
		}
	}
}

// desktop_renderDesktopIcon composites a module icon onto a padded squircle
// backplate and returns the resulting desktop icon image.
func desktop_renderDesktopIcon(moduleIcon image.Image) image.Image {
	canvas := image.NewNRGBA(image.Rect(0, 0, desktopIconSize, desktopIconSize))

	//Paint the antialiased squircle backplate
	backplateColor := desktop_pickBackplateColor(moduleIcon)
	exponent := desktop_squircleExponent(desktopIconSquircleFactor)
	center := float64(desktopIconSize) / 2
	radius := float64(desktopIconSize) * desktopIconBackplateRatio / 2
	for y := 0; y < desktopIconSize; y++ {
		for x := 0; x < desktopIconSize; x++ {
			coverage := desktop_squircleCoverage(float64(x), float64(y), center, radius, exponent)
			if coverage <= 0 {
				continue
			}
			pixelColor := backplateColor
			pixelColor.A = uint8(math.Round(float64(backplateColor.A) * coverage))
			canvas.SetNRGBA(x, y, pixelColor)
		}
	}

	//Scale the module icon into the padded content box and center it
	contentBox := int(math.Round(float64(desktopIconSize) * desktopIconBackplateRatio * desktopIconContentRatio))
	scaledIcon := desktop_scaleIconToBox(moduleIcon, contentBox)
	if scaledIcon != nil {
		offset := image.Pt((desktopIconSize-scaledIcon.Bounds().Dx())/2, (desktopIconSize-scaledIcon.Bounds().Dy())/2)
		draw.Draw(canvas, scaledIcon.Bounds().Add(offset), scaledIcon, scaledIcon.Bounds().Min, draw.Over)
	}

	return canvas
}

// desktop_scaleIconToBox resizes an icon so its longest side matches boxSize
// while keeping its aspect ratio. Returns nil for degenerate source images.
func desktop_scaleIconToBox(moduleIcon image.Image, boxSize int) image.Image {
	sourceWidth := moduleIcon.Bounds().Dx()
	sourceHeight := moduleIcon.Bounds().Dy()
	if sourceWidth <= 0 || sourceHeight <= 0 || boxSize <= 0 {
		return nil
	}

	scale := math.Min(float64(boxSize)/float64(sourceWidth), float64(boxSize)/float64(sourceHeight))
	scaledWidth := int(math.Round(float64(sourceWidth) * scale))
	scaledHeight := int(math.Round(float64(sourceHeight) * scale))
	if scaledWidth < 1 {
		scaledWidth = 1
	}
	if scaledHeight < 1 {
		scaledHeight = 1
	}

	return imaging.Resize(moduleIcon, scaledWidth, scaledHeight, imaging.Lanczos)
}

// desktop_squircleExponent converts the squircle "squareness" factor f into the
// superellipse exponent n = 2 / (1 - f).
func desktop_squircleExponent(squircleFactor float64) float64 {
	if squircleFactor < 0 {
		squircleFactor = 0
	} else if squircleFactor > 0.99 {
		//Keep the exponent finite so the math below stays well behaved
		squircleFactor = 0.99
	}
	return 2 / (1 - squircleFactor)
}

// desktop_squircleCoverage returns how much (0 - 1) of the pixel at the given
// top-left coordinates falls inside the squircle, supersampled for antialiasing.
func desktop_squircleCoverage(pixelX float64, pixelY float64, center float64, radius float64, exponent float64) float64 {
	if radius <= 0 {
		return 0
	}

	sampleStep := 1.0 / float64(desktopIconSampleSteps)
	samplesInside := 0
	for sampleY := 0; sampleY < desktopIconSampleSteps; sampleY++ {
		for sampleX := 0; sampleX < desktopIconSampleSteps; sampleX++ {
			offsetX := math.Abs(pixelX+(float64(sampleX)+0.5)*sampleStep-center) / radius
			offsetY := math.Abs(pixelY+(float64(sampleY)+0.5)*sampleStep-center) / radius
			if math.Pow(offsetX, exponent)+math.Pow(offsetY, exponent) <= 1 {
				samplesInside++
			}
		}
	}

	return float64(samplesInside) / float64(desktopIconSampleSteps*desktopIconSampleSteps)
}

// desktop_pickBackplateColor samples the theme color of a module icon and picks
// the backplate that keeps the icon readable: black behind a bright icon, white
// behind a dark one.
func desktop_pickBackplateColor(moduleIcon image.Image) color.NRGBA {
	white := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	black := color.NRGBA{R: 0, G: 0, B: 0, A: 255}

	bounds := moduleIcon.Bounds()
	lumaSum := 0.0
	weightSum := 0.0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := moduleIcon.At(x, y).RGBA()
			if a == 0 {
				//Fully transparent pixels carry no theme color
				continue
			}

			//RGBA() is alpha-premultiplied, so divide by alpha to get the real
			//channel values and weight the sample by how opaque the pixel is
			luma := (0.2126*float64(r) + 0.7152*float64(g) + 0.0722*float64(b)) / float64(a)
			alpha := float64(a) / 65535
			lumaSum += luma * alpha
			weightSum += alpha
		}
	}

	if weightSum == 0 {
		//Blank icon, fall back to the light backplate
		return white
	}

	if lumaSum/weightSum > desktopIconLumaThreshold {
		return black
	}
	return white
}
