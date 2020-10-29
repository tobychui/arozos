package main

import (
	"io/ioutil"
	"net/http"
)

/*
	MODULE UTIL HANDLER
	This is a util module for doing basic registry works and < 20 line server side handling.

	DO NOT USE THIS TO WRITE A NEW MODULE

*/

//Register the utilities here

func util_init(){
	//PDF Viewer
	registerModule(moduleInfo{
		Name: "PDF Reader",
		Desc: "The browser build in PDF Reader",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/pdfReader.png",
		Version: "1.2",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/pdfReader.html",
		InitEmbSize: []int{1080, 580},
		SupportedExt: []string{".pdf"},
	})

	//Open Documents Viewer
	registerModule(moduleInfo{
		Name: "OpenOffice Reader",
		Desc: "Open OpenOffice files",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/odfReader.png",
		Version: "0.8",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/odfReader.html",
		InitEmbSize: []int{1080, 580},
		SupportedExt: []string{".odt",".odp",".ods"},
	})

	/*
		Notebook - The build in basic text editor
	*/
	//Open Documents Viewer
	registerModule(moduleInfo{
		Name: "Notebook",
		Desc: "Basic Text Editor",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/notebook.png",
		Version: "1.0",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/notebook.html",
		InitEmbSize: []int{1080, 580},
		SupportedExt: []string{".txt",".md"},
	});
	http.HandleFunc("/system/utils/notebook/save", system_util_handleNotebookSave);


	/*
		ArOZ Media Player - The basic video player
	*/
	//Open Documents Viewer
	registerModule(moduleInfo{
		Name: "ArOZ Media Player",
		Desc: "Basic Video Player",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/mediaPlayer.png",
		Version: "1.0",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/mediaPlayer.html",
		InitEmbSize: []int{720, 480},
		SupportedExt: []string{".mp4",".webm",".ogv"},
	});

	/*
		STL File Viewer - Plotted from ArOZ Online Beta
	*/
	registerModule(moduleInfo{
		Name: "STL Viewer",
		Desc: "3D Model Viewer for STL Files",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/stlViewer.png",
		Version: "1.0",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/stlViewer.html",
		InitEmbSize: []int{720, 480},
		SupportedExt: []string{".stl"},
	});

	/*
		Gcode File Viewer - Plotted from ArOZ Online Beta
	*/
	registerModule(moduleInfo{
		Name: "Gcode Viewer",
		Desc: "Gcode Toolpath Viewer",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/gcodeViewer.png",
		Version: "1.0",
		SupportFW: false,
		SupportEmb: true,
		LaunchEmb: "SystemAO/utilities/gcodeViewer.html",
		InitEmbSize: []int{720, 480},
		SupportedExt: []string{".gcode",".gco"},
	});


	/*
		Basic Timer
	*/
	registerModule(moduleInfo{
		Name: "Timer",
		Desc: "Basic Timer Utility",
		Group: "Utilities",
		IconPath: "SystemAO/utilities/img/timer.png",
		StartDir: "SystemAO/utilities/timer.html",
		Version: "1.0",
		SupportFW: true,
		SupportEmb: false,
		LaunchFWDir: "SystemAO/utilities/timer.html",
		InitFWSize: []int{380,190},
	});

}

/*
	Util functions
	Please put the functions in the space below
*/

/*
	Notebook function handlers
	Handle save of new notebook text file
*/

func system_util_handleNotebookSave(w http.ResponseWriter, r *http.Request){
	username, err := authAgent.GetUserName(w,r)
	if (err != nil){
		sendErrorResponse(w, "User not logged in")
		return;
	}
	userinfo, _ := userHandler.GetUserInfoFromUsername(username)
	filepath, _ := mv(r, "filepath", true)
	newcontent, _ := mv(r, "content", true)
	if (filepath == ""){
		sendErrorResponse(w, "Undefined filepath given.")
		return;
	}
	realpath, _ := userinfo.VirtualPathToRealPath(filepath)
	err = ioutil.WriteFile(realpath, []byte(newcontent), 0755)
	if (err != nil){
		sendErrorResponse(w, err.Error())
		return
	}
	sendOK(w);
}