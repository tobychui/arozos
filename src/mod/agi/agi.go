package agi

import (
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"

	apt "imuslab.com/arozos/mod/apt"
	auth "imuslab.com/arozos/mod/auth"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/iot"
	user "imuslab.com/arozos/mod/user"
)

/*
	ArOZ Online Javascript Gateway Interface (AGI)
	author: tobychui

	This script load plugins written in Javascript and run them in VM inside golang
	DO NOT CONFUSE PLUGIN WITH SUBSERVICE :))
*/

var (
	AgiVersion string = "1.5" //Defination of the agi runtime version. Update this when new function is added
)

type AgiLibIntergface func(*otto.Otto, *user.User) //Define the lib loader interface for AGI Libraries
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
	AuthAgent            *auth.AuthAgent
	FileSystemRender     *metadata.RenderHandler
	IotManager           *iot.Manager

	//Scanning Roots
	StartupRoot   string
	ActivateScope []string
}

type Gateway struct {
	ReservedTables   []string
	AllowAccessPkgs  map[string][]AgiPackage
	LoadedAGILibrary map[string]AgiLibIntergface
	Option           *AgiSysInfo
}

func NewGateway(option AgiSysInfo) (*Gateway, error) {
	//Handle startup registration of ajgi modules
	startupScripts, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(option.StartupRoot)) + "/*/init.agi")
	gatewayObject := Gateway{
		ReservedTables:   option.ReservedTables,
		AllowAccessPkgs:  map[string][]AgiPackage{},
		LoadedAGILibrary: map[string]AgiLibIntergface{},
		Option:           &option,
	}

	for _, script := range startupScripts {
		scriptContentByte, _ := ioutil.ReadFile(script)
		scriptContent := string(scriptContentByte)
		log.Println("[AGI] Gateway script loaded (" + script + ")")
		//Create a new vm for this request
		vm := otto.New()

		//Only allow non user based operations
		gatewayObject.injectStandardLibs(vm, script, "./web/")

		_, err := vm.Run(scriptContent)
		if err != nil {
			log.Println("[AGI] Load Failed: " + script + ". Skipping.")
			log.Println(err)
			continue
		}
	}

	//Load all the other libs entry points into the memoary
	gatewayObject.ImageLibRegister()
	gatewayObject.FileLibRegister()
	gatewayObject.HTTPLibRegister()
	gatewayObject.IoTLibRegister()
	gatewayObject.AppdataLibRegister()

	return &gatewayObject, nil
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

func (g *Gateway) RegisterLib(libname string, entryPoint AgiLibIntergface) error {
	_, ok := g.LoadedAGILibrary[libname]
	if ok {
		//This lib already registered. Return error
		return errors.New("This library name already registered")
	} else {
		g.LoadedAGILibrary[libname] = entryPoint
	}
	return nil
}

func (g *Gateway) raiseError(err error) {
	log.Println("[AGI] Runtime Error " + err.Error())

	//To be implemented
}

//Check if this table is restricted table. Return true if the access is valid
func (g *Gateway) filterDBTable(tablename string, existsCheck bool) bool {
	//Check if table is restricted
	if stringInSlice(tablename, g.ReservedTables) {
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

//Handle request from RESTFUL API
func (g *Gateway) APIHandler(w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	scriptContent, err := mv(r, "script", true)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("400 - Bad Request (Missing script content)"))
		return
	}
	g.ExecuteAGIScript(scriptContent, "", "", w, r, thisuser)
}

//Handle user requests
func (g *Gateway) InterfaceHandler(w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	//Get user object from the request
	startupRoot := g.Option.StartupRoot
	startupRoot = filepath.ToSlash(filepath.Clean(startupRoot))

	//Get the script files for the plugin
	scriptFile, err := mv(r, "script", false)
	if err != nil {
		sendErrorResponse(w, "Invalid script path")
		return
	}
	scriptFile = specialURIDecode(scriptFile)

	//Check if the script path exists
	scriptExists := false
	scriptScope := "./web/"
	for _, thisScope := range g.Option.ActivateScope {
		thisScope = filepath.ToSlash(filepath.Clean(thisScope))
		if fileExists(thisScope + "/" + scriptFile) {
			scriptExists = true
			scriptFile = thisScope + "/" + scriptFile
			scriptScope = thisScope
		}
	}

	if !scriptExists {
		sendErrorResponse(w, "Script not found")
		return
	}

	//Check for user permission on this module
	moduleName := getScriptRoot(scriptFile, scriptScope)
	if !thisuser.GetModuleAccessPermission(moduleName) {
		w.WriteHeader(http.StatusForbidden)
		if g.Option.BuildVersion == "development" {
			w.Write([]byte("Permission denied: User do not have permission to access " + moduleName))
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
	scriptContentByte, _ := ioutil.ReadFile(scriptFile)
	scriptContent := string(scriptContentByte)

	g.ExecuteAGIScript(scriptContent, scriptFile, scriptScope, w, r, thisuser)
}

/*
	Executing the given AGI Script contents. Requires:
	scriptContent: The AGI command sequence
	scriptFile: The filepath of the script file
	scriptScope: The scope of the script file, aka the module base path
	w / r : Web request and response writer
	thisuser: userObject

*/
func (g *Gateway) ExecuteAGIScript(scriptContent string, scriptFile string, scriptScope string, w http.ResponseWriter, r *http.Request, thisuser *user.User) {
	//Create a new vm for this request
	vm := otto.New()
	//Inject standard libs into the vm
	g.injectStandardLibs(vm, scriptFile, scriptScope)
	g.injectUserFunctions(vm, scriptFile, scriptScope, thisuser, w, r)

	//Detect cotent type
	contentType := r.Header.Get("Content-type")
	if strings.Contains(contentType, "application/json") {
		//For shitty people who use Angular
		body, _ := ioutil.ReadAll(r.Body)
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
		sendTextResponse(w, "")
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

*/
func (g *Gateway) ExecuteAGIScriptAsUser(scriptFile string, targetUser *user.User) (string, error) {
	//Create a new vm for this request
	vm := otto.New()
	//Inject standard libs into the vm
	g.injectStandardLibs(vm, scriptFile, "")
	g.injectUserFunctions(vm, scriptFile, "", targetUser, nil, nil)

	//Try to read the script content
	scriptContent, err := ioutil.ReadFile(scriptFile)
	if err != nil {
		return "", err
	}

	_, err = vm.Run(scriptContent)
	if err != nil {
		return "", err
	}

	//Get the return valu from the script
	value, err := vm.Get("HTTP_RESP")
	if err != nil {
		return "", err
	}

	valueString, err := value.ToString()
	return valueString, nil
}
