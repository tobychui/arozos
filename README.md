![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-Open%20Source-blue"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In%20Hong%20Kong-香港開發-blueviolet">

## IMPORTANT NOTES
The current arozos is still under intense developmenet. System structure might change at any time. Please only develop on the current existsing ArOZ Gateway Interface (AGI) JavaScript Interface or standard HTML webapps with ao_module.js endpoints.

## Features
### User Interface
- Web Desktop Interface (Similar to Synology DSM)
- Ubuntu remix Windows style startup menu and task bars
- Clean and easy to use File Manager (Support drag drop, upload etc)
- Simplistic System Setting Menu
- No-bull-shit module naming scheme
### Networking 
- FTP Server
- WebDAV Server
- Samba (Supported via 3rd party sub-services)
- WiFi Management (Support wpa_supplicant for Rpi or nmcli for Armbian)
### File / Disk Management
- Mount / Format Disk Utilities (support NTFS, EXT4 and more!)
- Virtual File System Architecture
- File Sharing (Similar to Google Drive)
- Basic File Operations with Real-time Progress (Copy / Cut / Paste / New File or Folder etc)

## Installation
Require GO 1.14 or above

Run the following the command to build the system

```
git clone https://github.com/tobychui/arozos
cd ./arozos/src/
go build
```
(Yes, it is that simple)

## Deploy
### For Raspberry Pi (For Raspberry Pi 4B+)
If you are using Raspberry Pi as your host, you can download one of the images and flash the image into your SD card. You will find a new network device named "ArozOS (ARxxx)" pop up in your "Network Neighbourhood". Double click the icon and you will be redirect to the system Web setup interface.

|Version|Download URL|Remarks|
|---|---|---|
|arozos v1.107|https://wdfiles.ru/jv2x|Samba Supported Added|
|arozos v1.106|https://wdfiles.ru/b49v||
|arozos v1.103|https://wdfiles.ru/b49b||

*Yes, the download site is in Russia. No, I am not Russian, I use this site because they offer 80GB of storage for free*
**All the image listed above require 8GB or above microSD card**

To optain the .img file, you can unzip the compressed image using 7zip. If you don't have it, you can get it [here](https://www.7-zip.org/download.html)

### For other ARM SBC(e.g. Orange Pi / Banana Pi / Friendly ARM's Pis)
Download the correct architecture binary from the "release" tab and upload the binary with the "web" and "system" folder in "/src".
After upload, you should have the following file structure

```
$ ls
aroz_online_linux_arm64  web  system
```

Start the binary by calling ``` sudo ./aroz_online_linux_arm64 ``` (or without sudo if you prefer no hardware management)

### Windows
If you are deploying on Windows, you need to add ffmpeg to %PATH% environment variable.

This system can be built and run on Windows hosts with the following build instructions
```
# Download the whole repo as zip and cd into it
cd .\arozos\src\
go build
arozos.exe
```
**However, not all features are available for Windows**. 



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
