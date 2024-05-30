# ArozOS 2.0

This is the go implementation of ArozOS (aka ArOZ Online) Web Desktop environment,designed to run on linux, but somehow still works on Windows and Mac OS

This README file is intended for developer only. If you are normal users, please refer to the README file outside of the /src folder. 

## Development Notes

- Start each module with {ModuleName}Init() function, e.g. ```WiFiInit()```
- Put your function in mod (if possible) and call it in the main program
- Do not change the sequence in the startup() function unless necessary
- When in doubt, add startup flags (and use startup flag to disable experimental functions on startup)

## Vendor Resources Overwrite

If you want to overwrite vendor related resources in ArozOS 2.012 or above, create a folder in the system root named ```vendor-res``` and put the replacement files inside here. Here is a list of supported replacement resources files

| Filename        | Recommended Format | Usage                    |
| --------------- | ------------------ | ------------------------ |
| auth_bg.jpg     | 2938 x 1653 px     | Login Wallpaper          |
| auth_icon.png   | 5900 x 1180 px     | Authentication Page Logo |
| vendor_icon.png | 1560 x 600 px      | Vendor Brand Icon        |

(To be expanded)

## File System Virtualization and File System Abstractions Layers

The ArozOS system contains both the virtualization layer and abstraction layer. The easiest way to check if your path is under which layer is by looking at their starting dir name.

| Path Structure                                | Example Path                                         | Layer                                            |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| {vroot_id}:/{subpath}                         | user:/Desktop/myfile.txt                             | File System Virtualization Layer (Highest Layer) |
| fsh (*File System Handler) + subpath (string) | fsh (localfs) + /files/users/alan/Desktop/myfile.txt | File System Abstraction                          |
| {physical_location}/{subpath}                 | /home/aroz/arozos/files/users/Desktop/myfile.txt     | Physical (Disk) Layer                            |

Since ArozOS v2.000, we added File System Abstraction (fsa, or sometime as seen as fshAbs, abbr for "File System Handler underlaying File System Abstraction) to the (already complex) File System Handler (fsh) infrastruture.  There are two type of fsh that are currently supported by ArozOS File System Abstraction layer.

## ArOZ JavaScript Gateway Interface / Plugin Loader

The ArOZ AJGI / AGI interface provide a JavaScript programmable interface for ArozOS users to create 
plugin for the system. To initiate the module, you can place a "init.agi" file in the web directory of the module
(also named the module root). See more details in the `agi-doc.md`

AGI script can be run as different scope and permissions. 

| Scope                                      | Usable Functions                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| WebApp startup script (init.agi)           | System Functions and Registrations                                                  |
| WebApp contained scripts                   | System Functions and User Functions                                                 |
| Others (Web Root / Serverless / Scheduler) | System Functions, User Functions ( with script register owner scope) and serverless |

## Subservice Logics and Configuration

To intergrate other binary based web server to the subservice interface,
you can create a folder inside the "./subservice/your_service" where your binary
executable should be named identically with the containing directory.
For example, you have a module that provides web ui named "demo.exe",
then your should put the demo.exe into "./subservice/demo/demo.exe".

In the case of Linux environment, the subservice routine will first if the 
module is installed via apt-get by checking with the "which" program. (If you got busybox, it should be built in)
If the package is not found in the apt list, the binary of the program will be searched
under the subservice directory.

Please follow the naming convention given in the build.sh template.
For example, the corresponding platform will search for the corresponding binary excitable filename:

```
demo_linux_amd64    => Linux AMD64
demo_linux_arm      => Linux ARMv6l / v7l
demo_linux_arm64    => Linux ARM64
demo_macOS_amd64    => MacOS AMD64 
```

### Startup Flags

During the startup of the subservice, two types of parameter will be passed in. Here are the examples

```
demo.exe -info
demo.exe -port 12810 -rpt "http://localhost:8080/api/ajgi/interface"
```

In the case of receiving the "info" flag, the program should print the JSON string with correct module information
as stated in the struct below.

```
//Struct for storing module information
type serviecInfo struct{
    Name string                //Name of this module. e.g. "Audio"
    Desc string                //Description for this module
    Group string            //Group of the module, e.g. "system" / "media" etc
    IconPath string            //Module icon image path e.g. "Audio/img/function_icon.png"
    Version string            //Version of the module. Format: [0-9]*.[0-9][0-9].[0-9]
    StartDir string         //Default starting dir, e.g. "Audio/index.html"
    SupportFW bool             //Support floatWindow. If yes, floatWindow dir will be loaded
    LaunchFWDir string         //This link will be launched instead of 'StartDir' if fw mode
    SupportEmb bool            //Support embedded mode
    LaunchEmb string         //This link will be launched instead of StartDir / Fw if a file is opened with this module
    InitFWSize []int         //Floatwindow init size. [0] => Width, [1] => Height
    InitEmbSize []int        //Embedded mode init size. [0] => Width, [1] => Height
    SupportedExt []string     //Supported File Extensions. e.g. ".mp3", ".flac", ".wav"
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

When receiving the port flag, the program should start the web ui at the given port. The following is an example for 
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
.noproxy        => Do not start a proxy to the given port
.startscript    => Send the launch parameter to the "start.bat" or "start.sh" file instead of the binary executable
.disabled        => Do not load this subservice during startup. But the user can enable it via the setting interface
```

Here is an example "start.bat" used in integrating Syncthing into ArOZ Online System with ".startscript" file placed next
to the syncthing.exe file.

```
if not exist ".\config" mkdir ".\config"
syncthing.exe -home=".\config" -no-browser -gui-address=127.0.0.1%2
```

## Systemd support

To enable systemd in your host that support aroz online system, create a bash script at your aroz online root named "start.sh"
and fill it up with your prefered startup paratmers. The most basic one is as follow:

```
#/bin/bash
sudo ./aroz_online_linux_amd64
```

And then you can create a new file called "arozos.service" in /etc/systemd/system with the following contents (Assume your aroz online root is at /home/pi/arozos)

```
[Unit]
Description=ArozOS Cloud Desktop Service.

[Service]
Type=simple
WorkingDirectory=/home/pi/arozos/
ExecStart=/bin/bash /home/pi/arozos/start.sh

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Finally to enable the service, use the following systemd commands

```
#Enable the script during the startup process
sudo systemctl enable arozos.service

#Start the service now
sudo systemctl start arozos.service

#Show the status of the service
systemctl status arozos.service


#Disable the service if you no longer want it to start during boot
sudo systemctl disable aroz-online.service
```
