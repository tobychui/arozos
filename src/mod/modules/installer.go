package modules

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-git/go-git/v5"
	uuid "github.com/satori/go.uuid"
	agi "imuslab.com/arozos/mod/agi"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
)

/*
	Module Installer
	author: tobychui

	This script handle the installation of modules in the arozos system

*/

// Install a module via selecting a zip file
func (m *ModuleHandler) InstallViaZip(realpath string, gateway *agi.Gateway) error {
	//Check if file exists
	if !utils.FileExists(realpath) {
		return errors.New("*Module Installer* Installer file not found. Given: " + realpath)
	}

	//Install it
	unzipTmpFolder := "./tmp/installer/" + strconv.Itoa(int(time.Now().Unix()))
	err := fs.Unzip(realpath, unzipTmpFolder)
	if err != nil {
		return err
	}

	//Move the module(s) to the web root
	files, _ := filepath.Glob(unzipTmpFolder + "/*")
	folders := []string{}
	for _, file := range files {
		if utils.IsDir(file) && utils.FileExists(filepath.Join(file, "init.agi")) {
			//This looks like a module folder
			folders = append(folders, file)
		}
	}
	/*
		for _, folder := range folders {
			//Copy the module
			//WIP

					err = fs.CopyDir(folder, "./web/"+filepath.Base(folder))
					if err != nil {
						log.Println(err)
						continue
					}


				//Activate the module
				m.ActivateModuleByRoot("./web/"+filepath.Base(folder), gateway)
				m.ModuleSortList()

		}
	*/

	//Remove the tmp folder
	os.RemoveAll(unzipTmpFolder)

	//OK
	return nil
}

// Reload all modules from agi file again
func (m *ModuleHandler) ReloadAllModules(gateway *agi.Gateway) error {
	//Clear the current registered module list
	newModuleList := []*ModuleInfo{}
	for _, thisModule := range m.LoadedModule {
		if !thisModule.allowReload {
			//This module is registered by system. Do not allow reload
			newModuleList = append(newModuleList, thisModule)
		}
	}
	m.LoadedModule = newModuleList
	//Reload all webapp init.agi gateway script from source
	gateway.InitiateAllWebAppModules()
	m.ModuleSortList()
	return nil
}

// Install a module via git clone
func (m *ModuleHandler) InstallModuleViaGit(gitURL string, gateway *agi.Gateway) error {
	//Download the module from the gitURL
	log.Println("Starting module installation by Git cloning ", gitURL)
	newDownloadUUID := uuid.NewV4().String()
	downloadFolder := filepath.Join(m.tmpDirectory, "download", newDownloadUUID)
	os.MkdirAll(downloadFolder, 0777)
	_, err := git.PlainClone(downloadFolder, false, &git.CloneOptions{
		URL:      gitURL,
		Progress: os.Stdout,
	})

	if err != nil {
		return err
	}

	//Copy all folder within the download folder to the web root
	downloadedFiles, _ := filepath.Glob(downloadFolder + "/*")
	copyPendingList := []string{}
	for _, file := range downloadedFiles {
		if utils.IsDir(file) {
			//Exclude two special folder: github and images
			if filepath.Base(file) == ".github" || filepath.Base(file) == "images" || filepath.Base(file)[:1] == "." {
				//Reserved folder for putting Github readme screenshots or other things
				continue
			}
			//This file object is a folder. Copy to webroot
			copyPendingList = append(copyPendingList, file)
		}
	}

	//Do the copying
	//WIP
	/*
		for _, src := range copyPendingList {
			fs.FileCopy(src, "./web/", "skip", func(progress int, filename string) {
				log.Println("Copying ", filename)
			})
		}
	*/

	//Clean up the download folder
	os.RemoveAll(downloadFolder)

	//Add the newly installed module to module list
	for _, moduleFolder := range copyPendingList {
		//This module folder has been moved to web successfully.
		m.ActivateModuleByRoot(moduleFolder, gateway)
	}

	//Sort the module lsit
	m.ModuleSortList()

	return nil
}

