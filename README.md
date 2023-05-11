![Image](img/banner.png?raw=true)

<img src="https://img.shields.io/badge/License-GPLv3-blue"> <img src="https://img.shields.io/badge/Device-Raspberry%20Pi%203B%2B%20%2F%204B-red"> <img src="https://img.shields.io/badge/Made%20In%20Hong%20Kong-香港開發-blueviolet">

## Features

### User Interface

- Web Desktop Interface (Better than Synology DSM)
- Ubuntu remix Windows style startup menu and task bars
- Clean and easy to use File Manager (Support drag drop, upload etc)
- Simplistic System Setting Menu
- No-bull-shit module naming scheme

### Networking

- Basic Realtime Network Statistic
- Static Web Server (with build in Web Editor!)
- mDNS discovery + SSDP broadcast
- UPnP Port Forwarding
- WiFi Management (Support wpa_supplicant for Rpi or nmcli for Armbian)

### File / Disk Management

- Mount Disk Utilities
  - Local File Systems (ext4, NTFS, FAT etc)
  - Remote File Systems (WebDAV, SMB, SFTP etc)

- Build in Network File Sharing Servers
  - FTP, WebDAV, SFTP
  - Basic Auth based simple HTTP interface for legacy devices with outdated browser

- Virtual File System + Sandbox Architecture
- File Sharing (Similar to Google Drive)
- Basic File Operations with Real-time Progress (Copy / Cut / Paste / New File or Folder etc)

### Security

- oAuth
- LDAP
- IP White / Blacklist
- Exponential login timeout

### Extensibility

- ECMA5 (JavaScript like) scripting interface
- 3rd party Go / Python module development with sub-service reverse proxy

### Others

- Require as little as 512MB system memory and 16GB system storage
- Base on one of the most stable Linux distro - Debian
- Support for Responsive Web Design (RWD) for different screen size
- Support use as Progress WebApp (PWA) on mobile devices
- Support desktop devices with touch screen

## Build from Source

