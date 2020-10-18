package main

import (
	"net/http"
	"encoding/json"
	"runtime"
	"strings"
	"log"
	"io/ioutil"
)

/*
	System Boot Configuration Module

	This module handle the boot flags and settings of the booting paramters
*/

type bootConfigParamters struct {
	Hostname                string 	`json:"Hostname"`
	ListenPort              int 	`json:"ListenPort"`
	MaxUpload               int 	`json:"MaxUpload"`
	UploadBuffer            int 	`json:"UploadBuffer"`
	FileIOBuf               int 	`json:"FileIOBuf"`
	EnableUPnP				bool 	`json:"EnableUPnP,omitempty"`
	AllowHardwareMan        bool   	`json:"AllowHardwareMan"`
	AllowPackageAutoInstall bool   	`json:"AllowPackageAutoInstall"`
	DisableIPResolve        bool   	`json:"DisableIPResolve"`
	IsWindows               bool  	`json:"IsWindows,omitempty"`
}

func system_boot_init(){

	//Register Endpoints
	http.HandleFunc("/system/boot/generateBootConfig", system_boot_generateBootConfig)
	http.HandleFunc("/system/boot/getCurrentBootConfig", system_boot_getCurrentBootConfig)

	//Register Settings
	registerSetting(settingModule{
		Name:         "Boot Config",
		Desc:         "Setup Boot Modes and Flags",
		IconPath:     "SystemAO/boot/img/boot.png",
		Group:        "Advance",
		StartDir:     "SystemAO/boot/bootflags.html",
		RequireAdmin: true,
	})

}

func system_boot_generateBootConfig(w http.ResponseWriter, r *http.Request) {
	isAdmin := system_permission_checkUserIsAdmin(w,r);
	if !isAdmin{
		sendErrorResponse(w, "Permission Denied")
		return
	}

	configs, err := mv(r, "config", true)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	//Decode config file
	configs = system_fs_specialURIDecode(configs)

	//Generate the boot script from the given paramters
	parsedConfig := new(bootConfigParamters);
	err = json.Unmarshal([]byte(configs), &parsedConfig)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	log.Println("Warning! Boot configuration updated!")

	commandSlice := []string{
		"-hostname", 
		"\"" + parsedConfig.Hostname + "\"",
		"-port",
		IntToString(parsedConfig.ListenPort),
		"-max_upload_size",
		IntToString(parsedConfig.MaxUpload),
		"-upload_buf",
		IntToString(parsedConfig.UploadBuffer),
		"-iobuf",
		IntToString(parsedConfig.FileIOBuf),
	}

	if !parsedConfig.AllowHardwareMan{
		commandSlice = append(commandSlice, "-enable_hwman=false")
	}

	if !parsedConfig.AllowPackageAutoInstall{
		commandSlice = append(commandSlice, "-allow_pkg_install=false")
	}

	if parsedConfig.DisableIPResolve{
		commandSlice = append(commandSlice, "-disable_ip_resolver=true")
	}
		

	execpath := strings.Join(commandSlice, " ")

	//Replace all odd things like && and || and & etc
	if (strings.Contains(execpath, "&&") || strings.Contains(execpath, "||") || strings.Contains(execpath, "&") || strings.Contains(execpath, ">")){
		sendErrorResponse(w, "Configuration contains invalid characters")
		return
	}

	//Generate the corrisponding scrip file
	binaryPath := ""
	scriptName := "start.sh"
	if runtime.GOOS == "windows" {
		binaryPath = "aroz_online_windows_amd64.exe"
		scriptName = "start.bat"
	} else if runtime.GOOS == "linux" {
		if runtime.GOARCH == "arm" {
			binaryPath = "aroz_online_linux_arm"
		}else if runtime.GOARCH == "arm64" {
			binaryPath = "aroz_online_linux_arm64"
		}else if runtime.GOARCH == "386" {
			binaryPath = "aroz_online_windows_386"
		}else if runtime.GOARCH == "amd64" {
			binaryPath = "aroz_online_linux_amd64"
		}
	}

	//Build the final start script
	execpath =  binaryPath + " " + execpath
	if runtime.GOOS == "windows" {
		err = ioutil.WriteFile(scriptName, []byte(execpath), 0755)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
	}else{
		//Append other services to the script
		scriptContent := "#/bin/bash\nsudo " + execpath
		err = ioutil.WriteFile(scriptName, []byte(scriptContent), 0755)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
	}

	sendOK(w)
	
}

//Get the current booting flags (Only those for basic users)
func system_boot_getCurrentBootConfig(w http.ResponseWriter, r *http.Request){
	isAdmin := system_permission_checkUserIsAdmin(w,r);
	if !isAdmin{
		sendErrorResponse(w, "Permission Denied")
		return
	}

	isWindows := false;
	if runtime.GOOS == "windows" {
        isWindows = true
    }

	//Create a struct for the current booting options
	jsonString, _ := json.Marshal(bootConfigParamters{
		ListenPort: *listen_port,
		Hostname: *host_name,
		EnableUPnP: *allow_upnp,
		MaxUpload: *max_upload,
		UploadBuffer: *upload_buf,
		FileIOBuf: *file_opr_buff,
		AllowHardwareMan: *allow_hardware_management,
		AllowPackageAutoInstall: *allow_package_autoInstall,
		DisableIPResolve: *disable_ip_resolve_services,
		IsWindows: isWindows,
	})

	sendJSONResponse(w, string(jsonString))

}