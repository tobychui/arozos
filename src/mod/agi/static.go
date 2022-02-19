package agi

import (
	"net/url"
	"path/filepath"
	"strings"

	user "imuslab.com/arozos/mod/user"
)

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

func specialGlob(path string) ([]string, error) {
	files, err := filepath.Glob(path)
	if err != nil {
		return []string{}, err
	}

	if strings.Contains(path, "[") == true || strings.Contains(path, "]") == true {
		if len(files) == 0 {
			//Handle reverse check. Replace all [ and ] with *
			newSearchPath := strings.ReplaceAll(path, "[", "?")
			newSearchPath = strings.ReplaceAll(newSearchPath, "]", "?")
			newSearchPath = strings.ReplaceAll(newSearchPath, "：", "?")
			//Scan with all the similar structure except [ and ]
			tmpFilelist, _ := filepath.Glob(newSearchPath)
			for _, file := range tmpFilelist {
				file = filepath.ToSlash(file)
				if strings.Contains(file, filepath.ToSlash(filepath.Dir(path))) {
					files = append(files, file)
				}
			}
		}
	}
	//Convert all filepaths to slash
	for i := 0; i < len(files); i++ {
		files[i] = filepath.ToSlash(files[i])
	}
	return files, nil
}
