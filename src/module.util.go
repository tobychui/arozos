package main

import (
	module "imuslab.com/arozos/mod/modules"
)

/*
	MODULE UTIL HANDLER
	This is a util module for doing basic registry works and < 20 line server side handling.

	DO NOT USE THIS TO WRITE A NEW MODULE


	>> Updates v1.112
	This util functions will be deprecated before v1.120.
	Please migrate all of the modules out as WebApps using agi interface
*/

//Register the utilities here

func util_init() {
	/*
		ArOZ Video Player - The basic video player
	*/
	//Open Documents Viewer
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Video Player",
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

}