func (m *ModuleHandler) ActivateModuleByRoot(moduleFolder string, gateway *agi.Gateway) error {
	//Check if there is init.agi. If yes, load it as an module
	thisModuleEstimataedRoot := filepath.Join("./web/", filepath.Base(moduleFolder))
	if utils.FileExists(thisModuleEstimataedRoot) {
		if utils.FileExists(filepath.Join(thisModuleEstimataedRoot, "init.agi")) {
			//Load this as an module
			startDef, err := os.ReadFile(filepath.Join(thisModuleEstimataedRoot, "init.agi"))
			if err != nil {
				log.Println("*Module Activator* Failed to read init.agi from " + filepath.Base(moduleFolder))
				return errors.New("Failed to read init.agi from " + filepath.Base(moduleFolder))
			}

			//Execute the init script using AGI
			log.Println("Starting module: ", filepath.Base(moduleFolder))
			err = gateway.RunScript(string(startDef))
			if err != nil {
				log.Println("*Module Activator* " + filepath.Base(moduleFolder) + " Starting failed" + err.Error())
				return errors.New(filepath.Base(moduleFolder) + " Starting failed: " + err.Error())

			}

		}
	}

	return nil
}

// Handle and return the information of the current installed modules
func (m *ModuleHandler) HandleModuleInstallationListing(w http.ResponseWriter, r *http.Request) {
	type ModuleInstallInfo struct {
		Name          string //Name of the module
		Desc          string //Description of module
		Group         string //Group of the module
		Version       string //Version of the module
		IconPath      string //The icon access path of the module
		InstallDate   string //The last editing date of the module file
		DiskSpace     int64  //Disk space used
		Uninstallable bool   //Indicate if this can be uninstall or disabled
	}

	results := []ModuleInstallInfo{}
	for _, mod := range m.LoadedModule {
		//Get total size
		if mod.StartDir != "" {
			//Only allow uninstalling of modules with start dir (aka installable)

			//Check if WebApp or subservice
			if utils.FileExists(filepath.Join("./web", mod.StartDir)) {
				//This is a WebApp module
				totalsize, _ := fs.GetDirctorySize(filepath.Join("./web", filepath.Dir(mod.StartDir)), false)

				//Get mod time
				mtime, err := fs.GetModTime(filepath.Join("./web", filepath.Dir(mod.StartDir)))
				if err != nil {
					log.Println(err)
				}
				t := time.Unix(mtime, 0)

				//Check allow uninstall state
				canUninstall := true
				if mod.Name == "System Setting" || mod.Group == "System Tools" {
					canUninstall = false
				}

				results = append(results, ModuleInstallInfo{
					mod.Name,
					mod.Desc,
					mod.Group,
					mod.Version,
					mod.IconPath,
					t.Format("2006-01-02"),
					totalsize,
					canUninstall,
				})
			} else {
				//Subservice
			}

		}

	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// Uninstall the given module
func (m *ModuleHandler) UninstallModule(moduleName string) error {
	//Check if this module is allowed to be removed
	var targetModuleInfo *ModuleInfo = nil
	for _, mod := range m.LoadedModule {
		if mod.Name == moduleName {
			targetModuleInfo = mod
			break
		}
	}

	if targetModuleInfo.Group == "System Tools" || targetModuleInfo.Name == "System Setting" {
		//Reject Remove Operation
		return errors.New("Protected modules cannot be removed")
	}

	//Check if the module exists
	if utils.FileExists(filepath.Join("./web", moduleName)) {
		//Remove the module
		log.Println("Removing Module: ", moduleName)
		os.RemoveAll(filepath.Join("./web", moduleName))

		//Unregister the module from loaded list
		newLoadedModuleList := []*ModuleInfo{}
		for _, thisModule := range m.LoadedModule {
			if thisModule.Name != moduleName {
				newLoadedModuleList = append(newLoadedModuleList, thisModule)
			}
		}

		m.LoadedModule = newLoadedModuleList

	} else {
		return errors.New("Module not exists")
	}
	return nil
}
