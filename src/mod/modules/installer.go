package modules

import (
	"encoding/json"
	"errors"
	"io"
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

	//Unzip to a temporary folder; always clean it up when we're done
	unzipTmpFolder := "./tmp/installer/" + strconv.Itoa(int(time.Now().Unix()))
	err := fs.Unzip(realpath, unzipTmpFolder)
	if err != nil {
		return err
	}
	defer os.RemoveAll(unzipTmpFolder)

	//Find sub-folders that contain init.agi – those are valid module folders
	files, _ := filepath.Glob(unzipTmpFolder + "/*")
	folders := []string{}
	for _, file := range files {
		if utils.IsDir(file) && utils.FileExists(filepath.Join(file, "init.agi")) {
			folders = append(folders, file)
		}
	}

	if len(folders) == 0 {
		return errors.New("*Module Installer* No valid module found in zip (no sub-folder containing init.agi)")
	}

	//Move each valid module folder into the web root
	installedFolders := []string{}
	for _, folder := range folders {
		destPath := filepath.Join("./web", filepath.Base(folder))
		//Remove any existing installation first (supports updating)
		if utils.FileExists(destPath) {
			os.RemoveAll(destPath)
		}
		if err := os.Rename(folder, destPath); err != nil {
			log.Println("*Module Installer* Failed to move module:", err)
			return errors.New("Failed to install " + filepath.Base(folder) + ": " + err.Error())
		}
		installedFolders = append(installedFolders, destPath)
	}

	//Activate each installed module and refresh the sorted list
	for _, folder := range installedFolders {
		m.ActivateModuleByRoot(folder, gateway)
	}
	m.ModuleSortList()

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
		Name          string // Name of the module
		Desc          string // Description of module
		Group         string // Group of the module
		Version       string // Version of the module
		IconPath      string // The icon access path of the module
		InstallDate   string // The last editing date of the module folder
		InitAGIDate   string // Last modification date of init.agi specifically
		InstallDir    string // Path on disk (forward-slash, relative to server root)
		DiskSpace     int64  // Disk space used
		Uninstallable bool   // Indicate if this can be uninstalled
	}

	results := []ModuleInstallInfo{}
	for _, mod := range m.LoadedModule {
		if mod.StartDir == "" {
			continue
		}
		if !utils.FileExists(filepath.Join("./web", mod.StartDir)) {
			continue
		}

		dirPath := filepath.Join("./web", filepath.Dir(mod.StartDir))
		totalsize, _ := fs.GetDirctorySize(dirPath, false)

		// Folder mod time (kept for backward compat)
		mtime, err := fs.GetModTime(dirPath)
		if err != nil {
			log.Println(err)
		}
		t := time.Unix(mtime, 0)

		// init.agi mod time (more precise install/update date)
		agiDate := ""
		agiPath := filepath.Join(dirPath, "init.agi")
		if utils.FileExists(agiPath) {
			if agiInfo, statErr := os.Stat(agiPath); statErr == nil {
				agiDate = agiInfo.ModTime().Format("2006-01-02")
			}
		}

		canUninstall := true
		if mod.Name == "System Setting" || mod.Group == "System Tools" {
			canUninstall = false
		}

		results = append(results, ModuleInstallInfo{
			Name:          mod.Name,
			Desc:          mod.Desc,
			Group:         mod.Group,
			Version:       mod.Version,
			IconPath:      mod.IconPath,
			InstallDate:   t.Format("2006-01-02"),
			InitAGIDate:   agiDate,
			InstallDir:    filepath.ToSlash(dirPath),
			DiskSpace:     totalsize,
			Uninstallable: canUninstall,
		})
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

// HandleUploadAndInstall accepts a multipart-uploaded zip file and installs it.
// The file must be submitted in the "zipfile" field.
func (m *ModuleHandler) HandleUploadAndInstall(w http.ResponseWriter, r *http.Request, gateway *agi.Gateway) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		utils.SendErrorResponse(w, "Failed to parse upload: "+err.Error())
		return
	}

	file, header, err := r.FormFile("zipfile")
	if err != nil {
		utils.SendErrorResponse(w, "No zip file provided")
		return
	}
	defer file.Close()

	if filepath.Ext(header.Filename) != ".zip" {
		utils.SendErrorResponse(w, "Only .zip files are accepted")
		return
	}

	// Save to a temporary path
	tmpDir := filepath.Join(m.tmpDirectory, "installer")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		utils.SendErrorResponse(w, "Failed to create temp directory")
		return
	}
	tmpPath := filepath.Join(tmpDir, strconv.FormatInt(time.Now().UnixNano(), 10)+"_upload.zip")

	out, err := os.Create(tmpPath)
	if err != nil {
		utils.SendErrorResponse(w, "Failed to create temp file: "+err.Error())
		return
	}
	if _, err = io.Copy(out, file); err != nil {
		out.Close()
		os.Remove(tmpPath)
		utils.SendErrorResponse(w, "Failed to write upload: "+err.Error())
		return
	}
	out.Close()

	// Install and clean up regardless of outcome
	installErr := m.InstallViaZip(tmpPath, gateway)
	os.Remove(tmpPath)

	if installErr != nil {
		utils.SendErrorResponse(w, "Installation failed: "+installErr.Error())
		return
	}
	utils.SendOK(w)
}