Require GO 1.20 or above (See [Instllation tutorial](https://dev.to/tobychui/install-go-on-raspberry-pi-os-shortest-tutorial-4pb)) and ffmpeg (Optional: wpa_supplicant or nmcli)

Run the following the command to build the system

```bash
git clone https://github.com/tobychui/arozos
cd ./arozos/src/
go mod tidy
go build
./arozos 
#sudo ./arozos for enabling hardware and WiFi management features
```

(Yes, it is that simple)

## Install from Precompiled Binary

### Linux (armv6 / v7, arm64 and amd64)

*(e.g. Raspberry Pi 4B, Raspberry Pi Zero W, Orange Pi, $5 tiny VPS on lightsail or ramnode, only tested with Debian based Linux)*

Install the latest version of Raspberry Pi OS / Armbian / Debian on an SD card / boot drive and boot it up. After setup and initialization is done, connect to it via SSH or use the Terminal App on your desktop to enter the following command

```bash
wget -O install.sh https://raw.githubusercontent.com/tobychui/arozos/2.0/installer/install.sh && bash install.sh
```

and follow the on-screen instruction to setup your arozos system. 

If you selected install to systemd service, you can check the status of the service using 

```
sudo systemctl status arozos
```

Otherwise, you will need to manually start the arozos using the following command

```
cd ~/arozos
sudo ./arozos
# or if you have launcher installed
sudo ./launcher
```

After installation, depending on the processing power and disk speed of your host, it will take some time for arozos to unzip the required files. Wait around 3 - 5 minutes and visit the following link to continue root admin account setups.

```
http://{ip_address_of_your_host}:8080/
```

To uninstall your ArozOS in case you screw something up, use the uninstall script in the installer folder.

### Windows (amd64)

If you are deploying on Windows, you need to add ffmpeg to %PATH% environment variable and following the steps below.

1. Create a folder a name that has no space and ASCII only
2. Download the arozos_windows_amd64.exe from the [Release Page](https://github.com/tobychui/arozos/releases) 
3. Download the web.tar.gz from the Release Page
4. Put both files into the same folder you created in step 1
5. Double click the exe file to start ArozOS
6. Click on "Allow Access" if your Windows Firewall blocked ArozOS from accessing your network
7. Visit ```http://localhost:8080/``` in your web browser to continue root admin account setups.

**Some features are not available for Windows build**

**Windows arm64 version are experimental and not tested**

### OpenWRT (mipsle) / Linux (riscv64)

OpenWRT build and Linux RSICV64 is experimental and might contains weird bugs. If you are interested to test or maintain these builds, please contact me directly.

```
wget -O arozos {binary_path_from_release}
wget -O web.tar.gz {web.tar.gz_path_from_release}
chmod -x ./arozos
sudo ./arozos
```

### Docker

Not exists yet

## Screenshots

![Image](img/screenshots/1.png?raw=true)
![Image](img/screenshots/2.png?raw=true)
![Image](img/screenshots/3.png?raw=true)
![Image](img/screenshots/4.png?raw=true)
![Image](img/screenshots/5.png?raw=true)
![Image](img/screenshots/6.png?raw=true)

## Start the ArozOS Platform

### Supported Startup Parameters

The following startup parameters are supported (v2.016)

```
  -allow_autologin
        Allow RESTFUL login redirection that allow machines like billboards to login to the system on boot (default true)
  -allow_cluster
        Enable cluster operations within LAN. Require allow_mdns=true flag (default true)
  -allow_iot
        Enable IoT related APIs and scanner. Require MDNS enabled (default true)
  -allow_mdns
        Enable MDNS service. Allow device to be scanned by nearby ArOZ Hosts (default true)
  -allow_pkg_install
        Allow the system to install package using Advanced Package Tool (aka apt or apt-get) (default true)
  -allow_ssdp
        Enable SSDP service, disable this if you do not want your device to be scanned by Windows's Network Neighborhood Page (default true)
  -allow_upnp
        Enable uPNP service, recommended for host under NAT router
  -beta_scan
        Allow compatibility to ArOZ Online Beta Clusters
  -bufffile_size int
        Maxmium buffer file size (in MB) for buffer required file system abstractions (default 25)
  -buffpool_size int
        Maxmium buffer pool size (in MB) for buffer required file system abstractions (default 1024)
  -cert string
        TLS certificate file (.crt) (default "localhost.crt")
  -console
        Enable the debugging console.
  -demo_mode
        Run the system in demo mode. All directories and database are read only.
  -dir_list
        Enable directory listing (default true)
  -disable_http
        Disable HTTP server, require tls=true
  -disable_ip_resolver
        Disable IP resolving if the system is running under reverse proxy environment
  -disable_subservice
        Disable subservices completely
  -enable_buffpool
        Enable buffer pool for buffer required file system abstractions (default true)
  -enable_hwman
        Enable hardware management functions in system (default true)
  -enable_pwman
        Enable power management of the host system (default true)
  -force_mac string
        Force MAC address to be used for discovery services. If not set, it will use the first NIC
  -gzip
        Enable gzip compress on file server (default true)
  -homepage
        Enable user homepage. Accessible via /www/{username}/ (default true)
  -hostname string
        Default name for this host (default "My ArOZ")
  -iobuf int
        Amount of buffer memory for IO operations (default 1024)
  -key string
        TLS key file (.key) (default "localhost.key")
  -logging
        Enable logging to file for debug purpose (default true)
  -max_upload_size int
        Maxmium upload size in MB. Must not exceed the available ram on your system (default 8192)
  -ntt int
        Nightly tasks execution time. Default 3 = 3 am in the morning (default 3)
  -port int
        Listening port for HTTP server (default 8080)
  -public_reg
        Enable public register interface for account creation
  -root string
        User root directories (default "./files/")
  -session_key string
        Session key, must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256). Leave empty for auto generated.
  -storage_config string
        File location of the storage config file (default "./system/storage.json")
  -tls
        Enable TLS on HTTP serving (HTTPS Mode)
  -tls_port int
        Listening port for HTTPS server (default 8443)
  -tmp string
        Temporary storage, can be access via tmp:/. A tmp/ folder will be created in this path. Recommend fast storage devices like SSD (default "./")
  -tmp_time int
        Time before tmp file will be deleted in seconds. Default 86400 seconds = 24 hours (default 86400)
  -upload_async
        Enable file upload buffering to run in async mode (Faster upload, require RAM >= 8GB)
  -upload_buf int
        Upload buffer memory in MB. Any file larger than this size will be buffered to disk (slower). (default 25)
  -uuid string
        System UUID for clustering and distributed computing. Only need to config once for first time startup. Leave empty for auto generation.
  -version
        Show system build version
  -wlan_interface_name string
        The default wireless interface for connecting to an AP (default "wlan0")
  -wpa_supplicant_config string
        Path for the wpa_supplicant config (default "/etc/wpa_supplicant/wpa_supplicant.conf")
```

Example

```
//Starting aroz online with standard web port
./arozos -port 80

//Start aroz online in demo mode
./arozos -demo_mode=true

//Use https instead of http
./arozos -tls=true -tls_port 443 -key mykey.key -cert mycert.crt -disable_http=true

//Start both HTTPS and HTTP server on two different port
./arozos -port 80 -tls=true -key mykey.key -cert mycert.crt -tls_port 443

//Change max upload size to 25MB
./arozos -max_upload_size 25
```

See documentation for more examples.

### ArozOS Launcher

Launcher is required for performing OTA updates in arozos so you don't need to ssh into your host every time you need to update ArozOS. You can install it via the installation script or install it manually. See more in the following repository. 

https://github.com/aroz-online/launcher

### Storage Configuration

Visit System Settings > Disk & Storage > Storage Pools and follow on screen instructions to setup your disk.

![](img/screenshots/sp.png)

- Name: Name of this virtual disk in ArozOS system, (e.g. Movie Storage)
- UUID: UUID of this virtual disk in ArozOS system, **must be unique, ascii only and no space** (e.g. movie)
- Path: The mounting path of the disk **in Host OS** or **Protocol Specific IP Address / URLs**. Here are some examples
  - Local disk (ntfs / ext4 etc): /media/storage1
  - WebDAV: https://example.com.com/webdav/storage
  - FTP / SFTP: 192.168.1.220:2022
  - SMB: 192.168.0.110/MyShare
    (Where "MyShare" is one of the Shares inside File Explorer if you visit \\\\192.168.0.110\)
- Access Permission: Read Only or Read Write 
- Storage Hierarchy
  - Isolated User Folder: User cannot see other user's files
  - Public Access Folders: User can see each other's files and edit them if permission is set to "READ WRITE"
- File System Type: The disk format (if local disk) or protocols (if remote file system) to mount / establish connection

Here are some local disk only options. You can leave them out if you have already setup automatic disk mount in /etc/fstab

- Mount Device: The physical disk location on your host (e.g. /dev/sda1)
- Mount Point: The target path to mount the disk to. (e.g. /media/storage)
- Automount: Check this if you want ArozOS to mount the disk for you
  *Notes: You cannot auto-mount a disk required by ArozOS -root options. Use /etc/fstab for it if that is your use case. This function is designed for delay start and reduce the power spike during system startup & disk spinups.*  

Here are some network disk only options

- Username
- Password

Credentials of your account on the remote server that you are trying to mount remotely

### File Servers

If you want to share files from ArozOS, there are many ways you can do it. 

- Share API: Right click a file in File Manager and click Share. 
- User Accounts: Create user account for a user who want to access your file and limit the scope of file access with permission group storage pool settings
- Network File Servers: Create a single shared user in a permission group with limited access settings and enable network file server in System Settings > Networks & Connections > File Servers > WebDAV / SFTP / FTP. Follow the on-screen guide to setup the access mode.
- Legacy Browser Server: Share files to legacy devices via basic HTTP and Basic Auth. You can enable it in System Settings > Networks & Connections > File Servers > Directory Server. You can login with your current ArozOS user credentials.

## WebApp Development

See [examples](examples/) folder for more details.

## Other Resources

If you are looking for other WebApps (Installed via System Setting) or subservices (Require SSH login to install, for OEM only), please take a look at our collections over here:
https://github.com/aroz-online/WebApp-and-Subservice-Index

## Community / Q&A

### 💬 Direct Contact

You can reach the authors using [Telegram](https://t.me/ArOZBeta)! We welcome all kind of feedbacks and questions.

### 🖥️ Device Compatibility Showcase

Using ArozOS on something other than Raspberry Pis? Show us your server configuration & hardware specs!

https://github.com/tobychui/arozos/issues/50

### 📝 Related Articles

If you are looking for tutorials or need help on debugging some minor issues, feel free to take a look at these articles written by our users. (Thank you so much for sharing this project :D )

#### English

- [I write my own web desktop OS for 3 years and this is what it looks like now ](https://dev.to/tobychui/i-write-my-own-web-desktop-os-for-3-years-and-this-is-what-it-looks-like-now-2903)

#### Chinese

- [ArozOS+树莓派打造随身NAS（避坑专用）](https://blog.csdn.net/m0_37728676/article/details/113876815)
- [ArozOS+树莓派小型NAS](http://www.huajia.online/2021/10/23/ArozOS-%E6%A0%91%E8%8E%93%E6%B4%BE%E5%B0%8F%E5%9E%8BNAS/)
- [树莓派 Arozos 指北](https://blog.pi-dal.com/%E9%80%82%E7%94%A8%E4%BA%8E%E6%A0%91%E8%8E%93%E6%B4%BE%E7%9A%84%E9%80%9A%E7%94%A8Web%E6%A1%8C%E9%9D%A2%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F)
- [Linux:ArozOS 安裝與建立開機自啟動服務](https://pvecli.xuan2host.com/linux-arozos-install-service/)

#### Portuguese

- [DESKTOP WEB construído e desenvolvido na LINGUAGEM GO](https://www.youtube.com/watch?v=C42UdgOySY)

Feel free to create a PR if you have written an article for ArozOS!

## License

### Source Code

ArozOS - General purpose cloud desktop platform
Copyright (C) 2023  tobychui

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License version 3 as published by the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.

### Documentations

Copyright (C)  2023 tobychui
Permission is granted to copy, distribute and/or modify this document
under the terms of the GNU Free Documentation License, Version 1.3
or any later version published by the Free Software Foundation;
with no Invariant Sections, no Front-Cover Texts, and no Back-Cover Texts.
A copy of the license is included in the section entitled "GNU
Free Documentation License".

### Artwork and Mascot Design

Copyright (C)  2023 tobychui, All Right Reserved
