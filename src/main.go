package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"

	bolt "github.com/boltdb/bolt"
	mdns "github.com/grandcat/zeroconf"
)

/*
	System Paramters
*/
//System configuration format. You can override with a file named "sysconf.json" placed in root
type sysconf struct {
	Port     int
	Hostname string
}

//=========== SYSTEM PARAMTERS  ==============
var sysdb *bolt.DB                            //System database
var loadedModule []moduleInfo                 //System laoded modules
var runningSubServices []subService           //System loaded subservices
var nextPortToBeAssignedForSubService = 12810 //Next subservice port
var mDNS *mdns.Server
var startingUp = true //Indicate if the system is undergoing startup process

// =========== SYSTEM BUILD INFORMATION ==============
var build_version = "development"             //System build flag, this can be either {development / production / stable}
var internal_version = "0.0.450"              //Internal build version, please follow git commit counter for setting this value. max value \[0-9].[0-9][0-9].[0-9][0-9][0-9]\
var deviceUUID string                         //The device uuid of this host
var deviceVendor = "IMUSLAB.INC"              //Vendor of the system
var deviceModel = "AR100"                     //Hardware Model of the system
var iconVendor = "img/vendor/vendor_icon.png" //Vendor icon location
var iconSystem = "img/vendor/system_icon.png" //System icon location

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
var tls_key = flag.String("key", "localhost.key", "TLS key file (.key)")
var allow_upnp = flag.Bool("allow_upnp", false, "Enable uPNP service, recommended for host under NAT router")

//Flags related to files and uploads
var max_upload = flag.Int("max_upload_size", 8192, "Maxmium upload size in MB. Must not exceed the available ram on your system")
var upload_buf = flag.Int("upload_buf", 25, "Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower).")
var storage_config_file = flag.String("storage_config", "./system/storage.json", "File location of the storage config file")
var tmp_directory = flag.String("tmp", "./", "Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD")
var root_directory = flag.String("root", "./files/", "User root directories")
var file_opr_buff = flag.Int("iobuf", 1024, "Amount of buffer memory for IO operations")

//Flags related to compatibility
var enable_beta_scanning_support = flag.Bool("beta_scan", false, "Allow compatibility to ArOZ Online Beta Clusters")

//Flags related to running on Cloud Environment or public domain
var allow_public_registry = flag.Bool("public_reg", false, "Enable public register interface for account creation")
var allow_hardware_management = flag.Bool("enable_hwman", true, "Enable hardware management functions in system")
var demo_mode = flag.Bool("demo_mode", false, "Run the system in demo mode. All directories and database are read only.")
var allow_package_autoInstall = flag.Bool("allow_pkg_install", true, "Allow the system to install package using Advanced Package Tool (aka apt or apt-get)")
var disable_ip_resolve_services = flag.Bool("disable_ip_resolver", false, "Disable IP resolving if the system is running under reverse proxy environment")

//Close handler, close db and clearn up everything before exit
func SetupCloseHandler() {
	c := make(chan os.Signal, 2)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		//Shutdown mDNS service
		log.Println("\r- Shutting down mDNS services")
		network_mdns_shutdown()

		//Shutdown Subservices
		log.Println("\r- Shutting down background subservices")
		system_subservice_handleShutdown()

		//Shutdown database
		log.Println("\r- Shutting down database")
		system_db_closeDatabase(sysdb)

		//Shutdown uPNP service if enabled
		if *allow_upnp{
			log.Println("\r- Shutting down uPNP connection")
			network_upnp_close();
		}

		//Cleaning up tmp files
		log.Println("\r- Cleaning up tmp folder")
		os.RemoveAll(*tmp_directory)
		//Do other things
		os.Exit(0)
	}()
}

