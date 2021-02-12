package subservice

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	modules "imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/network/reverseproxy"
	"imuslab.com/arozos/mod/network/websocketproxy"
	user "imuslab.com/arozos/mod/user"
)

/*
	ArOZ Online System - Dynamic Subsystem loading services
	author: tobychui

	This module load in ArOZ Online Subservice using authorized reverse proxy channel.
	Please see the demo subservice module for more information on implementing a subservice module.
*/

type SubService struct {
	Port         int                        //Port that this subservice use
	ServiceDir   string                     //The directory where the service is located
	Path         string                     //Path that this subservice is located
	RpEndpoint   string                     //Reverse Proxy Endpoint
	ProxyHandler *reverseproxy.ReverseProxy //Reverse Proxy Object
	Info         modules.ModuleInfo         //Module information for this subservice
	Process      *exec.Cmd                  //The CMD runtime object of the process
}

type SubServiceRouter struct {
	ReservePaths      []string
	RunningSubService []SubService
	BasePort          int

	listenPort    int
	userHandler   *user.UserHandler
	moduleHandler *modules.ModuleHandler
}

func NewSubServiceRouter(ReservePaths []string, basePort int, userHandler *user.UserHandler, moduleHandler *modules.ModuleHandler, parentPort int) *SubServiceRouter {
	return &SubServiceRouter{
		ReservePaths:      ReservePaths,
		RunningSubService: []SubService{},
		BasePort:          basePort,

		listenPort:    parentPort,
		userHandler:   userHandler,
		moduleHandler: moduleHandler,
	}
}

//Load and start all the subservices inside this rootpath
func (sr *SubServiceRouter) LoadSubservicesFromRootPath(rootpath string) {
	scanningPath := filepath.ToSlash(filepath.Clean(rootpath)) + "/*"

	subservices, _ := filepath.Glob(scanningPath)
	for _, servicePath := range subservices {
		if !fileExists(servicePath + "/.disabled") {
			//Only enable module with no suspended config file
			err := sr.Launch(servicePath, true)
			if err != nil {
				log.Println(err)
			}
		}

	}
}

