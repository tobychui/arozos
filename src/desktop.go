package main


import (
	"log"
	"net/http"
	"path/filepath"
	"errors"
	"strconv"
	"encoding/json"
	"io/ioutil"
	"strings"
	"os"
)

var (
	moduleName = "Desktop"
	version = "0.0.1"
)
//Desktop script initiation
func desktop_init(){
	log.Println("Starting Desktop Services")

	//Register all the required API
	http.HandleFunc("/system/desktop/listDesktop", desktop_listFiles);
	http.HandleFunc("/system/desktop/theme", desktop_theme_handler);
	http.HandleFunc("/system/desktop/files", desktop_fileLocation_handler);
	http.HandleFunc("/system/desktop/host", desktop_hostdetailHandler);
	http.HandleFunc("/system/desktop/preference", desktop_preference_handler);
	http.HandleFunc("/system/desktop/createShortcut", desktop_shortcutHandler);

	desktop_initDBstructure();
}


/*
	List all the files and folders on desktop and return as a json
*/


/////////////////////////////////////////////////////////////////////////////////////
/*
	FUNCTIONS RELATED TO PARSING DESKTOP FILE ICONS

	The functions in this section handle file listing and its icon locations.
*/
func desktop_initUserFolderStructure(username string){
	//Call to filesystem for creating user file struture at root dir
	system_file_initUserRoot(username);
}

//Create the database table for storing desktop objects
func desktop_initDBstructure(){
	err := system_db_newTable(sysdb, "desktop")
	if (err != nil){
		log.Fatal(err)
		os.Exit(1);
	}
}

//Return the information about the host
func desktop_hostdetailHandler(w http.ResponseWriter, r *http.Request){
	type returnStruct struct{
		Hostname string
		DeviceUUID string
		BuildVersion string
		InternalVersion string
		DeviceVendor string
		DeviceModel string
		VendorIcon string
	}

	jsonString, _ := json.Marshal(returnStruct{
		Hostname: *host_name,
		DeviceUUID:deviceUUID,
		BuildVersion: build_version,
		InternalVersion: internal_version,
		DeviceVendor: deviceVendor,
		DeviceModel: deviceModel,
		VendorIcon: iconVendor,
	});

	sendJSONResponse(w, string(jsonString))
}

func desktop_listFiles(w http.ResponseWriter, r *http.Request){
	//Check if the user directory already exists
	username, err := system_auth_getUserName(w,r)
	if (err != nil){
		//user not logged in. Redirect to login page.
		sendErrorResponse(w, "User not logged in")
		return;
	}
	//Initiate the user folder structure. Do nothing if the structure already exists.
	desktop_initUserFolderStructure(username)

	//List all files inside the user desktop directory
	userDesktopRealpath, _ := virtualPathToRealPath("user:/Desktop/", username);
	files, err := filepath.Glob(userDesktopRealpath + "/*")
	if (err != nil){
		log.Fatal("Error. Desktop unable to load user files for :" + username)
		return;
	}

	//Desktop object structure
	type desktopObject struct{
		Filepath string;
		Filename string;
		Ext string;
		IsDir bool;
		IsShortcut bool;
		ShortcutImage string;
		ShortcutType string;
		ShortcutName string;
		ShortcutPath string;
		IconX int;
		IconY int;
	}

	var desktopFiles []desktopObject;
	for _, this := range files{
		//Always use linux convension for directory seperator
		if filepath.Base(this)[:1] == "."{
			//Skipping hidden files
			continue;
		}
		this = filepath.ToSlash(this)
		thisFileObject := new(desktopObject)
		thisFileObject.Filepath, _ = realpathToVirtualpath(this,username);
		thisFileObject.Filename = filepath.Base(this)
		thisFileObject.Ext = filepath.Ext(this)
		thisFileObject.IsDir = IsDir(this)
		//Check if the file is a shortcut
		isShortcut := false;
		if (filepath.Ext(this) == ".shortcut"){
			isShortcut = true;
			shortcutInfo, _ := ioutil.ReadFile(this);
			infoSegments := strings.Split(strings.ReplaceAll(string(shortcutInfo),"\r\n","\n"),"\n");
			if (len(infoSegments) < 4){
				thisFileObject.ShortcutType = "invalid"
			}else{
				thisFileObject.ShortcutType = infoSegments[0];
				thisFileObject.ShortcutName = infoSegments[1];
				thisFileObject.ShortcutPath = infoSegments[2];
				thisFileObject.ShortcutImage = infoSegments[3];
			}
			
		}
		thisFileObject.IsShortcut = isShortcut
		//Check the file location
		username, _ := system_auth_getUserName(w,r)
		x, y, _ := getDesktopLocatioFromPath(thisFileObject.Filename, username)
		//This file already have a location on desktop
		thisFileObject.IconX = x;
		thisFileObject.IconY = y;

		desktopFiles = append(desktopFiles, *thisFileObject)
	}

	//Convert the struct to json string
	jsonString, _ := json.Marshal(desktopFiles);
	sendJSONResponse(w,string(jsonString));
}

