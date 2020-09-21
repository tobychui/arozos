package main

import (
	"net/http"
	"log"
	"os"
	"os/signal"
	"syscall"
)

/*
	Demo for showing the implementation of ArOZ Online Subservice Structure

	Proxy url is get from filepath.Dir(StartDir) of the serviceInfo.
	In this example, the proxy path is demo/*
*/

//Kill signal handler. Do something before the system the core terminate.
func SetupCloseHandler() {
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		log.Println("\r- Shutting down demo module.")
		//Do other things like close database or opened files

		os.Exit(0)
	}()
}


func main(){
	//If you have other flags to parse, put them here.
	//helloWorld = flag.String("helloworld", "Hello World", "Things to print when hello world-ing")

	//Start the aoModule pipeline (which will parse the flags as well). Pass in the module launch information
	port, aoservice := initaoModulePipeline(serviecInfo{
		Name: "Demo Subservice",
		Desc: "A simple subservice code for showing how subservice works in ArOZ Online",			
		Group: "Development",
		IconPath: "demo/icon.png",
		Version: "0.0.1",
		//You can define any path before the actualy html file. This directory (in this case demo/ ) will be the reverse proxy endpoint for this module
		StartDir: "demo/home.html",			
		SupportFW: true, 
		LaunchFWDir: "demo/home.html",
		SupportEmb: true,
		LaunchEmb: "demo/embedded.html",
		InitFWSize: []int{720, 480},
		InitEmbSize: []int{720, 480},
		SupportedExt: []string{".txt",".md"},
	});

	//Register the standard web services urls
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	//To receive kill signal from the System core, you can setup a close handler to catch the kill signal
	//This is not nessary if you have no opened files / database running 
	SetupCloseHandler()
	
	if (aoservice){
		log.Println("Demo running under ao_service mode.")
	}


	//Any log println will be shown in the core system via STDOUT redirection. But not STDIN.
	log.Println(">>>> Demo module started. Listening on: " + port)
	err := http.ListenAndServe(port, nil)
	if err != nil {
	  log.Fatal(err)
	}

}	