func (sr *SubServiceRouter) Launch(servicePath string, startupMode bool) error {

	//Get the executable name from its path
	binaryname := filepath.Base(servicePath)
	serviceRoot := filepath.Base(servicePath)
	binaryExecPath := filepath.ToSlash(binaryname)
	if runtime.GOOS == "windows" {
		binaryExecPath = binaryExecPath + ".exe"
	} else {
		binaryExecPath = binaryExecPath + "_" + runtime.GOOS + "_" + runtime.GOARCH
	}

	/*if runtime.GOOS == "linux" {
		if runtime.GOARCH == "arm" {
			binaryExecPath = binaryExecPath + "_linux_arm"
		} else if runtime.GOARCH == "arm64" {
			binaryExecPath = binaryExecPath + "_linux_arm64"
		} else if runtime.GOARCH == "386" {
			binaryExecPath = binaryExecPath + "_linux_386"
		} else if runtime.GOARCH == "amd64" {
			binaryExecPath = binaryExecPath + "_linux_amd64"
		}
	} else if runtime.GOOS == "darwin" {

	}
	*/

	if runtime.GOOS == "windows" && !fileExists(servicePath+"/"+binaryExecPath) {
		if startupMode {
			log.Println("Failed to load subservice: "+serviceRoot, " File not exists "+servicePath+"/"+binaryExecPath+". Skipping this service")
			return errors.New("Failed to load subservice")
		} else {
			return errors.New("Failed to load subservice")
		}

	} else if runtime.GOOS == "linux" {
		//Check if service installed using whereis
		cmd := exec.Command("whereis", serviceRoot)
		searchResults, err := cmd.CombinedOutput()
		if err != nil {
			if startupMode {
				log.Println("Failed to load subservice: " + serviceRoot)
				return errors.New("Failed to load subservice: " + err.Error())
			} else {
				return errors.New("Failed to load subservice: " + err.Error())
			}
		}
		searchResultsString := strings.TrimSpace(string(searchResults))
		whereIsInfo := strings.Split(searchResultsString, ":")
		if whereIsInfo[1] == "" {
			//This is not installed. Check if it exists as a binary (aka ./myservice)
			if !fileExists(servicePath + "/" + binaryExecPath) {
				if startupMode {
					log.Println("Package not installed. " + serviceRoot)
					return errors.New("Failed to load subservice: Package not installed")
				} else {
					return errors.New("Package not installed.")
				}
			}
		}
	} else if runtime.GOOS == "darwin" {
		//Skip the whereis approach that linux use
		if !fileExists(servicePath + "/" + binaryExecPath) {
			log.Println("Failed to load subservice: "+serviceRoot, " File not exists "+servicePath+"/"+binaryExecPath+". Skipping this service")
			return errors.New("Failed to load subservice")
		}
	}

	//Check if the suspend file exists. If yes, clear it
	if fileExists(servicePath + "/.disabled") {
		os.Remove(servicePath + "/.disabled")
	}

	//Check if there are config files that replace the -info tag. If yes, use it instead.
	out := []byte{}
	if fileExists(servicePath + "/moduleInfo.json") {
		launchConfig, err := ioutil.ReadFile(servicePath + "/moduleInfo.json")
		if err != nil {
			if startupMode {
				log.Fatal("Failed to read moduleInfo.json: "+binaryname, err)
			} else {
				return errors.New("Failed to read moduleInfo.json: " + binaryname)
			}

		}
		out = launchConfig
	} else {
		infocmd := exec.Command(servicePath+"/"+binaryExecPath, "-info")
		launchConfig, err := infocmd.CombinedOutput()
		if err != nil {
			log.Println("*Subservice* startup flag -info return no JSON string and moduleInfo.json does not exists.")
			if startupMode {
				log.Fatal("Unable to start service: "+binaryname, err)
			} else {
				return errors.New("Unable to start service: " + binaryname)
			}

		}
		out = launchConfig
	}

	//Clean the module info and append it into the module list
	serviceLaunchInfo := strings.TrimSpace(string(out))
	thisModuleInfo := modules.ModuleInfo{}
	err := json.Unmarshal([]byte(serviceLaunchInfo), &thisModuleInfo)
	if err != nil {
		if startupMode {
			log.Fatal("Failed to load subservice: "+serviceRoot+"\n", err.Error())
		} else {
			return errors.New("Failed to load subservice: " + serviceRoot)
		}
	}

	var thisSubService SubService
	if fileExists(servicePath + "/.noproxy") {
		//Adaptive mode. This is designed for modules that do not designed with ArOZ Online in mind.
		//Ignore proxy setup and startup the application
		absolutePath, _ := filepath.Abs(servicePath + "/" + binaryExecPath)
		if fileExists(servicePath + "/.startscript") {
			initPath := servicePath + "/start.sh"
			if runtime.GOOS == "windows" {
				initPath = servicePath + "/start.bat"
			}

			if !fileExists(initPath) {
				if startupMode {
					log.Fatal("start.sh not found. Unable to startup service " + serviceRoot)
				} else {
					return errors.New("start.sh not found. Unable to startup service " + serviceRoot)
				}
			}
			absolutePath, _ = filepath.Abs(initPath)
		}

		cmd := exec.Command(absolutePath)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Dir = filepath.ToSlash(servicePath + "/")

		//Spawn a new go routine to run this subservice
		go func(cmdObject *exec.Cmd) {
			if err := cmd.Start(); err != nil {
				panic(err)
			}
		}(cmd)

		//Create the servie object
		thisSubService = SubService{
			Path:       binaryExecPath,
			Info:       thisModuleInfo,
			ServiceDir: serviceRoot,
			Process:    cmd,
		}
		log.Println("[Subservice] Starting service " + serviceRoot + " in compatibility mode.")
	} else {
		//Create a proxy for this service
		//Get proxy endpoint from startDir dir
		rProxyEndpoint := filepath.Dir(thisModuleInfo.StartDir)
		//Check if this path is reversed
		if stringInSlice(rProxyEndpoint, sr.ReservePaths) || rProxyEndpoint == "" {
			if startupMode {
				log.Fatal(serviceRoot + " service try to request system reserve path as Reverse Proxy endpoint.")
			} else {
				return errors.New(serviceRoot + " service try to request system reserve path as Reverse Proxy endpoint.")
			}
		}

		//Assign a port for this subservice
		thisServicePort := sr.GetNextUsablePort()

		//Run the subservice with the given port
		absolutePath, _ := filepath.Abs(servicePath + "/" + binaryExecPath)

		if fileExists(servicePath + "/.startscript") {
			initPath := servicePath + "/start.sh"
			if runtime.GOOS == "windows" {
				initPath = servicePath + "/start.bat"
			}

			if !fileExists(initPath) {
				if startupMode {
					log.Fatal("start.sh not found. Unable to startup service " + serviceRoot)
				} else {
					return errors.New(serviceRoot + "start.sh not found. Unable to startup service " + serviceRoot)
				}

			}
			absolutePath, _ = filepath.Abs(initPath)
		}

		cmd := exec.Command(absolutePath, "-port", ":"+intToString(thisServicePort), "-rpt", "http://localhost:"+intToString(sr.listenPort)+"/api/ajgi/interface")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Dir = filepath.ToSlash(servicePath + "/")
		//log.Println(cmd.Dir,binaryExecPath)

		//Spawn a new go routine to run this subservice
		go func(cmdObject *exec.Cmd) {
			if err := cmd.Start(); err != nil {
				panic(err)
			}
		}(cmd)

		//Create a subservice object for this subservice
		thisSubService = SubService{
			Port:       thisServicePort,
			Path:       binaryExecPath,
			ServiceDir: serviceRoot,
			RpEndpoint: rProxyEndpoint,
			Info:       thisModuleInfo,
			Process:    cmd,
		}

		//Create a new proxy object
		path, _ := url.Parse("http://localhost:" + intToString(thisServicePort))
		proxy := reverseproxy.NewReverseProxy(path)
		thisSubService.ProxyHandler = proxy
	}

	//Append this subservice into the list
	sr.RunningSubService = append(sr.RunningSubService, thisSubService)

	//Append this module into the loaded module list
	sr.moduleHandler.LoadedModule = append(sr.moduleHandler.LoadedModule, thisModuleInfo)

	return nil
}

