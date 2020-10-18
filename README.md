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

## Screenshots
![Image](img/screenshots/1.png?raw=true)
![Image](img/screenshots/2.png?raw=true)
![Image](img/screenshots/3.png?raw=true)
![Image](img/screenshots/4.png?raw=true)
![Image](img/screenshots/5.png?raw=true)
![Image](img/screenshots/6.png?raw=true)

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


## Q&A
TO BE ADDED

## Buy me a coffee
Actually I don't drink coffee.
Send me something that would make me feel interested if you really want to send me something :)
