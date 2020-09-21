package main

import (
	"path/filepath"
	"runtime"
	"os"
	"os/exec"
	"encoding/json"
	"io/ioutil"
	"strconv"
	"sort"
	"errors"
	"net/url"
	"github.com/cssivision/reverseproxy"
	"net/http"
	"log"
	"strings"
)

/*
	ArOZ Online System - Dynamic Subsystem loading services

	This module load in ArOZ Online Subservice using authorized reverse proxy channel.
	Please see the demo subservice module for more information on implementing a subservice module.
*/
var reservePaths = []string{
	"web",
	"system",
	"STDIN",
	"STDOUT",
	"STDERR",
	"COM",
	"ws",
}

type subService struct{
	Port int;									//Port that this subservice use
	ServiceDir string;							//The directory where the service is located
	Path string;								//Path that this subservice is located
	RpEndpoint string;							//Reverse Proxy Endpoint
	ProxyHandler *reverseproxy.ReverseProxy;	//Reverse Proxy Object
	Info moduleInfo;							//Module information for this subservice
	Process *exec.Cmd;							//The CMD runtime object of the process

}	

func system_subservice_init(){
	//Register url endpoints
	http.HandleFunc("/system/subservice/list", system_subservice_handleListing)
	http.HandleFunc("/system/subservice/kill", system_subservice_killSubservice)
	http.HandleFunc("/system/subservice/start", system_subservice_startSubservice)

	//Scan and load all subservice modules
	subservices, _ := filepath.Glob("./subservice/*")
	for _, servicePath := range subservices{
		if !fileExists(servicePath + "/.suspended"){
			//Only enable module with no suspended config file
			system_subservice_launch(servicePath, true);
		}
		
	}
}