func (sr *SubServiceRouter) HandleListing(w http.ResponseWriter, r *http.Request) {
	//List all subservice running in the background
	type visableInfo struct {
		Port       int
		ServiceDir string
		Path       string
		RpEndpoint string
		ProcessID  int
		Info       modules.ModuleInfo
	}

	type disabledServiceInfo struct {
		ServiceDir string
		Path       string
	}

	enabled := []visableInfo{}
	disabled := []disabledServiceInfo{}
	for _, thisSubservice := range sr.RunningSubService {
		enabled = append(enabled, visableInfo{
			Port:       thisSubservice.Port,
			Path:       thisSubservice.Path,
			ServiceDir: thisSubservice.ServiceDir,
			RpEndpoint: thisSubservice.RpEndpoint,
			ProcessID:  thisSubservice.Process.Process.Pid,
			Info:       thisSubservice.Info,
		})
	}

	disabledModules, _ := filepath.Glob("subservice/*/.disabled")
	for _, modFile := range disabledModules {
		thisdsi := new(disabledServiceInfo)
		thisdsi.ServiceDir = filepath.Base(filepath.Dir(modFile))
		thisdsi.Path = filepath.Base(filepath.Dir(modFile))
		if runtime.GOOS == "windows" {
			thisdsi.Path = thisdsi.Path + ".exe"
		}
		disabled = append(disabled, *thisdsi)

	}

	jsonString, err := json.Marshal(struct {
		Enabled  []visableInfo
		Disabled []disabledServiceInfo
	}{
		Enabled:  enabled,
		Disabled: disabled,
	})
	if err != nil {
		log.Println(err)
	}
	sendJSONResponse(w, string(jsonString))
}