/*
	Custom File Server MiddleWare

	This is used to check authentication before actually serving file to the target client
	This function also handle the special page (login.system and user.system) delivery
*/
func mdlwr(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		/*
			You can also check the path for url using r.URL.Path
		*/

		if r.URL.Path == "/favicon.ico" {
			//Serving favicon. Allow no auth access.
			h.ServeHTTP(w, r)
		} else if r.URL.Path == "/login.system" {
			//Login page. Require special treatment for template.
			//Get the redirection address from the request URL
			red, _ := mv(r, "redirect", false)

			//Append the redirection addr into the template
			imgsrc := "./web/" + iconSystem
			if !fileExists(imgsrc) {
				imgsrc = "./web/img/public/auth_icon.png"
			}
			imageBase64, _ := LoadImageAsBase64(imgsrc)
			parsedPage, err := template_load("web/login.system", map[string]interface{}{
				"redirection_addr": red,
				"usercount":        strconv.Itoa(system_auth_getUserCounts()),
				"service_logo":     imageBase64,
			})
			if err != nil {
				panic("Error. Unable to parse login page. Is web directory data exists?")
			}
			sendTextResponse(w, parsedPage)
		} else if r.URL.Path == "/user.system" && system_auth_getUserCounts() == 0 {
			//Serve user management page. This only allows serving of such page when the total usercount = 0 (aka System Initiation)
			h.ServeHTTP(w, r)

		} else if (len(r.URL.Path) > 11 && r.URL.Path[:11] == "/img/public") || (len(r.URL.Path) > 7 && r.URL.Path[:7] == "/script") {
			//Public image directory. Allow anyone to access resources inside this directory.
			if filepath.Ext("web"+system_fs_specialURIDecode(r.RequestURI)) == ".js" {
				//Fixed serve js meme type invalid bug on Firefox
				w.Header().Add("Content-Type", "application/javascript; charset=UTF-8")
			}
			h.ServeHTTP(w, r)
		} else if r.URL.Path == "/" && system_auth_chkauth(w, r) {
			//Index. Serve without caching
			w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			h.ServeHTTP(w, r)
		} else if system_auth_chkauth(w, r) {
			//User logged in. Continue to serve the file the client want
			system_auth_extendSessionExpireTime(w, r)
			if build_version == "development" {
				//Disable caching when under development build
				//w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			}
			if filepath.Ext("web"+system_fs_specialURIDecode(r.RequestURI)) == ".js" {
				//Fixed serve js meme type invalid bug on Firefox
				w.Header().Add("Content-Type", "application/javascript; charset=UTF-8")
			}

			//Check if this path is reverse proxy path. If yes, serve with proxyserver
			isRP, proxy, rewriteURL := system_subservice_checkIfReverseProxyPath(r)
			if isRP {
				r.URL, _ = url.Parse(rewriteURL)
				username, _ := system_auth_getUserName(w, r)
				r.Header.Set("aouser", username)
				r.Header.Set("X-Forwarded-Host", r.Host)
				r.Host = r.URL.Host
				proxy.ServeHTTP(w, r)
			} else {
				h.ServeHTTP(w, r)
			}

		} else {
			//User not logged in. Redirect to login interface
			w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
			http.Redirect(w, r, "/login.system?redirect="+r.URL.Path, 307)
		}

	})
}

/*
	General functions for all modules.
*/

//Force redirection to login page
func redirectToLoginPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
	http.Redirect(w, r, "/login.system?redirect="+r.URL.Path, 307)
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

	//Handle uPNP setup
	if *allow_upnp{
		network_upnp_init()
	}

	//Initiate the main system database
	sysdb = system_db_service_init("system/ao.db")

	//Register the auth & permission service for page access
	system_auth_service_init()       //Start auth services
	system_user_init()               //Start user management services
	system_permission_service_init() //Start group permission services
	system_subservice_init()         //Start subservice modules
	system_storage_service_init()    //Initiate system storage devices
	system_fs_service_init()         //Initiate file system API
	system_setting_init()            //Initiate system setting API
	system_ajgi_init()               //Initiate system plugin interface

	//Handle System Hardware Mangement Interfaces
	hardware_power_init()

	//Initiate all the static files transfer
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", mdlwr(fs))

	//Handle system core modules initiation
	desktop_init()

	//Handle System Utils Services Inits
	system_disk_space_init() //Handle Disk space listener
	system_disk_quota_init() //Handle disk quota managements
	system_disk_smart_init() //Handle SMART

	system_info_serviec_init()  //Display system configuration
	network_info_service_init() //Network aka NIC information
	system_dev_init()           //Device Reflection Services

	//Handle System Clustering and Scanning
	system_id_init()    //Init system about information
	network_mdns_init() //Initialize mDNS services

	//Handle System Time
	system_time_init() // Init time servicesl

	//Handle other system modules initiation
	mediaServer_init()           //Handle media delivery, see mediaServer.go
	system_module_service_init() //Handler module services
	module_package_init()        //Handler module for package installations
	//Place the modules init() function you want to build with the system here
	module_Music_init() //Music Player
	//module_Video_init() //Video Player
	//module_Photo_init() //Photo

	util_init() //Initialize utilties

	/*
		Testing modules
		Place them here if you want to test some modules before the system start web services
	*/

	//Set starting up flag to false
	startingUp = false

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
	select {}

}
