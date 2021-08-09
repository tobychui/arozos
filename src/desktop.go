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
	"strings"

	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
)

//Desktop script initiation
func DesktopInit() {
	log.Println("Starting Desktop Services")

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Desktop",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
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
	homedir, err := userinfo.GetHomeDirectory()
	if err != nil {
		log.Println(err)
	}

	if !fileExists(filepath.Join(homedir, "Desktop")) {
		//Desktop directory not exists. Create one and copy a template desktop
		os.MkdirAll(homedir+"Desktop", 0755)
		templateFolder := "./system/desktop/template/"
		if fileExists(templateFolder) {
			templateFiles, _ := filepath.Glob(templateFolder + "*")
			for _, tfile := range templateFiles {
				input, _ := ioutil.ReadFile(tfile)
				ioutil.WriteFile(homedir+"Desktop/"+filepath.Base(tfile), input, 0755)
			}
		}
	}

}

//Return the information about the host
func desktop_hostdetailHandler(w http.ResponseWriter, r *http.Request) {
	type returnStruct struct {
		Hostname        string
		DeviceUUID      string
		BuildVersion    string
		InternalVersion string
		DeviceVendor    string
		DeviceModel     string
		VendorIcon      string
	}

	jsonString, _ := json.Marshal(returnStruct{
		Hostname:        *host_name,
		DeviceUUID:      deviceUUID,
		BuildVersion:    build_version,
		InternalVersion: internal_version,
		DeviceVendor:    deviceVendor,
		DeviceModel:     deviceModel,
		VendorIcon:      iconVendor,
	})

	sendJSONResponse(w, string(jsonString))
}

func desktop_handleShortcutRename(w http.ResponseWriter, r *http.Request) {
	//Check if the user directory already exists
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get the shortcut file that is renaming
	target, err := mv(r, "src", false)
	if err != nil {
		sendErrorResponse(w, "Invalid shortcut file path given")
		return
	}

	//Get the new name
	new, err := mv(r, "new", false)
	if err != nil {
		sendErrorResponse(w, "Invalid new name given")
		return
	}

	//Check if the file actually exists and it is on desktop
	rpath, err := userinfo.VirtualPathToRealPath(target)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	if target[:14] != "user:/Desktop/" {
		sendErrorResponse(w, "Shortcut not on desktop")
		return
	}

	if !fileExists(rpath) {
		sendErrorResponse(w, "File not exists")
		return
	}

	//OK. Change the name of the shortcut
	originalShortcut, err := ioutil.ReadFile(rpath)
	if err != nil {
		sendErrorResponse(w, "Shortcut file read failed")
		return
	}

	lines := strings.Split(string(originalShortcut), "\n")
	if len(lines) < 4 {
		//Invalid shortcut properties
		sendErrorResponse(w, "Invalid shortcut file")
		return
	}

	//Change the 2nd line to the new name
	lines[1] = new
	newShortcutContent := strings.Join(lines, "\n")
	err = ioutil.WriteFile(rpath, []byte(newShortcutContent), 0755)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	sendOK(w)
}

