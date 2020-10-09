# ArOZ Online

This is the go implementation of ArOZ Online Web Desktop environment, perfect for Linux server usage.

## Development Notes

WIP

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

## System Endpoints

### Authentication Related
- "/system/auth/login"
	- username (POST)
	- password (POST)
- "/system/auth/logout"
- "/system/auth/checkLogin"
- "/system/auth/register"
	- username (POST)
	- password (POST)
	- group (POST)
- "/system/auth/unregister"
	- username (POST)
- "/system/auth/reflectIP"
	- port (GET, Optional)

### Media Delivery Related
- "/media"
	- file (GET, URL Encoded)

## No-auth Access Location
The following paths are specially configured to be accessable without login.

- "/img/public/*"
- "/script/*"
- "/login.system"
- "/user.system" ***(Only when there are no user in the system)***

