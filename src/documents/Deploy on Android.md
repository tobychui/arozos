# Deploying ArozOS on Android 8.0+



The following guide show the steps for an experimental deployment of ArozOS on Android Phone without root.

**WARNING! Android as deploy platform is still under development and not officially supported. Please use with your own risk. **



1. Install Termux. You can get Termux on https://termux.com/ 

2. Go to Application Settings and allow Termix to access Storage. As quote from the original wiki page

   ```
   'Settings>Apps>Termux>Permissions>Storage' and set to true
   ```

   See https://wiki.termux.com/wiki/Termux-setup-storage for more information.

3. Launch Termux. 

4. Update apt 

   ```
   apt update && apt upgrade
   ```

5. Insert the Micro SD card if you want to use the SD card as main storage. Otherwise, only internal storage of your phone is used

6. Execute ```termux-setup-storage```

7. Execute the following commands to check if storage mounted successfully.

   ```
   ls ~/storage
   
   # You should see the /shared and /external* directories that indicate your internal storage and external storage (SD Card)
   ```

   The /external* wildcard is different on each machine. On my phone, it is shown as ```external-1```. In the examples below, I will use ```external-1``` instead. 

8. Install git, golang and ffmpeg (for ArozOS)

   ```
   pkg install git golang ffmpeg -y
   ```

9. Git clone ArozOS from Github and assign permission

   ```
   cd ~/
   git clone https://github.com/tobychui/arozos
   chmod 777 -R ./arozos
   ```

10. Build ArozOS from source

    ```
    cd arozos/src
    go mod tidy
    go build
    ```

11. **Make sure there is no subservice in the subservice directory**. Currently, there is no android supported subservice. Subservice with no correct architecture will halt the startup process.

12. Check your phone IP address. Write this down for reference later.

    ```
    ifconfig
    
    # You should see something like 
    # inet 192.168.0.182 netmask 255.255.255.0 broadcast 192.168.0.255
    ```

    Where in this case, the 192.168.0.182 is my phone IP address. Yours might be different. I will be using  192.168.0.182 in my following examples.

13. Start ArozOS

    ```
    ./arozos
    ```

14. Launch ArozOS in your browser: Open http://192.168.0.182:8080 (Replace the IP address with your phone's IP address)

15. Create user account and login just like normal ArozOS initialization process. After you have setup your account and logged into the web desktop interface, visit System Settings > Disk & Storage > Storage Pools

16. Create two new storage pool with the following configs

    ```
    Name: Internal
    UUID: mnt
    Path: ../../storage/shared/
    Access Permission: READ WRITE
    Storage Hierarchy: Public Acess Folders
    (Other leave as default)
    ```

    **Skip the 2nd File System Handler if you do not have an SD card inserted**

    ```
    Name: External
    UUID: sd
    Path: ../../storage/external-1/
    Storage Hierarchy: Public Acess Folders
    (Other leave as default)
    ```

17. Select "Done" and back to system settings. Select "Reload Selected Pool"

18. Open File Explorer. You should now see two new Vroot created with name "Internal" which is your phone's internal storage and "External" which is your SD card.