//Launch a given subservice with given service path
func system_subservice_launch(servicePath string, startupMode bool) error{

	//Get the executable name from its path
	binaryname := filepath.Base(servicePath)
	serviceRoot := filepath.Base(servicePath);
	binaryExecPath := filepath.ToSlash(binaryname)
	if runtime.GOOS == "windows" {
		binaryExecPath = binaryExecPath + ".exe"
	}else if (runtime.GOOS == "linux"){
		if runtime.GOARCH == "arm" {
			binaryExecPath = binaryExecPath + "_linux_arm"
		}else if runtime.GOARCH == "arm64" {
			binaryExecPath = binaryExecPath + "_linux_arm64"
		}else if runtime.GOARCH == "386" {
			binaryExecPath = binaryExecPath + "_linux_386"
		}else if runtime.GOARCH == "amd64" {
			binaryExecPath = binaryExecPath + "_linux_amd64"
		}
	}

	if runtime.GOOS == "windows" && !fileExists(servicePath + "/" + binaryExecPath){
		if (startupMode){
			log.Fatal("Failed to load subservice: " + serviceRoot, "File not exists " + servicePath + "/" + binaryExecPath)
		}else{
			return errors.New("Failed to load subservice");
		}
	
	}else if (runtime.GOOS == "linux"){
		//Check if service installed using whereis
		cmd := exec.Command("whereis",serviceRoot)
		searchResults, err := cmd.CombinedOutput()
		if err != nil {
			if (startupMode){
				log.Fatal("Failed to load subservice: " + serviceRoot)
			}else{
				return errors.New("Failed to load subservice");
			}
		}
		searchResultsString := strings.TrimSpace(string(searchResults))
		whereIsInfo := strings.Split(searchResultsString, ":")
		if (whereIsInfo[1] == ""){
			//This is not installed. Check if it exists as a binary (aka ./myservice)
			if (!fileExists(servicePath + "/" + binaryExecPath)){
				if (startupMode){
					log.Fatal("Package not installed. " + serviceRoot)
				}else{
					return errors.New("Package not installed.");
				}
			}
		}
	}

	//Check if the suspend file exists. If yes, clear it
	if fileExists(servicePath + "/.suspended"){
		os.Remove(servicePath + "/.suspended");
	}
	
	//Check if there are config files that replace the -info tag. If yes, use it instead.
	out := []byte{}
	if (fileExists(servicePath + "/moduleInfo.json")){
		launchConfig, err := ioutil.ReadFile(servicePath + "/moduleInfo.json")
		if (err != nil){
			if (startupMode){
				log.Fatal("Failed to read moduleInfo.json: " + binaryname, err)
			}else{
				return errors.New("Failed to read moduleInfo.json: " + binaryname);
			}
			
		}
		out = launchConfig;
	}else{
		infocmd := exec.Command(servicePath + "/" + binaryExecPath, "-info")
		launchConfig, err := infocmd.CombinedOutput()
		if err != nil {
			if (startupMode){
				log.Fatal("Unable to start service: " + binaryname, err)
			}else{
				return errors.New( "Unable to start service: " + binaryname);
			}
			
		}
		out = launchConfig;
	}

	//Clean the module info and append it into the module list
	serviceLaunchInfo := strings.TrimSpace(string(out))
	thisModuleInfo := new(moduleInfo)
	err := json.Unmarshal([]byte(serviceLaunchInfo), &thisModuleInfo)
	if (err != nil){
		if (startupMode){
			log.Fatal("Failed to load subservice: " + serviceRoot + "\n", err.Error())
		}else{
			return errors.New( "Failed to load subservice: " + serviceRoot);
		}
	}
	
	thisSubService := new(subService)
	if (fileExists(servicePath + "/.noproxy")){
		//Adaptive mode. This is designed for modules that do not designed with ArOZ Online in mind.
		//Ignore proxy setup and startup the application
		absolutePath, _ := filepath.Abs(servicePath + "/" + binaryExecPath);
		if (fileExists(servicePath + "/.startscript")){
			initPath := servicePath + "/start.sh"
			if runtime.GOOS == "windows" {
				initPath = servicePath + "/start.bat"
			}

			if !fileExists(initPath){
				if (startupMode){
					log.Fatal("start.sh not found. Unable to startup service " + serviceRoot)
				}else{
					return errors.New( "start.sh not found. Unable to startup service " + serviceRoot);
				}
			}
			absolutePath, _ = filepath.Abs(initPath)
		}
		
		cmd := exec.Command(absolutePath)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Dir = filepath.ToSlash(servicePath + "/")

		//Spawn a new go routine to run this subservice
		go func(cmdObject *exec.Cmd){
			if err := cmd.Start(); err != nil {
				panic(err)
			}
		}(cmd)

		//Create the servie object
		thisSubService.Path = binaryExecPath
		thisSubService.Info = *thisModuleInfo
		thisSubService.ServiceDir = serviceRoot
		thisSubService.Process = cmd
		log.Println("[Subservice] Starting service " + serviceRoot + " in compatibility mode.")
	}else{
		//Create a proxy for this service
		//Get proxy endpoint from startDir dir
		rProxyEndpoint := filepath.Dir(thisModuleInfo.StartDir)
		//Check if this path is reversed
		if (stringInSlice(rProxyEndpoint, reservePaths) || rProxyEndpoint == ""){
			if (startupMode){
				log.Fatal(serviceRoot + " service try to request system reserve path as Reverse Proxy endpoint.")
			}else{
				return errors.New(serviceRoot + " service try to request system reserve path as Reverse Proxy endpoint.");
			}
		}

		//Assign a port for this subservice
		thisServicePort := nextPortToBeAssignedForSubService;
		nextPortToBeAssignedForSubService++;

		//Run the subservice with the given port
		absolutePath, _ := filepath.Abs(servicePath + "/" + binaryExecPath)

		if (fileExists(servicePath + "/.startscript")){
			initPath := servicePath + "/start.sh"
			if runtime.GOOS == "windows" {
				initPath = servicePath + "/start.bat"
			}

			if !fileExists(initPath){
				if (startupMode){
					log.Fatal("start.sh not found. Unable to startup service " + serviceRoot)
				}else{
					return errors.New(serviceRoot + "start.sh not found. Unable to startup service " + serviceRoot);
				}
				
			}
			absolutePath, _ = filepath.Abs(initPath)
		}

		cmd := exec.Command(absolutePath, "-port", ":" + IntToString(thisServicePort))
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Dir = filepath.ToSlash(servicePath + "/")
		//log.Println(cmd.Dir,binaryExecPath)

		//Spawn a new go routine to run this subservice
		go func(cmdObject *exec.Cmd){
			if err := cmd.Start(); err != nil {
				panic(err)
			}
		}(cmd)

		//Create a subservice object for this subservice
		thisSubService.Port = thisServicePort
		thisSubService.Path = binaryExecPath
		thisSubService.ServiceDir = serviceRoot
		thisSubService.RpEndpoint = rProxyEndpoint
		thisSubService.Info = *thisModuleInfo
		thisSubService.Process = cmd

		//Create a new proxy object
		path, _ := url.Parse("http://localhost:" + IntToString(thisServicePort))
		proxy := reverseproxy.NewReverseProxy(path)
		thisSubService.ProxyHandler = proxy
	}

	//Append this subservice into the list
	runningSubServices = append(runningSubServices, *thisSubService)
	
	//Append this module into the loaded module list
	loadedModule = append(loadedModule, *thisModuleInfo);

	return nil
}

