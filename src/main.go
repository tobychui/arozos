package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	console "imuslab.com/arozos/mod/console"
	"imuslab.com/arozos/mod/network/gzipmiddleware"
)

/*
	arozos
	author: tobychui

	To edit startup flags, see main.flag.go
	To edit main routing logic, see main.router.go
	To edit startup sequence, see startup.go

	P.S. Try to keep this file < 300 lines
*/

//Close handler, close db and clearn up everything before exit
func SetupCloseHandler() {
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		executeShutdownSequence()
	}()
}

func executeShutdownSequence() {
	//Shutdown authAgent
	log.Println("\r- Shutting down auth gateway")
	authAgent.Close()

	//Shutdown all storage pools
	log.Println("\r- Shutting down storage pools")
	closeAllStoragePools()

	//Shutdown Subservices
	log.Println("\r- Shutting down background subservices")
	//system_subservice_handleShutdown()

	//Shutdown database
	log.Println("\r- Shutting down database")
	sysdb.Close()

	//Shutdown network services
	StopNetworkServices()

	//Shutdown FTP Server
	if ftpServer != nil {
		log.Println("\r- Shutting down FTP Server")
		ftpServer.Close()
	}

	//Cleaning up tmp files
	log.Println("\r- Cleaning up tmp folder")
	os.RemoveAll(*tmp_directory)
	//Do other things
	os.Exit(0)
}

func main() {
	//Parse startup flags and paramters
	flag.Parse()

	//Handle version printing
	if *show_version {
		fmt.Println("ArozOS " + build_version + " Revision " + internal_version)
		fmt.Println("Developed by tobychui and other co-developers, Licensed to " + deviceVendor)
		//fmt.Println("THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.")
		os.Exit(0)
	}

	//Handle flag assignments
	max_upload_size = int64(*max_upload) << 20 //Parse the max upload size
	if *demo_mode {                            //Disable hardware man under demo mode
		enablehw := false
		allow_hardware_management = &enablehw
	}

	//Setup handler for Ctrl +C
	SetupCloseHandler()

	//Clean up previous tmp files
	final_tmp_directory := filepath.Clean(*tmp_directory) + "/tmp/"
	tmp_directory = &final_tmp_directory
	os.RemoveAll(*tmp_directory)
	os.Mkdir(*tmp_directory, 0777)

	//Print copyRight information
	log.Println("ArozOS(C) " + strconv.Itoa(time.Now().Year()) + " " + deviceVendor + ".")
	log.Println("ArozOS " + build_version + " Revision " + internal_version)

	/*
		New Implementation of the ArOZ Online System, Sept 2020
	*/
	RunStartup()

	/*
		Development build test execution
	*/
	Run_Test()

	//Initiate all the static files transfer
	fs := http.FileServer(http.Dir("./web"))
	if *enable_gzip {
		//Gzip enabled. Always serve with gzip if header exists
		http.Handle("/", gzipmiddleware.Compress(mrouter(fs)))
	} else {
		//Normal file server without gzip
		http.Handle("/", mrouter(fs))
	}

	//Set database read write to ReadOnly after startup if demo mode
	if *demo_mode {
		sysdb.UpdateReadWriteMode(true)
	}

	//Start http server
	go func() {
		if *use_tls {
			if !*disable_http {
				go func() {
					log.Println("Standard (HTTP) Web server listening at :" + strconv.Itoa(*listen_port))
					http.ListenAndServe(":"+strconv.Itoa(*listen_port), nil)
				}()
			}
			log.Println("Secure (HTTPS) Web server listening at :" + strconv.Itoa(*tls_listen_port))
			http.ListenAndServeTLS(":"+strconv.Itoa(*tls_listen_port), *tls_cert, *tls_key, nil)
		} else {
			log.Println("Web server listening at :" + strconv.Itoa(*listen_port))
			http.ListenAndServe(":"+strconv.Itoa(*listen_port), nil)
		}
	}()

	if *enable_console == true {
		//Startup interactive shell for debug and basic controls
		Console := console.NewConsole(consoleCommandHandler)
		Console.ListenAndHandle()
	} else {
		//Just do a blocking loop here
		select {}
	}

}
