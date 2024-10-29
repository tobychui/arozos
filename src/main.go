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
)

/*
	arozos
	author: tobychui

	To edit startup flags, see main.flag.go
	To edit main routing logic, see main.router.go
	To edit startup sequence, see startup.go

	P.S. Try to keep this file < 300 lines
*/

// Close handler, close db and clearn up everything before exit
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
	systemWideLogger.PrintAndLog("System", "<!> Shutting down auth gateway", nil)
	authAgent.Close()

	//Shutdown all storage pools
	systemWideLogger.PrintAndLog("System", "<!> Shutting down storage pools", nil)
	closeAllStoragePools()

	//Shutdown Logger
	systemWideLogger.Close()

	//Shutdown database
	systemWideLogger.PrintAndLog("System", "<!> Shutting down database", nil)
	sysdb.Close()

	//Shutdown network services
	StopNetworkServices()

	//Shutdown FTP Server
	if FTPManager != nil {
		systemWideLogger.PrintAndLog("System", "<!> Shutting down FTP Server", nil)
		FTPManager.StopFtpServer()
	}

	//Cleaning up tmp files
	systemWideLogger.PrintAndLog("System", "<!> Cleaning up tmp folder", nil)
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
	//Updates 2022-09-06: Gzip handler moved inside the master router
	http.Handle("/", mrouter(fs))

	//Setup handler for Ctrl +C
	SetupCloseHandler()

	//Start http server
	go func() {
		if *use_tls {
			if !*disable_http {
				go func() {
					log.Println("Standard (HTTP) Web server listening at :" + strconv.Itoa(*listen_port))
					http.ListenAndServe(*listen_host+":"+strconv.Itoa(*listen_port), nil)
				}()
			}
			log.Println("Secure (HTTPS) Web server listening at :" + strconv.Itoa(*tls_listen_port))
			http.ListenAndServeTLS(*listen_host+":"+strconv.Itoa(*tls_listen_port), *tls_cert, *tls_key, nil)
		} else {
			log.Println("Web server listening at :" + strconv.Itoa(*listen_port))
			http.ListenAndServe(*listen_host+":"+strconv.Itoa(*listen_port), nil)
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
