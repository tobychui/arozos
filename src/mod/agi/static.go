package agi

import (
	"net/url"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	user "imuslab.com/arozos/mod/user"
)

//Get the full vpath if the passing value is a relative path
//Return the original vpath if any error occured
func relativeVpathRewrite(fsh *filesystem.FileSystemHandler, vpath string, vm *otto.Otto, u *user.User) string {
	//Check if the vpath contain a UUID
	if strings.Contains(vpath, ":/") || (len(vpath) > 0 && vpath[len(vpath)-1:] == ":") {
		//This vpath contain root uuid.
		return vpath
	}

	//We have no idea where the script is from. Trust its vpath is always full path
	if fsh == nil {
		return vpath
	}

	//Get the script execution root path
	rootPath, err := vm.Get("__FILE__")
	if err != nil {
		return vpath
	}

	rootPathString, err := rootPath.ToString()
	if err != nil {
		return vpath
	}

	//Convert the root path to vpath
	rootVpath, err := fsh.FileSystemAbstraction.RealPathToVirtualPath(rootPathString, u.Username)
	if err != nil {
		return vpath
	}

	rootScriptDir := filepath.Dir(rootVpath)
	return arozfs.ToSlash(filepath.Clean(filepath.Join(rootScriptDir, vpath)))
}

//Check if the user can access this script file
func checkUserAccessToScript(thisuser *user.User, scriptFile string, scriptScope string) bool {
	moduleName := getScriptRoot(scriptFile, scriptScope)
	if !thisuser.GetModuleAccessPermission(moduleName) {
		return false
	}
	return true
}

//validate the given path is a script from webroot
func isValidAGIScript(scriptPath string) bool {
	return fileExists(filepath.Join("./web", scriptPath)) && (filepath.Ext(scriptPath) == ".js" || filepath.Ext(scriptPath) == ".agi")
}

//Return the script root of the current executing script
func getScriptRoot(scriptFile string, scriptScope string) string {
	//Get the script root from the script path
	webRootAbs, _ := filepath.Abs(scriptScope)
	webRootAbs = filepath.ToSlash(filepath.Clean(webRootAbs) + "/")
	scriptFileAbs, _ := filepath.Abs(scriptFile)
	scriptFileAbs = filepath.ToSlash(filepath.Clean(scriptFileAbs))
	scriptRoot := strings.Replace(scriptFileAbs, webRootAbs, "", 1)
	scriptRoot = strings.Split(scriptRoot, "/")[0]
	return scriptRoot
}

//For handling special url decode in the request
func specialURIDecode(inputPath string) string {
	inputPath = strings.ReplaceAll(inputPath, "+", "{{plus_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{plus_sign}}", "+")
	return inputPath
}