//Kill the subservice that is currently running
func (sr *SubServiceRouter) HandleKillSubService(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := sr.userHandler.GetUserInfoFromRequest(w, r)
	//Require admin permission
	if !userinfo.IsAdmin() {
		sendErrorResponse(w, "Permission denied")
		return
	}

	//OK. Get paramters
	serviceDir, _ := mv(r, "serviceDir", true)
	//moduleName, _ := mv(r, "moduleName", true)

	err := sr.KillSubService(serviceDir)
	if err != nil {
		sendErrorResponse(w, err.Error())
	} else {
		sendOK(w)
	}

}

func (sr *SubServiceRouter) HandleStartSubService(w http.ResponseWriter, r *http.Request) {
	userinfo, _ := sr.userHandler.GetUserInfoFromRequest(w, r)

	//Require admin permission
	if !userinfo.IsAdmin() {
		sendErrorResponse(w, "Permission denied")
		return
	}

	//OK. Get which dir to start
	serviceDir, _ := mv(r, "serviceDir", true)
	err := sr.StartSubService(serviceDir)
	if err != nil {
		sendErrorResponse(w, err.Error())
	} else {
		sendOK(w)
	}

}

//Check if the user has permission to access such proxy module
func (sr *SubServiceRouter) CheckUserPermissionOnSubservice(ss *SubService, u *user.User) bool {
	moduleName := ss.Info.Name
	return u.GetModuleAccessPermission(moduleName)
}

//Check if the target is reverse proxy. If yes, return the proxy handler and the rewritten url in string
func (sr *SubServiceRouter) CheckIfReverseProxyPath(r *http.Request) (bool, *reverseproxy.ReverseProxy, string, *SubService) {
	requestURL := r.URL.Path

	for _, subservice := range sr.RunningSubService {
		thisServiceProxyEP := subservice.RpEndpoint
		if thisServiceProxyEP != "" {
			if len(requestURL) > len(thisServiceProxyEP)+1 && requestURL[1:len(thisServiceProxyEP)+1] == thisServiceProxyEP {
				//This is a proxy path. Generate the rewrite URL
				//Get all GET paramters from URL
				values := r.URL.Query()
				counter := 0
				parsedGetTail := ""
				for k, v := range values {
					if counter == 0 {
						parsedGetTail = "?" + k + "=" + url.QueryEscape(v[0])
					} else {
						parsedGetTail = parsedGetTail + "&" + k + "=" + url.QueryEscape(v[0])
					}
					counter++
				}

				return true, subservice.ProxyHandler, requestURL[len(thisServiceProxyEP)+1:] + parsedGetTail, &subservice
			}
		}
	}
	return false, nil, "", &SubService{}
}

