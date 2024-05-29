package main

import (
	"flag"
	"os"
	"time"

	apt "imuslab.com/arozos/mod/apt"
	auth "imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/disk/raid"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/media/mediaserver"
	permission "imuslab.com/arozos/mod/permission"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/www"
)

/*
	System Flags
*/

// =========== SYSTEM PARAMTERS  ==============
var sysdb *db.Database        //System database
var authAgent *auth.AuthAgent //System authentication agent
var permissionHandler *permission.PermissionHandler
var userHandler *user.UserHandler         //User Handler
var packageManager *apt.AptPackageManager //Manager for package auto installation
var raidManager *raid.Manager             //Software RAID Manager, only activate on Linux hosts
var userWwwHandler *www.Handler           //User Webroot handler
var mediaServer *mediaserver.Instance     //Media handling server for streaming and downloading large files
var subserviceBasePort = 12810            //Next subservice port

// =========== SYSTEM BUILD INFORMATION ==============
var build_version = "development"                      //System build flag, this can be either {development / production / stable}
var internal_version = "0.2.020"                       //Internal build version, [fork_id].[major_release_no].[minor_release_no]
var deviceUUID string                                  //The device uuid of this host
var deviceVendor = "IMUSLAB.INC"                       //Vendor of the system
var deviceVendorURL = "http://imuslab.com"             //Vendor contact information
var deviceModel = "AR100"                              //Hardware Model of the system
var deviceModelDesc = "General Purpose Cloud Platform" //Device Model Description
var vendorResRoot = "./vendor-res/"                    //Root folder for vendor overwrite resources

// =========== RUNTTIME RELATED ================
var max_upload_size int64 = 8192 << 20                         //Maxmium upload size, default 8GB
var sudo_mode bool = (os.Geteuid() == 0 || os.Geteuid() == -1) //Check if the program is launched as sudo mode or -1 on windows
var startupTime int64 = time.Now().Unix()                      //The startup time of the ArozOS Core
var systemWideLogger *logger.Logger                            //The sync map to store all system wide loggers

// =========== SYSTEM FLAGS ==============
// Flags related to System startup
var listen_port = flag.Int("port", 8080, "Listening port for HTTP server")
var tls_listen_port = flag.Int("tls_port", 8443, "Listening port for HTTPS server")
var show_version = flag.Bool("version", false, "Show system build version")
var host_name = flag.String("hostname", "My ArOZ", "Default name for this host")
var system_uuid = flag.String("uuid", "", "System UUID for clustering and distributed computing. Only need to config once for first time startup. Leave empty for auto generation.")
var disable_subservices = flag.Bool("disable_subservice", false, "Disable subservices completely")

// Flags related to Networking
var allow_upnp = flag.Bool("allow_upnp", false, "Enable uPNP service, recommended for host under NAT router")
var allow_ssdp = flag.Bool("allow_ssdp", true, "Enable SSDP service, disable this if you do not want your device to be scanned by Windows's Network Neighborhood Page")
var allow_mdns = flag.Bool("allow_mdns", true, "Enable MDNS service. Allow device to be scanned by nearby ArOZ Hosts")
var force_mac = flag.String("force_mac", "", "Force MAC address to be used for discovery services. If not set, it will use the first NIC")
var disable_ip_resolve_services = flag.Bool("disable_ip_resolver", false, "Disable IP resolving if the system is running under reverse proxy environment")
var enable_gzip = flag.Bool("gzip", true, "Enable gzip compress on file server")

// Flags related to Security
var use_tls = flag.Bool("tls", false, "Enable TLS on HTTP serving (HTTPS Mode)")
var disable_http = flag.Bool("disable_http", false, "Disable HTTP server, require tls=true")
var tls_cert = flag.String("cert", "localhost.crt", "TLS certificate file (.crt)")
var tls_key = flag.String("key", "localhost.key", "TLS key file (.key)")
var session_key = flag.String("session_key", "", "Session key, must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256). Leave empty for auto generated.")

// Flags related to hardware or interfaces
var allow_hardware_management = flag.Bool("enable_hwman", true, "Enable hardware management functions in system")
var allow_power_management = flag.Bool("enable_pwman", true, "Enable power management of the host system")
var wpa_supplicant_path = flag.String("wpa_supplicant_config", "/etc/wpa_supplicant/wpa_supplicant.conf", "Path for the wpa_supplicant config")
var wan_interface_name = flag.String("wlan_interface_name", "wlan0", "The default wireless interface for connecting to an AP")
var skip_mdadm_reload = flag.Bool("skip_mdadm_reload", false, "Skip mdadm reload config during startup, might result in werid RAID device ID in some Linux distro")

// Flags related to files and uploads
var max_upload = flag.Int("max_upload_size", 8192, "Maxmium upload size in MB. Must not exceed the available ram on your system")
var upload_buf = flag.Int("upload_buf", 25, "Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower).")
var storage_config_file = flag.String("storage_config", "./system/storage.json", "File location of the storage config file")
var tmp_directory = flag.String("tmp", "./", "Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD")
var root_directory = flag.String("root", "./files/", "User root directories")
var file_opr_buff = flag.Int("iobuf", 1024, "Amount of buffer memory for IO operations")
var enable_dir_listing = flag.Bool("dir_list", true, "Enable directory listing")
var enable_asyncFileUpload = flag.Bool("upload_async", false, "Enable file upload buffering to run in async mode (Faster upload, require RAM >= 8GB)")

// Flags related to file system abstractions
var bufferPoolSize = flag.Int("buffpool_size", 1024, "Maxmium buffer pool size (in MB) for buffer required file system abstractions")
var bufferFileMaxSize = flag.Int("bufffile_size", 25, "Maxmium buffer file size (in MB) for buffer required file system abstractions")
var enable_buffering = flag.Bool("enable_buffpool", true, "Enable buffer pool for buffer required file system abstractions")

// Flags related to compatibility or testing
var enable_beta_scanning_support = flag.Bool("beta_scan", false, "Allow compatibility to ArOZ Online Beta Clusters")
var enable_console = flag.Bool("console", false, "Enable the debugging console.")
var enable_logging = flag.Bool("logging", true, "Enable logging to file for debug purpose")

// Flags related to running on Cloud Environment or public domain
var allow_public_registry = flag.Bool("public_reg", false, "Enable public register interface for account creation")
var allow_autologin = flag.Bool("allow_autologin", true, "Allow RESTFUL login redirection that allow machines like billboards to login to the system on boot")
var allow_package_autoInstall = flag.Bool("allow_pkg_install", true, "Allow the system to install package using Advanced Package Tool (aka apt or apt-get)")
var allow_homepage = flag.Bool("homepage", true, "Enable user homepage. Accessible via /www/{username}/")

// Scheduling and System Service Related
var nightlyTaskRunTime = flag.Int("ntt", 3, "Nightly tasks execution time. Default 3 = 3 am in the morning")
var maxTempFileKeepTime = flag.Int("tmp_time", 86400, "Time before tmp file will be deleted in seconds. Default 86400 seconds = 24 hours")

// Flags related to ArozOS Cluster services
var allow_clustering = flag.Bool("allow_cluster", true, "Enable cluster operations within LAN. Require allow_mdns=true flag")
var allow_iot = flag.Bool("allow_iot", true, "Enable IoT related APIs and scanner. Require MDNS enabled")
