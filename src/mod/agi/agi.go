package agi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"

	"imuslab.com/arozos/mod/agi/static"
	apt "imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/iot"
	"imuslab.com/arozos/mod/share"
	"imuslab.com/arozos/mod/time/nightly"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	ArOZ Online Javascript Gateway Interface (AGI)
	author: tobychui

	This script load plugins written in Javascript and run them in VM inside golang
	DO NOT CONFUSE PLUGIN WITH SUBSERVICE :))
*/

var (
	AgiVersion string = "3.0" //Defination of the agi runtime version. Update this when new function is added

	//AGI Internal Error Standard
	errExitcall = errors.New("errExit")
	errTimeout  = errors.New("errTimeout")
)

type AgiPackage struct {
	InitRoot string //The initialization of the root for the module that request this package
}

type AgiSysInfo struct {
	//System information
	BuildVersion    string
	InternalVersion string
	LoadedModule    []string

	//System Handlers
	UserHandler          *user.UserHandler
	ReservedTables       []string
	PackageManager       *apt.AptPackageManager
	ModuleRegisterParser func(string) error
	FileSystemRender     *metadata.RenderHandler
	IotManager           *iot.Manager
	ShareManager         *share.Manager
	NightlyManager       *nightly.TaskManager

	//Scanning Roots
	StartupRoot    string
	ActivateScope  []string
	TempFolderPath string
}

type Gateway struct {
	ReservedTables []string
	NightlyScripts []string
	//AllowAccessPkgs  map[string][]AgiPackage
	LoadedAGILibrary map[string]AgiLibInjectionIntergface
	Option           *AgiSysInfo
}

func NewGateway(option AgiSysInfo) (*Gateway, error) {
	//Handle startup registration of ajgi modules
	gatewayObject := Gateway{
		ReservedTables: option.ReservedTables,
		NightlyScripts: []string{},
		//AllowAccessPkgs:  map[string][]AgiPackage{},
		LoadedAGILibrary: map[string]AgiLibInjectionIntergface{},
		Option:           &option,
	}

	//Start all WebApps Registration
	gatewayObject.InitiateAllWebAppModules()
	gatewayObject.RegisterNightlyOperations()

	//Load all the other libs entry points into the memoary
	gatewayObject.LoadAllFunctionalModules()

	return &gatewayObject, nil
}

func (g *Gateway) RegisterNightlyOperations() {
	g.Option.NightlyManager.RegisterNightlyTask(func() {
		//This function will execute nightly
		for _, scriptFile := range g.NightlyScripts {
			if static.IsValidAGIScript(scriptFile) {
				//Valid script file. Execute it with system
				for _, username := range g.Option.UserHandler.GetAuthAgent().ListUsers() {
					userinfo, err := g.Option.UserHandler.GetUserInfoFromUsername(username)
					if err != nil {
						continue
					}

					if static.CheckUserAccessToScript(userinfo, scriptFile, "") {
						//This user can access the module that provide this script.
						//Execute this script on his account.
						log.Println("[AGI_Nightly] WIP (" + scriptFile + ")")
					}
				}
			} else {
				//Invalid script. Skipping
				log.Println("[AGI_Nightly] Invalid script file: " + scriptFile)
			}
		}
	})
}

func (g *Gateway) InitiateAllWebAppModules() {
	startupScripts, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(g.Option.StartupRoot)) + "/*/init.agi")
	for _, script := range startupScripts {
		scriptContentByte, _ := os.ReadFile(script)
		scriptContent := string(scriptContentByte)
		log.Println("[AGI] Gateway script loaded (" + script + ")")
		//Create a new vm for this request
		vm := otto.New()

		//Only allow non user based operations
		g.injectStandardLibs(vm, script, "./web/")
		g.injectAppdataLibFunctions(&static.AgiLibInjectionPayload{
			VM: vm,
		})
		_, err := vm.Run(scriptContent)
		if err != nil {
			log.Println("[AGI] Load Failed: " + script + ". Skipping.")
			log.Println(err)
			continue
		}
	}
}

func (g *Gateway) RunScript(script string) error {
	//Create a new vm for this request
	vm := otto.New()

	//Only allow non user based operations
	g.injectStandardLibs(vm, "", "./web/")

	_, err := vm.Run(script)
	if err != nil {
		log.Println("[AGI] Script Execution Failed: ", err.Error())
		return err
	}

	return nil
}

