# Updating ArozOS

## Backup Important Files

Before any update of ArozOS, backup the following files. You can find this with these relative path with the ArozOS root. (Default: /home/pi/arozos/)

1. system/ao.db (System Database)
2. system/storage.json (Storage config)
3. system/bridge.json (Bridge configs)
4. system/*.json (Group Storage configs)
5. ./files (User files, if leave -root as default)

## Update Instructions

### Update ArozOS from image / pre-build binary

If you are using a version of ArozOS that is setup with downloading binary executables, (i.e. Dowloading the exe from the Release page), follow the steps below to update your ArozOS

1. Download the new binary and web.tar.gz file. Unzip the web.tar.gz to a temporary location. 
2. Backup all your important data and configurations.
3. Replace the old binary executable, web and system folder with your newly downloaded release
4. Start up the ArozOS binary to complete the update



### Update ArozOS Raspberry Pi image

If you are using the offical Raspberry Pi image for ArozOS, you can update the ArozOS by connecting to the terminal of the pi via SSH.

1. Connect your pi using SSH. 

   1. If you are on Windows, download and install Putty and connect to your Pi using your pi IP (e.g. 192.168.0.100)
   2. If you are using MacOS, open Terminal App and enter ssh pi@{your_rasberry_pi_IP} (e.g. ssh pi@192.168.0.100)

2. Backup your important files.

3. Execute the update.sh

   ```
   cd ~/
   ./update.sh
   ```

4. Restart the ArozOS via systemd

   ```
   sudo systemctl restart arozos
   
   #For older version of ArozOS
   sudo systemctl restart aroz-online
   ```

   

### Update ArozOS from source

If you are installing ArozOS from source, you can easily update via git command.

1. Backup all your important files

2. Pull the new source from Github

   1. If you have modified the code, you can pull and merge your change into your system

      ```
      git pull
      ```

   2. If you have screwed up your source code, you can hard reset your whole source code to the offical repo

      ```
      git fetch --all
      git reset --hard origin/master
      ```

3. Build the new ArozOS from source

   ```
   go mod tidy
   go build
   ```

4. Restart your ArozOS via systemd

   ```
   sudo systemctl restart arozos
   ```



## Frequently Asked Questions

#### Why I cannot connect to my server after update?

If you have modified start.sh / start.bat, you might want to check if the start.sh is being modified in the update process. If no, check if the new ArozOS is started by using the following a command

```
sudo systemctl status arozos
```

to check if the service is running or not.  If it is not working, try restart it  using ``` sudo systemctl restart arozos``` or seek help at our Telegram group.



#### Why my storage pool settings are gone after update?

This is normal if you are replacing the ArozOS using manual overwrite / hard reset method. Simply restore the system/storage/*.json and system/storage.json files and restart ArozOS to restore the previous settings.



#### Why I cannot discover my device in Network Neighbourhood after the update?

Network Neighbourhood require SSDP broadcast technology. After the old service stopped, it will take some time for the SSDP broadcasted information to timeout and re-discovered from the network. It usually takes a few hours for all computers in the Local Area Network to the next discovery. 

In the mean time, you can use direct IP method to connect to your host by using IP Scanner / visit your router's DHCP client list.

