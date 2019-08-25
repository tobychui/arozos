# Distribution Package Naming Scheme
**This is the dist-packs for other Linux Platform / other SBCs. If you are looking for distribution image for Raspberry Pi, please click  <a href="https://hkwtc.org/aroz_online/dist/" target="_blank">HERE</a>**

The naming method of the Distribution Package (dist pack) are as follows.
```
acloud_{dd}-{mm}-{yyyy}_{build}
```

The build label indicates the following difference:

| label | represent            |
|-------|----------------------|
| c     | Community Edition    |
| b     | Barebone / Core only |
| f     | Full Edition*        |

*The Full Edition might contains modules or sources that is NOT OPEN SOURCE.

## Installation Guide
To install the updates to your device, in most case, you can follow the guide below.

### Windows with WAMP SERVER
1. Download the dist pack
2. Unzip the disk pack to your web root which is usually located at C:\wamp\www\
3. Open your default browser and visit http://localhost/AOB/
4. Follow the setup guide to create new users and login.

### Debian / Ubuntu / Rasbian with Apache2 and PHP
1. cd into the directory of /var/www/html with the following command
	```
	cd /var/www/html/
	```
2. Download the package with the file download link. You can find the download link of the 
zip file by clicking the zip file on Github and press "Raw" on the upper right corner of the preview window.
	```
	wget {download_link}
	```
3. Create a folder name "AOB".
	'''
	mkdir AOB
	'''
4. Unzip the downloaded file into the AOB directory and give permission to any read write within this directory.
	```
	unzip {downloaded_filename}
	sudo chmod 777 -R ./AOB	
	```
5. Open your browser and visit http://{your_device_ip}/AOB/
6. Follow the setup guide to create new users and login.

## Update Guide
Repeat the same step as the installation to update your system. If you prefer keeping the old module configuration, please consider only updating the core scripts (aka use those dist pack with label "b")
The following is an auto update script for reference only. You might need to change a few lines to make it work.
```
#!/bin/bash
REPOSERVER="{disk-pack network location}"
TARGET="$REPOSERVER/community.zip"
sudo wget $TARGET
sudo chmod 777 community.zip
sudo unzip -o community.zip
rm community.zip
echo "[info] ArOZ Online Update Finished."
echo "[info] Setting up permissions..."
sudo mkdir -p "/etc/AOB"
sudo chmod 777 -R "/etc/AOB"
sudo chmod 777 -R ./AOB
echo "[info] ArOZ Online Permission Setting Completed"
ls -l
```
*Dist pack distrubution system is still work in progress. This guide will be updated when the dist system is finished.