func desktop_listFiles(w http.ResponseWriter, r *http.Request) {
	//Check if the user directory already exists
	userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
	username := userinfo.Username

	//Initiate the user folder structure. Do nothing if the structure already exists.
	desktop_initUserFolderStructure(username)

	//List all files inside the user desktop directory
	userDesktopRealpath, _ := userinfo.VirtualPathToRealPath("user:/Desktop/")
	files, err := filepath.Glob(userDesktopRealpath + "/*")
	if err != nil {
		log.Fatal("Error. Desktop unable to load user files for :" + username)
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

	var desktopFiles []desktopObject
	for _, this := range files {
		//Always use linux convension for directory seperator
		if filepath.Base(this)[:1] == "." {
			//Skipping hidden files
			continue
		}
		this = filepath.ToSlash(this)
		thisFileObject := new(desktopObject)
		thisFileObject.Filepath, _ = userinfo.RealPathToVirtualPath(this)
		thisFileObject.Filename = filepath.Base(this)
		thisFileObject.Ext = filepath.Ext(this)
		thisFileObject.IsDir = IsDir(this)
		if thisFileObject.IsDir {
			//Check if this dir is empty
			filesInFolder, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(this)) + "/*")
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
			shortcutInfo, _ := ioutil.ReadFile(this)
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
		thisFileObject.IsShared = shareManager.FileIsShared(this)
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
	sendJSONResponse(w, string(jsonString))
}

//functions to handle desktop icon locations. Location is directly written into the center db.
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

//Set the icon location of a given filepath
func setDesktopLocationFromPath(filename string, username string, x int, y int) error {
	//You cannot directly set path of others people's deskop. Hence, fullpath needed to be parsed from auth username
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	desktoppath, _ := userinfo.VirtualPathToRealPath("user:/Desktop/")
	path := filepath.Join(desktoppath, filename)
	type iconLocation struct {
		X int
		Y int
	}

	newLocation := new(iconLocation)
	newLocation.X = x
	newLocation.Y = y

	//Check if the file exits
	if fileExists(path) == false {
		return errors.New("Given filename not exists.")
	}

	//Parse the location to json
	jsonstring, err := json.Marshal(newLocation)
	if err != nil {
		log.Fatal("Unable to parse new file location on desktop for file: " + path)
		return err
	}

	//log.Println(key,string(jsonstring))
	//Write result to database
	sysdb.Write("desktop", username+"/filelocation/"+filename, string(jsonstring))
	return nil
}

func delDesktopLocationFromPath(filename string, username string) {
	//Delete a file icon location from db
	sysdb.Delete("desktop", username+"/filelocation/"+filename)
}

//Return the user information to the client
func desktop_handleUserInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

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

	jsonString, _ := json.Marshal(returnStruct{
		Username:          userinfo.Username,
		UserIcon:          userinfo.GetUserIcon(),
		IsAdmin:           userinfo.IsAdmin(),
		UserGroups:        pgs,
		StorageQuotaTotal: userinfo.StorageQuota.GetUserStorageQuota(),
		StorageQuotaLeft:  remainingQuota,
	})
	sendJSONResponse(w, string(jsonString))
}

//Icon handling function for web endpoint
func desktop_fileLocation_handler(w http.ResponseWriter, r *http.Request) {
	get, _ := mv(r, "get", true) //Check if there are get request for a given filepath
	set, _ := mv(r, "set", true) //Check if there are any set request for a given filepath
	del, _ := mv(r, "del", true) //Delete the given filename coordinate

	if set != "" {
		//Set location with given paramter
		x := 0
		y := 0
		sx, _ := mv(r, "x", true)
		sy, _ := mv(r, "y", true)
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
			sendErrorResponse(w, err.Error())
			return
		}
		sendJSONResponse(w, string("\"OK\""))
	} else if get != "" {
		username, _ := authAgent.GetUserName(w, r)
		x, y, _ := getDesktopLocatioFromPath(get, username)
		result := []int{x, y}
		json_string, _ := json.Marshal(result)
		sendJSONResponse(w, string(json_string))
	} else if del != "" {
		username, _ := authAgent.GetUserName(w, r)
		delDesktopLocationFromPath(del, username)
	} else {
		//No argument has been set
		sendTextResponse(w, "Paramter missing.")
	}
}

////////////////////////////////   END OF DESKTOP FILE ICON HANDLER ///////////////////////////////////////////////////

