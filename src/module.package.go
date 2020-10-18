package main

import (
	"os/exec"
	"runtime"
	"net/http"
	"errors"
	"encoding/json"
	"strings"
	"log"
	"os"
)

/*
	Pacakge management tool for Linux OS with APT

	ONLY USABLE under Linux environment
*/

func module_package_init(){
	http.HandleFunc("/system/apt/list", module_package_listAPT)
}

//Install the given package if not exists. Set mustComply to true for "panic on failed to install"
func module_package_installIfNotExists(pkgname string, mustComply bool) error{
	//Clear the pkgname
	pkgname = strings.ReplaceAll(pkgname, "&","")
	pkgname = strings.ReplaceAll(pkgname, "|","")
	
	if runtime.GOOS == "windows" {
		//Check if the command already exists in windows path paramters.
		cmd := exec.Command("where", pkgname, "2>", "nul")
		_, err := cmd.CombinedOutput()
		if err != nil{
			return errors.New("Package " + pkgname + " not found in Windows %PATH%.")
		}
		return nil
	}

	if (*allow_package_autoInstall == false){
		return errors.New("Package auto install is disabled")
	}

	cmd := exec.Command("whereis", pkgname)
	out, err := cmd.CombinedOutput()
	if err != nil{
		return err
	}

	packageInfo := strings.Split(strings.TrimSpace(string(out)), ":")
	//log.Println(packageInfo)
	if (len(packageInfo) > 1 && packageInfo[1] != ""){
		return nil
	}else{
		//Package not installed. Install if now if running in sudo mode
		log.Println("Installing package " + pkgname + "...")
		cmd := exec.Command("apt-get", "install", "-y", pkgname)
		out, err := cmd.CombinedOutput()
		if err != nil{
			if (mustComply){
				//Panic and terminate server process
				log.Println("Installation failed on package: " + pkgname, string(out))
				os.Exit(0)
			}else{
				log.Println("Installation failed on package: " + pkgname)
				log.Println(string(out))
			}
			return err
		}
		return nil
	}

	return nil
}

func module_package_test(w http.ResponseWriter, r *http.Request){
	module_package_installIfNotExists("ffmpeg", true)
	module_package_installIfNotExists("samba", true)
}

func module_package_listAPT(w http.ResponseWriter, r *http.Request){
	if runtime.GOOS == "windows" {
		sendErrorResponse(w, "Function disabled on Windows")
		return
	}
	cmd := exec.Command("apt", "list", "--installed")
	out, err := cmd.CombinedOutput()
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	results := [][]string{}
	//Parse the output string
	installedPackages := strings.Split(string(out), "\n")
	for _, thisPackage := range installedPackages{
		if len(thisPackage) > 0{
			packageInfo := strings.Split(thisPackage, "/")
			packageName := packageInfo[0]
			if len(packageInfo) >= 2{
				packageVersion := strings.Split(packageInfo[1], ",")[1]
				if (packageVersion[:3] == "now"){
					packageVersion = packageVersion[4:]
				}
				if (strings.Contains(packageVersion, "[installed") && packageVersion[len(packageVersion) - 1:] != "]"){
					packageVersion = packageVersion + ",automatic]"
				}

				results = append(results, []string{packageName, packageVersion})
			}
		}
	}

	jsonString, _ := json.Marshal(results);
	sendJSONResponse(w, string(jsonString))
	return
}