//Check if the target is reverse proxy. If yes, return the proxy handler and the rewritten url in string
func system_subservice_checkIfReverseProxyPath(r *http.Request) (bool, *reverseproxy.ReverseProxy, string){
	requestURL := r.URL.Path;
	for _, subservice := range runningSubServices{
		thisServiceProxyEP := subservice.RpEndpoint
		if (thisServiceProxyEP != ""){
			if (len(requestURL) > len(thisServiceProxyEP) + 1 && requestURL[1:len(thisServiceProxyEP) + 1] == thisServiceProxyEP){
				//This is a proxy path. Generate the rewrite URL
				//Get all GET paramters from URL
				values := r.URL.Query()
				counter := 0
				parsedGetTail := ""
				for k, v := range values {
					if (counter == 0){
						parsedGetTail = "?" + k + "=" + v[0]
					}else{
						parsedGetTail = parsedGetTail + "&" + k + "=" + v[0]
					}
					counter++;
				}

				return true, subservice.ProxyHandler, requestURL[len(thisServiceProxyEP) + 1:] + parsedGetTail
			}
		}
	}
	return false, nil, ""
}

//Stop all the subprocess correctly
func system_subservice_handleShutdown(){
	//Handle shutdown of subprocesses. Kill all of them
	for _, subservice := range runningSubServices{
		cmd := subservice.Process
		if cmd != nil{
			if runtime.GOOS == "windows" {
				//Force kill with the power of CMD
				kill := exec.Command("TASKKILL", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
				//kill.Stderr = os.Stderr
				//kill.Stdout = os.Stdout
				kill.Run()
			}else{
				//Send sigkill to process
				cmd.Process.Kill()
			}
		}
		
	}
}

func system_subservice_handleListing(w http.ResponseWriter, r *http.Request){
	//List all subservice running in the background
	if (!system_auth_chkauth(w,r)){
		sendErrorResponse(w,"User not logged in")
		return;
	}
	type visableInfo struct{
		Port int;
		ServiceDir string;
		Path string;
		RpEndpoint string;
		ProcessID int;
		Info moduleInfo;
	}

	type disabledServiceInfo struct{
		ServiceDir string;
		Path string;
	}

	enabled := []visableInfo{};
	disabled := []disabledServiceInfo{}
	for _, thisSubservice := range runningSubServices{
		enabled = append(enabled, visableInfo{
			Port: thisSubservice.Port,
			Path: thisSubservice.Path,
			ServiceDir: thisSubservice.ServiceDir,
			RpEndpoint: thisSubservice.RpEndpoint,
			ProcessID: thisSubservice.Process.Process.Pid,
			Info: thisSubservice.Info,
		})
	}

	disabledModules, _ := filepath.Glob("subservice/*/.suspended")
	for _, modFile := range disabledModules{
		thisdsi := new(disabledServiceInfo)
		thisdsi.ServiceDir = filepath.Base(filepath.Dir(modFile))
		thisdsi.Path = filepath.Base(filepath.Dir(modFile))
		if runtime.GOOS == "windows" {
			thisdsi.Path = thisdsi.Path + ".exe"
		}
		disabled = append(disabled, *thisdsi)
	
	}



	jsonString, err := json.Marshal(struct{
		Enabled []visableInfo;
		Disabled []disabledServiceInfo;
	}{
		Enabled: enabled,
		Disabled: disabled,
	});
	if (err != nil){
		log.Println(err);
	}
	sendJSONResponse(w, string(jsonString));
}

//Kill the subservice that is currently running
func system_subservice_killSubservice(w http.ResponseWriter, r *http.Request){
	//Check if user has logged in
	if (!system_auth_chkauth(w,r)){
		sendErrorResponse(w,"User not logged in")
		return;
	}
	//Require admin permission
	if (!system_permission_checkUserIsAdmin(w,r)){
		sendErrorResponse(w, "Permission denied")
		return;
	}

	//OK. Get paramters
	serviceDir, _ := mv(r, "serviceDir", true)
	moduleName, _ := mv(r, "moduleName", true)

	//Remove them from the system
	ssi := -1;
	for i, ss := range runningSubServices{
		if (ss.ServiceDir == serviceDir){
			ssi = i
			//Kill the module cmd
			cmd := ss.Process
			if cmd != nil{
				if runtime.GOOS == "windows" {
					//Force kill with the power of CMD
					kill := exec.Command("TASKKILL", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
					kill.Run()
				}else{
					err := cmd.Process.Kill()
					if (err != nil){
						sendErrorResponse(w, err.Error())
						return;
					}
				}
			}

			//Write a suspended file into the module
			ioutil.WriteFile("subservice/" + ss.ServiceDir + "/.suspended",[]byte(""), 0755)
		}
	}

	//Pop this service from running Subservice
	if (ssi != -1){
		i := ssi
		copy(runningSubServices[i:], runningSubServices[i+1:]) 
		runningSubServices = runningSubServices[:len(runningSubServices)-1] 
	}

	//Pop the related module from the loadedModule list
	mi := -1;
	for i, m := range loadedModule{
		if (m.Name == moduleName){
			mi = i
		}
	}
	if (mi != -1){
		i := mi
		copy(loadedModule[i:], loadedModule[i+1:]) 
		loadedModule = loadedModule[:len(loadedModule)-1] 
	}

	sendOK(w)
}

func system_subservice_startSubservice(w http.ResponseWriter, r *http.Request){
	//Check if user has logged in
	if (!system_auth_chkauth(w,r)){
		sendErrorResponse(w,"User not logged in")
		return;
	}
	//Require admin permission
	if (!system_permission_checkUserIsAdmin(w,r)){
		sendErrorResponse(w, "Permission denied")
		return;
	}
	//OK. Get which dir to start
	serviceDir, _ := mv(r, "serviceDir", true)
	if (fileExists("subservice/" + serviceDir)){
		err := system_subservice_launch("subservice/" + serviceDir, false);
		if (err != nil){
			sendErrorResponse(w, err.Error())
			return;
		}
	}else{
		sendErrorResponse(w, "Subservice directory not exists.");
	}
	
	//Sort the list
	sort.Slice(loadedModule, func(i, j int) bool {
		return loadedModule[i].Name < loadedModule[j].Name
	})

	sort.Slice(runningSubServices, func(i, j int) bool {
		return runningSubServices[i].Info.Name < runningSubServices[j].Info.Name
	})

	sendOK(w)
}