func desktop_theme_handler(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	username := userinfo.Username

	//Check if the set GET paramter is set.
	targetTheme, _ := mv(r, "set", false)
	getUserTheme, _ := mv(r, "get", false)
	loadUserTheme, _ := mv(r, "load", false)
	if targetTheme == "" && getUserTheme == "" && loadUserTheme == "" {
		//List all the currnet themes in the list
		themes, err := filepath.Glob("web/img/desktop/bg/*")
		if err != nil {
			log.Fatal("Error. Unable to search bg from destkop image root. Are you sure the web data folder exists?")
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
			if IsDir(file) {
				thisTheme := new(desktopTheme)
				thisTheme.Theme = filepath.Base(file)
				bglist, _ := filepath.Glob(file + "/*")
				var thisbglist []string
				for _, bg := range bglist {
					ext := filepath.Ext(bg)
					//if (sliceutil.Contains(acceptBGFormats, ext) ){
					if stringInSlice(ext, acceptBGFormats) {
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
			log.Fatal(err)
		}
		sendJSONResponse(w, string(jsonString))
		return
	} else if getUserTheme == "true" {
		//Get the user's theme from database
		result := ""
		sysdb.Read("desktop", username+"/theme", &result)
		if result == "" {
			//This user has not set a theme yet. Use default
			sendJSONResponse(w, string("\"default\""))
			return
		} else {
			//This user already set a theme. Use its set theme
			sendJSONResponse(w, string("\""+result+"\""))
			return
		}
	} else if loadUserTheme != "" {
		//Load user theme base on folder path
		rpath, err := userinfo.VirtualPathToRealPath(loadUserTheme)
		if err != nil {
			sendErrorResponse(w, "Custom folder load failed")
			return
		}

		//Check if the folder exists
		if !fileExists(rpath) {
			sendErrorResponse(w, "Custom folder load failed")
			return
		}

		if userinfo.CanRead(loadUserTheme) == false {
			//No read permission
			sendErrorResponse(w, "Permission denied")
			return
		}

		//Scan for jpg, gif or png
		imageList := []string{}
		scanPath := filepath.ToSlash(filepath.Clean(rpath)) + "/"
		pngFiles, _ := filepath.Glob(scanPath + "*.png")
		jpgFiles, _ := filepath.Glob(scanPath + "*.jpg")
		gifFiles, _ := filepath.Glob(scanPath + "*.gif")

		//Merge all 3 slice into one image list
		imageList = append(imageList, pngFiles...)
		imageList = append(imageList, jpgFiles...)
		imageList = append(imageList, gifFiles...)

		//Convert the image list back to vpaths
		virtualImageList := []string{}
		for _, image := range imageList {
			vpath, err := userinfo.RealPathToVirtualPath(image)
			if err != nil {
				continue
			}

			virtualImageList = append(virtualImageList, vpath)
		}

		js, _ := json.Marshal(virtualImageList)
		sendJSONResponse(w, string(js))

	} else if targetTheme != "" {
		//Set the current user theme
		sysdb.Write("desktop", username+"/theme", targetTheme)
		sendJSONResponse(w, "\"OK\"")
		return
	}

}

func desktop_preference_handler(w http.ResponseWriter, r *http.Request) {
	preferenceType, _ := mv(r, "preference", false)
	value, _ := mv(r, "value", false)
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		//user not logged in. Redirect to login page.
		sendErrorResponse(w, "User not logged in")
		return
	}
	if preferenceType == "" && value == "" {
		//Invalid options. Return error reply.
		sendTextResponse(w, "Error. Undefined paramter.")
		return
	} else if preferenceType != "" && value == "" {
		//Getting config from the key.
		result := ""
		sysdb.Read("desktop", username+"/preference/"+preferenceType, &result)
		jsonString, _ := json.Marshal(result)
		sendJSONResponse(w, string(jsonString))
		return
	} else if preferenceType != "" && value != "" {
		//Setting config from the key
		sysdb.Write("desktop", username+"/preference/"+preferenceType, value)
		sendJSONResponse(w, "\"OK\"")
		return
	} else {
		sendTextResponse(w, "Error. Undefined paramter.")
		return
	}

}

func desktop_shortcutHandler(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)

	if err != nil {
		//user not logged in. Redirect to login page.
		sendErrorResponse(w, "User not logged in")
		return
	}

	userinfo, _ := userHandler.GetUserInfoFromUsername(username)

	shortcutType, err := mv(r, "stype", true)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	shortcutText, err := mv(r, "stext", true)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	shortcutPath, err := mv(r, "spath", true)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	shortcutIcon, err := mv(r, "sicon", true)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//OK to proceed. Generate a shortcut on the user desktop
	userDesktopPath, _ := userinfo.VirtualPathToRealPath("user:/Desktop")
	if !fileExists(userDesktopPath) {
		os.MkdirAll(userDesktopPath, 0755)
	}

	//Check if there are desktop icon. If yes, override icon on module
	if shortcutType == "module" && fileExists("./web/"+filepath.ToSlash(filepath.Dir(shortcutIcon)+"/desktop_icon.png")) {
		shortcutIcon = filepath.ToSlash(filepath.Join(filepath.Dir(shortcutIcon), "/desktop_icon.png"))
	}

	shortcutText = strings.ReplaceAll(shortcutText, "/", "")
	for strings.Contains(shortcutText, "../") {
		shortcutText = strings.ReplaceAll(shortcutText, "../", "")
	}
	shortcutFilename := userDesktopPath + "/" + shortcutText + ".shortcut"
	counter := 1
	for fileExists(shortcutFilename) {
		shortcutFilename = userDesktopPath + "/" + shortcutText + "(" + IntToString(counter) + ")" + ".shortcut"
		counter++
	}
	err = ioutil.WriteFile(shortcutFilename, []byte(shortcutType+"\n"+shortcutText+"\n"+shortcutPath+"\n"+shortcutIcon), 0755)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	sendOK(w)
}
