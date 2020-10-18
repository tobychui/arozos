![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-Open%20Source-blue"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In%20Hong%20Kong-香港開發-blueviolet">

## IMPORTANT NOTES
The current version of ArOZ Online System is migrating to Golang and the architecture might not be stable.
Please use this with your own risk. And, we are surely we will change the structure of this system really soon.
This is for front end development / endpoint dev only.

## Installation
Require GO 1.14 or above

Run the following the command to build the system

```
go build
```
(Yes, it is that simple)

## Start the ArOZ Online Platform

### Supported Startup Paramters
The following startup paramters are supported.
```
  -allow_pkg_install
        Allow the system to install package using Advanced Package Tool (aka apt or apt-get) (default true)
  -beta_scan
        Allow compatibility to ArOZ Online Beta Clusters
  -cert string
        TLS certificate file (.crt) (default "localhost.crt")
  -demo_mode
        Run the system in demo mode. All directories and database are read only.
  -disable_ip_resolver
        Disable IP resolving if the system is running under reverse proxy environment
  -enable_hwman
        Enable hardware management functions in system (default true)
  -hostname string
        Default name for this host (default "My ArOZ")
  -iobuf int
        Amount of buffer memory for IO operations (default 1024)
  -key string
        TLS key file (.key) (default "localhost.key")
  -max_upload_size int
        Maxmium upload size in MB. Must not exceed the available ram on your system (default 8192)
  -port int
        Listening port (default 8080)
  -public_reg
        Enable public register interface for account creation
  -root string
        User root directories (default "./files/")
  -storage_config string
        File location of the storage config file (default "./system/storage.json")
  -tls
        Enable TLS on HTTP serving
  -tmp string
        Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD (default "./")
  -upload_buf int
        Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower). (default 25)
  -uuid string
        System UUID for clustering and distributed computing. Only need to config once for first time startup. Leave empty for auto generation.
  -version
        Show system build version
```

Example
```
//Starting aroz online with standard web port
./aroz_online -port 80

//Start aroz online in demo mode
./aroz_online -demo_mode=true

//Use https instead of http 
./aroz_online -tls=true -key mykey.key -cert mycert.crt

//Change max upload size to 25MB
./aroz_online -max_upload_size 25

```

### Storage.json
This file define the storage devices to be mounted into aroz online system. See src/system/storage.json.example for template.


## ArOZ JavaScript Gateway Interface / Plugin Loader
The ArOZ AJGI / AGI interface provide a javascript programmable interface for ArOZ Online users to create 
plugin for the system. To initiate the module, you can place a "init.agi" file in the web directory of the module
(also named the module root). See more details in the [AJGI Documentation](AJGI Documentation.md).

## Subservice Logics and Configuration
To intergrate other binary based web server to the subservice interface,
you can create a folder inside the "./subservice/your_service" where your binary
executable should be named identically with the containing directory.
For example, you have a module that provides web ui named "demo.exe",
then your should put the demo.exe into "./subservice/demo/demo.exe".

In the case of Linux environment, the subservice routine will first if the 
module is installed via apt-get by checking with the "whereis" program.
If the package is not found in the apt list, the binary of the program will be searched
under the subservice directory.

Please follow the naming convention given in the build.sh template.
For example, the corrisponding platform will search for the corrisponding binary excutable filename:
```
demo_linux_amd64	=> Linux AMD64
demo_linux_arm		=> Linux ARMv6l / v7l
demo_linux_arm64	=> Linux ARM64
demo_macOS_amd64	=> MacOS AMD64 (Not tested)
```

### Startup Flags
During the tartup of the subservice, two paramters will be passed in. Here are the examples
```
demo.exe -info
demo.exe -port 12810
```

In the case of reciving the "info" flag, the program should print the JSON string with correct module information
as stated in the struct below.
```
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

//Example Usage when reciving the -info flag
infoObject := serviecInfo{
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
	}
	
jsonString, _ := json.Marshal(info);
fmt.Println(string(infoObject))
os.Exit(0);
```

When reciving the port flag, the program should start the web ui at the given port. The following is an example for 
the implementation of such functionality.

```
var port = flag.String("port", ":80", "The default listening endpoint for this subservice")
flag.Parse()
err := http.ListenAndServe(*port, nil)
if err != nil {
	log.Fatal(err)
}
```


### Subservice Exec Settings
In default, subservice routine will create a reverse proxy with URL rewrite build in that serve your web ui launched
from the binary executable. If you do not need a reverse proxy connection, want a custom launch script or else, you can 
use the following setting files.

```
.noproxy		=> Do not start a proxy to the given port
.startscript	=> Send the launch parameter to the "start.bat" or "start.sh" file instead of the binary executable
.suspended		=> Do not load this subservice during startup. But the user can enable it via the setting interface
```

Here is an example "start.bat" used in integrating Syncthing into ArOZ Online System with ".startscript" file placed next
to the syncthing.exe file.
```
if not exist ".\config" mkdir ".\config"
syncthing.exe -home=".\config" -no-browser -gui-address=127.0.0.1%2
```


## Q&A
TO BE ADDED

## Buy me a coffee
Actually I don't drink coffee.
Send me something that would make me feel interested if you really want to send me something :)