func (g *Gateway) RaiseError(err error) {
	log.Println("[AGI] Runtime Error " + err.Error())

	//To be implemented
}

// Check if this table is restricted table. Return true if the access is valid
func (g *Gateway) filterDBTable(tablename string, existsCheck bool) bool {
	//Check if table is restricted
	if utils.StringInArray(g.ReservedTables, tablename) {
		return false
	}

	//Check if table exists
	if existsCheck {
		if !g.Option.UserHandler.GetDatabase().TableExists(tablename) {
			return false
		}
	}

	return true
}

// Handle request from RESTFUL API
func (g *Gateway) APIHandler(w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	scriptContent, err := utils.PostPara(r, "script")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("400 - Bad Request (Missing script content)"))
		return
	}
	g.ExecuteAGIScript(scriptContent, nil, "", "", w, r, thisuser)
}

// Handle user requests
func (g *Gateway) InterfaceHandler(w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	//Get user object from the request
	//startupRoot := g.Option.StartupRoot
	//startupRoot = filepath.ToSlash(filepath.Clean(startupRoot))

	//Get the script files for the plugin
	scriptFile, err := utils.GetPara(r, "script")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error: Invalid script path"))
		return
	}
	scriptFile = static.SpecialURIDecode(scriptFile)

	//Check if the script path exists
	scriptExists := false
	scriptScope := "./web/"
	for _, thisScope := range g.Option.ActivateScope {
		thisScope = arozfs.ToSlash(filepath.Clean(thisScope))
		if utils.FileExists(arozfs.ToSlash(filepath.Join(thisScope, scriptFile))) {
			scriptExists = true
			scriptFile = arozfs.ToSlash(filepath.Join(thisScope, scriptFile))
			scriptScope = thisScope
			break
		}
	}

	if !scriptExists {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error: Script not exists"))
		return
	}

	//Check for user permission on this module
	moduleName := static.GetScriptRoot(scriptFile, scriptScope)
	if !thisuser.GetModuleAccessPermission(moduleName) {
		w.WriteHeader(http.StatusForbidden)
		if g.Option.BuildVersion == "development" {
			w.Write([]byte("403 Forbidden: User do not have permission to access " + moduleName))
		} else {
			w.Write([]byte("403 Forbidden"))
		}

		return
	}

	//Check the given file is actually agi script
	if !(filepath.Ext(scriptFile) == ".agi" || filepath.Ext(scriptFile) == ".js") {
		w.WriteHeader(http.StatusForbidden)

		if g.Option.BuildVersion == "development" {
			w.Write([]byte("AGI script must have file extension of .agi or .js"))
		} else {
			w.Write([]byte("403 Forbidden"))
		}

		return
	}

	//Get the content of the script
	scriptContentByte, err := os.ReadFile(scriptFile)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error: Script load error =>" + err.Error()))
		return
	}
	scriptContent := string(scriptContentByte)

	g.ExecuteAGIScript(scriptContent, nil, scriptFile, scriptScope, w, r, thisuser)
}

/*
Executing the given AGI Script contents. Requires:
scriptContent: The AGI command sequence
scriptFile: The filepath of the script file
scriptScope: The scope of the script file, aka the module base path
w / r : Web request and response writer
thisuser: userObject
*/
func (g *Gateway) ExecuteAGIScript(scriptContent string, fsh *filesystem.FileSystemHandler, scriptFile string, scriptScope string, w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	//Create a new vm for this request
	vm := otto.New()
	//Inject standard libs into the vm
	g.injectStandardLibs(vm, scriptFile, scriptScope)
	g.injectUserFunctions(vm, fsh, scriptFile, scriptScope, thisuser, w, r)

	//Detect cotent type
	contentType := r.Header.Get("Content-type")
	if strings.Contains(contentType, "application/json") {
		//For people who use Angular
		body, _ := io.ReadAll(r.Body)
		fields := map[string]interface{}{}
		json.Unmarshal(body, &fields)
		for k, v := range fields {
			vm.Set(k, v)
		}
		vm.Set("POST_data", string(body))
	} else {
		r.ParseForm()
		//Insert all paramters into the vm
		for k, v := range r.PostForm {
			if len(v) == 1 {
				vm.Set(k, v[0])
			} else {
				vm.Set(k, v)
			}

		}
	}

	_, err := vm.Run(scriptContent)
	if err != nil {
		scriptpath, _ := filepath.Abs(scriptFile)
		g.RenderErrorTemplate(w, err.Error(), scriptpath)
		return
	}

	//Get the return valu from the script
	value, err := vm.Get("HTTP_RESP")
	if err != nil {
		utils.SendTextResponse(w, "")
		return
	}
	valueString, err := value.ToString()

	//Get respond header type from the vm
	header, _ := vm.Get("HTTP_HEADER")
	headerString, _ := header.ToString()
	if headerString != "" {
		w.Header().Set("Content-Type", headerString)
	}

	w.Write([]byte(valueString))
}

