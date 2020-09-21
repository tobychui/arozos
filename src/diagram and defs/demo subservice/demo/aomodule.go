package main

import (
	"flag"
	"fmt"
	"encoding/json"
	"os"
)

//Struct for storing module information
type serviecInfo struct{
	Name string				//Name of this module. e.g. "Audio"
	Desc string				//Description for this module
	Group string			//Group of the module, e.g. "system" / "media" etc
	IconPath string			//Module icon image path e.g. "Audio/img/function_icon.png"
	Version string			//Version of the module. Format: [0-9]*.[0-9][0-9].[0-9]
	StartDir string 		//Default starting dir, e.g. "Audio/index.html"
	SupportFW bool 			//Support floatWindow. If yes, floatWindow dir will be loaded
	LaunchFWDir string 		//This link will be launched instead of 'StartDir' if fw mode
	SupportEmb bool			//Support embedded mode
	LaunchEmb string 		//This link will be launched instead of StartDir / Fw if a file is opened with this module
	InitFWSize []int 		//Floatwindow init size. [0] => Width, [1] => Height
	InitEmbSize []int		//Embedded mode init size. [0] => Width, [1] => Height
	SupportedExt []string 	//Supported File Extensions. e.g. ".mp3", ".flac", ".wav"
}

func initaoModulePipeline(info serviecInfo) (string, bool){
	var infoRequestMode = flag.Bool("info", false, "Show information about this subservice")
	var port = flag.String("port", ":80", "The default listening endpoint for this subservice")
	var aoService = flag.Bool("aoservice", false, "Check if the system is running in aoservice mode")
	flag.Parse();

	if (*infoRequestMode == true){
		//Information request mode
		jsonString, _ := json.Marshal(info);
		fmt.Println(string(jsonString))
		os.Exit(0);
	}

	//Run mode. Continue to run the web services with given port
	return *port, *aoService;
}