//functions to handle desktop icon locations. Location is directly written into the center db.
func getDesktopLocatioFromPath(filename string, username string)(int, int, error){
	//As path include username, there is no different if there are username in the key
	locationdata := ""
	err := system_db_read(sysdb, "desktop",  username + "/filelocation/" + filename, &locationdata);
	if (err != nil){
		//The file location is not set. Return error
		return -1, -1, errors.New("This file do not have a location registry")
	}
	type iconLocation struct{
		X int;
		Y int;
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
func setDesktopLocationFromPath(filename string, username string, x int, y int) error{
	//You cannot directly set path of others people's deskop. Hence, fullpath needed to be parsed from auth username
	desktoppath, _ := virtualPathToRealPath("user:/Desktop/",username);
	path := desktoppath + filename;
	type iconLocation struct{
		X int;
		Y int;
	}

	newLocation := new(iconLocation)
	newLocation.X = x;
	newLocation.Y = y;

	//Check if the file exits
	if fileExists(path) == false{
		return errors.New("Given filename not exists.")
	}

	//Parse the location to json
	jsonstring, err := json.Marshal(newLocation);
	if (err != nil){
		log.Fatal("Unable to parse new file location on desktop for file: " + path)
		return err;
	}

	//log.Println(key,string(jsonstring))
	//Write result to database
	system_db_write(sysdb, "desktop" , username + "/filelocation/" + filename, string(jsonstring));
	return nil;
}	

func delDesktopLocationFromPath(filename string, username string){
	//Delete a file icon location from db
	system_db_removeValue(sysdb, "desktop/" + username + "/filelocation/" + filename);
}

//Icon handling function for web endpoint
func desktop_fileLocation_handler(w http.ResponseWriter, r *http.Request){
	get, _ := mv(r, "get", true); //Check if there are get request for a given filepath
	set, _ := mv(r, "set", true); //Check if there are any set request for a given filepath

	if (set != ""){
		//Set location with given paramter
		x := 0;
		y := 0;
		sx, _ := mv(r, "x", true);
		sy, _ := mv(r, "y", true);
		path := set

		x, err := strconv.Atoi(sx);
		if (err != nil){
			x = 0;
		}

		y, err = strconv.Atoi(sy);
		if (err != nil){
			y = 0;
		}
		
		//Set location of icon from path
		username, _ := system_auth_getUserName(w,r)
		err = setDesktopLocationFromPath(path, username, x, y);
		if (err != nil){
			sendErrorResponse(w,err.Error());
			return;
		}
		sendJSONResponse(w,string("\"OK\""));
	}else if (get != ""){
		username, _ := system_auth_getUserName(w,r)
		x, y, _ := getDesktopLocatioFromPath(get, username)
		result := []int{x, y}
		json_string, _ := json.Marshal(result);
		sendJSONResponse(w,string(json_string));
	}else{
		//No argument has been set
		sendTextResponse(w, "Paramter missing.")
	}
}	

////////////////////////////////   END OF DESKTOP FILE ICON HANDLER ///////////////////////////////////////////////////

func desktop_theme_handler(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r)
	if (err != nil){
		//user not logged in. Redirect to login page.
		redirectToLoginPage(w,r)
		return;
	}

	//Check if the set GET paramter is set.
	targetTheme, _ := mv(r,"set",false);
	getUserTheme, _ := mv(r,"get",false);
	if (targetTheme == "" && getUserTheme == ""){
		//List all the currnet themes in the list
		themes, err := filepath.Glob("web/img/desktop/bg/*")
		if (err != nil){
			log.Fatal("Error. Unable to search bg from destkop image root. Are you sure the web data folder exists?");
			return;
		}
		//Prase the results to json array
		//Tips: You must use captial letter for varable in struct that is accessable as public :)
		type desktopTheme struct{
			Theme string 
			Bglist []string
		}
		
		var desktopThemeList []desktopTheme;
		acceptBGFormats := []string{
			".jpg",
			".png",
			".gif",
		}
		for _, file := range themes{
			if (IsDir(file)){
				thisTheme := new(desktopTheme);
				thisTheme.Theme = filepath.Base(file);
				bglist, _ := filepath.Glob(file + "/*")
				var thisbglist []string;
				for _, bg := range bglist{
					ext := filepath.Ext(bg)
					//if (sliceutil.Contains(acceptBGFormats, ext) ){
					if (stringInSlice(ext, acceptBGFormats)){
						//This file extension is supported
						thisbglist = append(thisbglist, filepath.Base(bg))
					}
					
				}
				thisTheme.Bglist = thisbglist
				desktopThemeList = append(desktopThemeList, *thisTheme)
			}
		}
		
		//Return the results as JSON string
		jsonString, err := json.Marshal(desktopThemeList);
		if (err != nil){
			log.Fatal(err)
		}
		sendJSONResponse(w,string(jsonString));
		return;
	}else if (getUserTheme == "true"){
		//Get the user's theme from database
		result := ""
		system_db_read(sysdb, "desktop", username + "/theme", &result);
		if (result == ""){
			//This user has not set a theme yet. Use default 
			sendJSONResponse(w,string("\"default\""))
			return;
		}else{
			//This user already set a theme. Use its set theme
			sendJSONResponse(w,string("\"" + result + "\""))
			return;
		}
	}else if (targetTheme != ""){
		//Set the current user theme
		system_db_write(sysdb, "desktop", username + "/theme", targetTheme);
		sendJSONResponse(w,"\"OK\"")
		return;
	}

}

func desktop_preference_handler(w http.ResponseWriter, r *http.Request){
	preferenceType, _ := mv(r,"preference",false);
	value, _ := mv(r, "value",false);
	username, err := system_auth_getUserName(w,r)
	if (err != nil){
		//user not logged in. Redirect to login page.
		redirectToLoginPage(w,r)
		return;
	}
	if (preferenceType == "" && value == ""){
		//Invalid options. Return error reply.
		sendTextResponse(w, "Error. Undefined paramter.")
		return;
	}else if (preferenceType != "" && value == ""){
		//Getting config from the key.
		result := ""
		system_db_read(sysdb, "desktop",  username + "/preference/" + preferenceType, &result);
		jsonString, _ := json.Marshal(result);
		sendJSONResponse(w,string(jsonString));
		return;
	}else if (preferenceType != "" && value != ""){
		//Setting config from the key
		system_db_write(sysdb, "desktop",  username + "/preference/" + preferenceType, value);
		sendJSONResponse(w,"\"OK\"");
		return;
	}else{
		sendTextResponse(w, "Error. Undefined paramter.")
		return;
	}
	
	

}

func desktop_shortcutHandler(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r)
	if (err != nil){
		//user not logged in. Redirect to login page.
		sendErrorResponse(w, "User not logged in")
		return;
	}


	shortcutType, err := mv(r, "stype", true)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return;
	}

	shortcutText, err := mv(r, "stext", true)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return;
	}

	shortcutPath, err := mv(r, "spath", true)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return;
	}

	shortcutIcon, err := mv(r, "sicon", true)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return;
	}

	//OK to proceed. Generate a shortcut on the user desktop
	userDesktopPath, _ := virtualPathToRealPath("user:/Desktop", username)
	if !fileExists(userDesktopPath){
		os.MkdirAll(userDesktopPath, 0755)
	}

	//Check if there are desktop icon. If yes, override icon on module
	if (shortcutType == "module" && fileExists("./web/" + filepath.ToSlash(filepath.Dir(shortcutIcon) + "/desktop_icon.png"))){
		shortcutIcon = filepath.ToSlash(filepath.Dir(shortcutIcon) + "/desktop_icon.png")
	}

	shortcutText = strings.ReplaceAll(shortcutText, "/","")
	for (strings.Contains(shortcutText,"../")){
		shortcutText = strings.ReplaceAll(shortcutText, "../","")
	}
	shortcutFilename := userDesktopPath + "/" + shortcutText + ".shortcut"
	counter := 1;
	for fileExists(shortcutFilename){
		shortcutFilename = userDesktopPath + "/" + shortcutText  +  "(" + IntToString(counter) + ")" + ".shortcut"
		counter++;
	}
	err = ioutil.WriteFile(shortcutFilename, []byte(shortcutType + "\n" + shortcutText + "\n" + shortcutPath + "\n" + shortcutIcon), 0755)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}
	sendOK(w);
}
