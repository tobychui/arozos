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
		InitEmbSize:  []int{720, 500},
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
		InitEmbSize:  []int{533, 164},
		SupportedExt: []string{".mp3", ".wav", ".ogg", ".flac"},
	})

	/*
		3D Model Viewer and Gcode Viewer

		Both superseded by the "3D Viewer" WebApp in ./web/3D Viewer/, which
		registers itself from its own init.agi and additionally supports
		GLB/glTF, PLY, 3MF, FBX, DAE, STEP/IGES/BREP and sliced G-code.
	*/

	/*
		Image Paste
	*/
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:         "Image Paste",
		Desc:         "Paste image from clipboard to cloud storage",
		Group:        "Utilities",
		IconPath:     "SystemAO/utilities/img/ImagePaste.png",
		Version:      "1.0",
		StartDir:     "SystemAO/utilities/imgPaste.html",
		SupportFW:    true,
		SupportEmb:   false,
		LaunchFWDir:  "SystemAO/utilities/imgPaste.html",
		InitFWSize:   []int{720, 500},
		SupportedExt: []string{".png", ".jpg", ".jpeg", ".webp"},
	})

}
