package main

import (
	"io/ioutil"
	"net/http"

	module "imuslab.com/arozos/mod/modules"
)

/*
	MODULE UTIL HANDLER
	This is a util module for doing basic registry works and < 20 line server side handling.

	DO NOT USE THIS TO WRITE A NEW MODULE

*/

//Register the utilities here

func util_init() {
	//PDF Viewer
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "PDF Reader",
		Desc:         "The browser build in PDF Reader",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/pdfReader.png",
		Version:      "1.2",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/pdfReader.html",
		InitEmbSize:  []int{1080, 580},
		SupportedExt: []string{".pdf"},
	})

	//Open Documents Viewer
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "OpenOffice Reader",
		Desc:         "Open OpenOffice files",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/odfReader.png",
		Version:      "0.8",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/odfReader.html",
		InitEmbSize:  []int{1080, 580},
		SupportedExt: []string{".odt", ".odp", ".ods"},
	})

	/*
		Notebook - The build in basic text editor
	*/
	//Open Documents Viewer
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Notebook",
		Desc:         "Basic Text Editor",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/notebook.png",
		Version:      "1.0",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/notebook.html",
		InitEmbSize:  []int{1080, 580},
		SupportedExt: []string{".txt", ".md"},
	})
	http.HandleFunc("/system/utils/notebook/save", system_util_handleNotebookSave)

	/*
		ArOZ Media Player - The basic video player
	*/
	//Open Documents Viewer
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "ArOZ Media Player",
		Desc:         "Basic Video Player",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/mediaPlayer.png",
		Version:      "1.0",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/mediaPlayer.html",
		InitEmbSize:  []int{720, 480},
		SupportedExt: []string{".mp4", ".webm", ".ogv"},
	})

	/*
		ArOZ Audio Player - Basic Audio File Player
	*/
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Audio Player",
		Desc:         "Basic Audio Player",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/audio.png",
		Version:      "1.0",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/audio.html",
		InitEmbSize:  []int{600, 175},
		SupportedExt: []string{".mp3", ".wav", ".ogg", ".flac"},
	})

	/*
		STL File Viewer - Plotted from ArOZ Online Beta
	*/
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "STL Viewer",
		Desc:         "3D Model Viewer for STL Files",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/stlViewer.png",
		Version:      "1.0",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/stlViewer.html",
		InitEmbSize:  []int{720, 480},
		SupportedExt: []string{".stl"},
	})

	/*
		Gcode File Viewer - Plotted from ArOZ Online Beta
	*/
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Gcode Viewer",
		Desc:         "Gcode Toolpath Viewer",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/gcodeViewer.png",
		Version:      "1.0",
		SupportFW:    false,
		SupportEmb:   true,
		LaunchEmb:    "SystemAO/utilities/gcodeViewer.html",
		InitEmbSize:  []int{720, 480},
		SupportedExt: []string{".gcode", ".gco"},
	})

	/*
		Basic Timer
	*/
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Timer",
		Desc:        "Basic Timer Utility",
		Group:       "Utilities",
		IconPath:    "SystemAO/utilities/img/timer.png",
		StartDir:    "SystemAO/utilities/timer.html",
		Version:     "1.0",
		SupportFW:   true,
		SupportEmb:  false,
		LaunchFWDir: "SystemAO/utilities/timer.html",
		InitFWSize:  []int{380, 190},
	})

}

/*
	Util functions
	Please put the functions in the space below
*/

/*
	Notebook function handlers
	Handle save of new notebook text file
*/

func system_util_handleNotebookSave(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	filepath, _ := mv(r, "filepath", true)
	newcontent, _ := mv(r, "content", true)
	if filepath == "" {
		sendErrorResponse(w, "Undefined filepath given.")
		return
	}

	//Check if user can write
	if !userinfo.CanWrite(filepath) {
		sendErrorResponse(w, "Write request denied")
		return
	}

	//Get real path of file
	realpath, _ := userinfo.VirtualPathToRealPath(filepath)

	//Check if file exists. If yes, remove its ownership and size allocation
	if fileExists(realpath) {
		userinfo.RemoveOwnershipFromFile(realpath)
	}
	if userinfo.StorageQuota.HaveSpace(int64(len(newcontent))) {
		//have space. Set this file to the owner's
		userinfo.RemoveOwnershipFromFile(realpath)
	} else {
		//Out of space. Add this file back to the user ownership
		userinfo.SetOwnerOfFile(realpath)
		sendErrorResponse(w, "Storage Quota Fulled")
		return
	}

	err = ioutil.WriteFile(realpath, []byte(newcontent), 0755)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	userinfo.SetOwnerOfFile(realpath)
	sendOK(w)
}