func (sr *SubServiceRouter) Close() {
	//Handle shutdown of subprocesses. Kill all of them
	for _, subservice := range sr.RunningSubService {
		cmd := subservice.Process
		if cmd != nil {
			if runtime.GOOS == "windows" {
				//Force kill with the power of CMD
				kill := exec.Command("TASKKILL", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
				//kill.Stderr = os.Stderr
				//kill.Stdout = os.Stdout
				kill.Run()
			} else {
				//Send sigkill to process
				cmd.Process.Kill()
			}
		}
	}
}

func (sr *SubServiceRouter) KillSubService(serviceDir string) error {
	//Remove them from the system
	ssi := -1
	moduleName := ""
	for i, ss := range sr.RunningSubService {
		if ss.ServiceDir == serviceDir {
			ssi = i
			moduleName = ss.Info.Name
			//Kill the module cmd
			cmd := ss.Process
			if cmd != nil {
				if runtime.GOOS == "windows" {
					//Force kill with the power of CMD
					kill := exec.Command("TASKKILL", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
					kill.Run()
				} else {
					err := cmd.Process.Kill()
					if err != nil {
						return err
					}
				}
			}

			//Write a suspended file into the module
			ioutil.WriteFile("subservice/"+ss.ServiceDir+"/.disabled", []byte(""), 0755)
		}
	}

	//Pop this service from running Subservice
	if ssi != -1 {
		i := ssi
		copy(sr.RunningSubService[i:], sr.RunningSubService[i+1:])
		sr.RunningSubService = sr.RunningSubService[:len(sr.RunningSubService)-1]
	}

	//Pop the related module from the loadedModule list
	mi := -1
	for i, m := range sr.moduleHandler.LoadedModule {
		if m.Name == moduleName {
			mi = i
		}
	}
	if mi != -1 {
		i := mi
		copy(sr.moduleHandler.LoadedModule[i:], sr.moduleHandler.LoadedModule[i+1:])
		sr.moduleHandler.LoadedModule = sr.moduleHandler.LoadedModule[:len(sr.moduleHandler.LoadedModule)-1]
	}
	return nil
}

func (sr *SubServiceRouter) StartSubService(serviceDir string) error {
	if fileExists("subservice/" + serviceDir) {
		err := sr.Launch("subservice/"+serviceDir, false)
		if err != nil {
			return err
		}
	} else {
		return errors.New("Subservice directory not exists.")
	}

	//Sort the list
	sort.Slice(sr.moduleHandler.LoadedModule, func(i, j int) bool {
		return sr.moduleHandler.LoadedModule[i].Name < sr.moduleHandler.LoadedModule[j].Name
	})

	sort.Slice(sr.RunningSubService, func(i, j int) bool {
		return sr.RunningSubService[i].Info.Name < sr.RunningSubService[j].Info.Name
	})

	return nil
}

//Get a list of subservice roots in realpath
func (sr *SubServiceRouter) GetSubserviceRoot() []string {
	subserviceRoots := []string{}
	for _, subService := range sr.RunningSubService {
		subserviceRoots = append(subserviceRoots, subService.Path)
	}

	return subserviceRoots
}

//Scan and get the next avaible port for subservice from its basePort
func (sr *SubServiceRouter) GetNextUsablePort() int {
	basePort := sr.BasePort
	for sr.CheckIfPortInUse(basePort) {
		basePort++
	}
	return basePort
}

func (sr *SubServiceRouter) CheckIfPortInUse(port int) bool {
	for _, service := range sr.RunningSubService {
		if service.Port == port {
			return true
		}
	}
	return false
}

func (sr *SubServiceRouter) HandleRoutingRequest(w http.ResponseWriter, r *http.Request, proxy *reverseproxy.ReverseProxy, subserviceObject *SubService, rewriteURL string) {
	u, _ := sr.userHandler.GetUserInfoFromRequest(w, r)
	if !sr.CheckUserPermissionOnSubservice(subserviceObject, u) {
		//Permission denied
		http.NotFound(w, r)
		return
	}
	//Perform reverse proxy serving
	r.URL, _ = url.Parse(rewriteURL)
	token, _ := sr.userHandler.GetAuthAgent().NewTokenFromRequest(w, r)
	r.Header.Set("aouser", u.Username)
	r.Header.Set("aotoken", token)
	r.Header.Set("X-Forwarded-Host", r.Host)
	if r.Header["Upgrade"] != nil && r.Header["Upgrade"][0] == "websocket" {
		//Handle WebSocket request. Forward the custom Upgrade header and rewrite origin
		r.Header.Set("A-Upgrade", "websocket")
		u, _ := url.Parse("ws://localhost:" + strconv.Itoa(subserviceObject.Port) + r.URL.String())
		wspHandler := websocketproxy.NewProxy(u)
		wspHandler.ServeHTTP(w, r)
		return
	}

	r.Host = r.URL.Host
	err := proxy.ServeHTTP(w, r)
	if err != nil {
		//Check if it is cancelling events.
		if !strings.Contains(err.Error(), "cancel") {
			log.Println(subserviceObject.Info.Name + " IS NOT RESPONDING!")
			sr.RestartSubService(subserviceObject)
		}

	}
}

//Handle fail start over when the remote target is not responding
func (sr *SubServiceRouter) RestartSubService(ss *SubService) {
	go func(ss *SubService) {
		//Kill the original subservice
		sr.KillSubService(ss.ServiceDir)
		log.Println("RESTARTING SUBSERVICE " + ss.Info.Name + " IN 10 SECOUNDS")
		time.Sleep(10000 * time.Millisecond)
		sr.StartSubService(ss.ServiceDir)
		log.Println("SUBSERVICE " + ss.Info.Name + " RESTARTED")
	}(ss)
}
