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

	apt "imuslab.com/aroz_online/mod/apt"
	auth "imuslab.com/aroz_online/mod/auth"
	console "imuslab.com/aroz_online/mod/console"
	db "imuslab.com/aroz_online/mod/database"
	permission "imuslab.com/aroz_online/mod/permission"
	user "imuslab.com/aroz_online/mod/user"
)

/*
	System Paramters
*/

//=========== SYSTEM PARAMTERS  ==============
var sysdb *db.Database        //System database
var authAgent *auth.AuthAgent //System authentication agent
var permissionHandler *permission.PermissionHandler
var userHandler *user.UserHandler         //User Handler
var packageManager *apt.AptPackageManager //Manager for package auto installation
var subserviceBasePort = 12810            //Next subservice port

// =========== SYSTEM BUILD INFORMATION ==============
var build_version = "development"                     //System build flag, this can be either {development / production / stable}
var internal_version = "0.1.104"                      //Internal build version, please follow git commit counter for setting this value. max value \[0-9].[0-9][0-9].[0-9][0-9][0-9]\
var deviceUUID string                                 //The device uuid of this host
var deviceVendor = "IMUSLAB.INC"                      //Vendor of the system
var deviceVendorURL = "http://imuslab.com"            //Vendor contact information
var deviceModel = "AR100"                             //Hardware Model of the system
var deviceModelDesc = "Personal Cloud Storage System" //Device Model Description
var iconVendor = "img/vendor/vendor_icon.png"         //Vendor icon location
var iconSystem = "img/vendor/system_icon.png"         //System icon location

// =========== RUNTTIME RELATED ================S
var max_upload_size int64 = 8192 << 20                         //Maxmium upload size, default 8GB
var sudo_mode bool = (os.Geteuid() == 0 || os.Geteuid() == -1) //Check if the program is launched as sudo mode or -1 on windows

// =========== SYSTEM FLAGS ==============
//Flags related to System startup / web services
var listen_port = flag.Int("port", 8080, "Listening port")
var show_version = flag.Bool("version", false, "Show system build version")
var host_name = flag.String("hostname", "My ArOZ", "Default name for this host")
var system_uuid = flag.String("uuid", "", "System UUID for clustering and distributed computing. Only need to config once for first time startup. Leave empty for auto generation.")
var use_tls = flag.Bool("tls", false, "Enable TLS on HTTP serving")
var tls_cert = flag.String("cert", "localhost.crt", "TLS certificate file (.crt)")
var session_key = flag.String("session_key", "super-secret-key", "Session key, must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256)")
var tls_key = flag.String("key", "localhost.key", "TLS key file (.key)")
var allow_upnp = flag.Bool("allow_upnp", false, "Enable uPNP service, recommended for host under NAT router")
var allow_ssdp = flag.Bool("allow_ssdp", true, "Enable SSDP service, disable this if you do not want your device to be scanned by Windows's Network Neighborhood Page")
var allow_mdns = flag.Bool("allow_mdns", true, "Enable MDNS service. Allow device to be scanned by nearby ArOZ Hosts")
var wpa_supplicant_path = flag.String("wpa_supplicant_config", "/etc/wpa_supplicant/wpa_supplicant.conf", "Path for the wpa_supplicant config")
var wan_interface_name = flag.String("wlan_interface_name", "wlan0", "The default wireless interface for connecting to an AP")

//Flags related to files and uploads
var max_upload = flag.Int("max_upload_size", 8192, "Maxmium upload size in MB. Must not exceed the available ram on your system")
var upload_buf = flag.Int("upload_buf", 25, "Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower).")
var storage_config_file = flag.String("storage_config", "./system/storage.json", "File location of the storage config file")
var tmp_directory = flag.String("tmp", "./", "Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD")
var root_directory = flag.String("root", "./files/", "User root directories")
var file_opr_buff = flag.Int("iobuf", 1024, "Amount of buffer memory for IO operations")
var enable_dir_listing = flag.Bool("dir_list", true, "Enable directory listing")

//Flags related to compatibility
var enable_beta_scanning_support = flag.Bool("beta_scan", false, "Allow compatibility to ArOZ Online Beta Clusters")
var enable_console = flag.Bool("console", false, "Enable the debugging console.")

//Flags related to running on Cloud Environment or public domain
var allow_public_registry = flag.Bool("public_reg", false, "Enable public register interface for account creation")
var allow_hardware_management = flag.Bool("enable_hwman", true, "Enable hardware management functions in system")
var allow_autologin = flag.Bool("allow_autologin", true, "Allow RESTFUL login redirection that allow machines like billboards to login to the system on boot")
var demo_mode = flag.Bool("demo_mode", false, "Run the system in demo mode. All directories and database are read only.")
var allow_package_autoInstall = flag.Bool("allow_pkg_install", true, "Allow the system to install package using Advanced Package Tool (aka apt or apt-get)")
var disable_ip_resolve_services = flag.Bool("disable_ip_resolver", false, "Disable IP resolving if the system is running under reverse proxy environment")
var disable_subservices = flag.Bool("disable_subservice", false, "Disable subservices completely")

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

	//Shutdown file system handler db
	log.Println("\r- Shutting down fsdb")
	CloseAllStorages()

	//Shutdown Subservices
	log.Println("\r- Shutting down background subservices")
	//system_subservice_handleShutdown()

	//Shutdown database
	log.Println("\r- Shutting down database")
	sysdb.Close()

	//Shutdown network services
	StopNetworkServices()

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
		fmt.Println("ArOZ Online " + build_version + " Revision " + internal_version)
		fmt.Println("CopyRight tobychui and other co-developers, Licensed to " + deviceVendor)
		fmt.Println("THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.")
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
	log.Println("ArOZ Online(C) 2020 " + deviceVendor + ".")
	log.Println("ArOZ Online " + build_version + " Revision " + internal_version)

	/*
		New Implementation of the ArOZ Online System, Sept 2020
	*/
	RunStartup()

	//Initiate all the static files transfer
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", mroutner(fs))

	//Set database read write to ReadOnly after startup if demo mode
	if *demo_mode {
		sysdb.UpdateReadWriteMode(true)
	}

	//Start http server
	go func() {
		if *use_tls {
			log.Println("Secure Web server listening at :" + strconv.Itoa(*listen_port))
			http.ListenAndServeTLS(":"+strconv.Itoa(*listen_port), *tls_cert, *tls_key, nil)
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