/*
Execute AGI script with given user information
scriptFile must be realpath resolved by fsa VirtualPathToRealPath function
Pass in http.Request pointer to enable serverless GET / POST request
*/
func (g *Gateway) ExecuteAGIScriptAsUser(fsh *filesystem.FileSystemHandler, scriptFile string, targetUser *user.User, w http.ResponseWriter, r *http.Request) (string, error) {
	//Create a new vm for this request
	vm := otto.New()
	//Inject standard libs into the vm
	g.injectStandardLibs(vm, scriptFile, "")
	g.injectUserFunctions(vm, fsh, scriptFile, "", targetUser, w, r)

	if r != nil {
		//Inject serverless script to enable access to GET / POST paramters
		g.injectServerlessFunctions(vm, scriptFile, "", targetUser, r)
	}
	//Inject interrupt Channel
	vm.Interrupt = make(chan func(), 1)

	//Create a panic recovery logic
	defer func() {
		if caught := recover(); caught != nil {
			if caught == errTimeout {
				log.Println("[AGI] Execution timeout: " + scriptFile)
				return
			} else if caught == errExitcall {
				//Exit gracefully

				return
			} else {
				//Something screwed. Return Internal Server Error
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - ECMA VM crashed due to unknown reason"))
				//panic(caught)
			}
		}
	}()

	//Create a max runtime of 5 minutes
	go func() {
		time.Sleep(300 * time.Second) // Stop after 300 seconds
		vm.Interrupt <- func() {
			panic(errTimeout)
		}
	}()

	//Try to read the script content
	scriptContent, err := fsh.FileSystemAbstraction.ReadFile(scriptFile)
	if err != nil {
		return "", err
	}

	_, err = vm.Run(scriptContent)
	if err != nil {
		return "", err
	}

	//Get the return value from the script
	value, err := vm.Get("HTTP_RESP")
	if err != nil {
		return "", err
	}

	if w != nil {
		//Serverless: Get respond header type from the vm
		header, _ := vm.Get("HTTP_HEADER")
		headerString, _ := header.ToString()
		if headerString != "" {
			w.Header().Set("Content-Type", headerString)
		}
	}

	valueString, err := value.ToString()
	if err != nil {
		return "", err
	}
	return valueString, nil
}

/*
Get user specific tmp filepath for buffering remote file. Return filepath and closer
tempFilepath, closerFunction := g.getUserSpecificTempFilePath(u, "myfile.txt")
//Do something with it, after done
closerFunction();
*/
func (g *Gateway) getUserSpecificTempFilePath(u *user.User, filename string) (string, func()) {
	uuid := uuid.NewV4().String()
	tmpFileLocation := filepath.Join(g.Option.TempFolderPath, "agiBuff", u.Username, uuid, filepath.Base(filename))
	os.MkdirAll(filepath.Dir(tmpFileLocation), 0775)
	return tmpFileLocation, func() {
		os.RemoveAll(filepath.Dir(tmpFileLocation))
	}
}

/*
Buffer remote reosurces to local by fsh and rpath. Return buffer filepath on local device and its closer function
*/
func (g *Gateway) bufferRemoteResourcesToLocal(fsh *filesystem.FileSystemHandler, u *user.User, rpath string) (string, func(), error) {
	buffFile, closerFunc := g.getUserSpecificTempFilePath(u, rpath)
	f, err := fsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()
	dest, err := os.OpenFile(buffFile, os.O_CREATE|os.O_RDWR, 0775)
	if err != nil {
		return "", nil, err
	}
	io.Copy(dest, f)
	dest.Close()
	return buffFile, func() {
		closerFunc()
	}, nil
}
