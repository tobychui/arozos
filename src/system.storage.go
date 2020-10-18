package main

import (
	"encoding/json"
	"io/ioutil"
	"strings"
	"log"
	"os"
	"os/exec"
	"runtime"
	"path/filepath"
	"github.com/ricochet2200/go-disk-usage/du"
)


type storageDevice struct {
	Name      string `json:"name"`						//Display name of this device
	Uuid      string `json:"uuid"`						//UUID of this device, e.g. S1
	Path      string `json:"path"`						//Path for the storage root
	Access    string `json:"access"`					//Access right, allow {readonly, everyone, user:{username}, group:{groupname}}
	Hierarchy string `json:"hierarchy"`					//Folder hierarchy, allow {public, user}
	Automount bool   `json:"automount"`					//Automount this device if exists
	Filesystem string `json:"filesystem,omitempty"`		//Support {"ext4","ext2", "ext3", "fat", "vfat", "ntfs"}
	Mountdev  string `json:"mountdev,omitempty"`		//Device file (e.g. /dev/sda1)
	Mountpt  string `json:"mountpt,omitempty"`			//Device mount point (e.g. /media/storage1)
	Freespace  int64 `json:"omitempty"`					//AUTOFILLED
	Disksize  int64 `json:"omitempty"`					//AUTOFILLED
}

var (
	storages []storageDevice
)

func system_storage_service_init(){
	//Initiate external storage system
	system_storage_loadConfig();
}

func system_storage_loadConfig(){
	var storageDevices []storageDevice;
	supportedFileSystem := []string{"ext4","ext2", "ext3", "fat", "vfat", "ntfs"}
	rawConfig, err := ioutil.ReadFile(*storage_config_file)
	if (err != nil){
		//File not found. Use internal storage only
		log.Println("Storage configuration file not found. Using internal storage only.")
		return;
	}
	err = json.Unmarshal(rawConfig,&storageDevices);
	if (err != nil){
		panic("Unable to parse storage.json in config!");
		os.Exit(0)
	}

	//Check if the directory that mounts this storage device exists.
	for _, thisConfig := range storageDevices{
		if fileExists(thisConfig.Path) || (runtime.GOOS == "linux" && thisConfig.Automount){
			//This path exists. 
			if thisConfig.Automount == true{
				//Check if running under sudo mode and in linux
				if (runtime.GOOS == "linux"){
					if (!sudo_mode){
						//Not in sudoer mode
						if (thisConfig.Mountpt != "" && fileExists(thisConfig.Mountpt) && system_storage_checkMounted(thisConfig.Mountpt)){
							//This mount point is already mounted. Ignore the automount true option
							log.Println(thisConfig.Mountpt + " already mounted.")

							//Continue to the creation process
						}else{
							//This mount point is not mounted
							log.Println("Unable to mount device under non-root mode. Skipping " + thisConfig.Mountdev);
							continue
						}
					
					}else{
						//Try to mount the file system
						if (thisConfig.Mountdev == ""){
							log.Fatal("Invalid storage.json. Disk with automount enabled has no mountdev value.")
							os.Exit(0);
						}

						if (thisConfig.Mountpt == "" || !fileExists(thisConfig.Mountpt)){
							log.Fatal("Invalid storage.json. Mount point not given or not exists for " + thisConfig.Mountdev)
							os.Exit(0);
						}

						fs := thisConfig.Filesystem
						if (fs == ""){
							//Default ntfs
							fs = "ntfs"
						}

						//Check if device exists
						if (!fileExists(thisConfig.Mountdev)){
							//Device driver not exists.
							log.Println("Device not exists: " + thisConfig.Mountdev + ". Skipping this defination.")
							continue;
						}

						if (inArray(supportedFileSystem, fs)){
							//Mount the device
							if (system_storage_checkMounted(thisConfig.Mountpt)){
								log.Println(thisConfig.Mountpt + " already mounted.")
							}else{
								log.Println("Mounting " + thisConfig.Mountdev + "(" + fs + ") to " + filepath.Clean(thisConfig.Mountpt))
								cmd := exec.Command("mount", "-t", fs, thisConfig.Mountdev, filepath.Clean(thisConfig.Mountpt))
								cmd.Stdout = os.Stdout
								cmd.Stderr = os.Stderr
								cmd.Run()
							}

							//Check if the path exists
							if (!fileExists(thisConfig.Path)){
								//Mounted but path still not found. Skip this device
								log.Println("Unable to find " + thisConfig.Path + ". Skipping storage mount point.")
								continue
							}
						}else{
							log.Fatal("Invalid storage.json. Not supported filesystem type: " + fs)
						}
					}
				
				}
			}

			//Generate volume info for this path
			startpath, _ := filepath.Abs(thisConfig.Path)
			free, total, _ := system_storage_getDriveCapacity(startpath)
			thisConfig.Freespace = int64(free)
			thisConfig.Disksize = int64(total)

			//Record it into the global storage entry
			storages = append(storages, thisConfig)
		}else{
			log.Println("Unable to find " + thisConfig.Path + ". Skipping storage mount point.")
			continue
		}
	}

	//Initiate each of the storage location with given settings
	for _, v := range storageDevices{
		if (v.Hierarchy == "users"){
			//WIP
		}
	}

}


func system_storage_getAccessMode(rPath string, username string) string{
	//Check if the system is running in demo mode. If yes, all paths are read only.
	if (*demo_mode){
		return "readonly"
	}

	vPath, err := realpathToVirtualpath(rPath, username)
	if (err != nil){
		return ""
	}

	pathInfo := strings.Split(vPath, "/")
	rootUUID := pathInfo[0];
	if (rootUUID[len(rootUUID) -1:] == ":"){
		rootUUID = rootUUID[:len(rootUUID) - 1]
	}
	for _, dev := range storages{
		if (dev.Uuid == rootUUID){
			return dev.Access
		}
	}

	return ""
}

//Return the corrisponding storage device register that handle this real path
func system_storage_getStorageByPath(rPath string, username string) (storageDevice, error){
	vPath, err := realpathToVirtualpath(rPath, username)
	if err != nil{
		return storageDevice{}, err
	}
	pathInfo := strings.Split(vPath, "/")
	//Find the corrisponding name of the storage device using UUID
	targetUUID := pathInfo[0][:len(pathInfo[0]) -1]
	for _, dev := range storages{
		if (dev.Uuid == targetUUID){
			return dev, nil
		}
	}

	return storageDevice{
		Name: "User",
		Uuid: "user",
		Path: *root_directory,
		Access: "self",
		Hierarchy: "user",
		Automount: true,
		Filesystem: "system",
		Mountdev: "",
		Mountpt: "",
		Freespace: int64(-1),
		Disksize: int64(-1),
	}, nil
}

//Get the storage root name (e.g. User or S1) from realPath
func system_storage_getRootNameByPath(rPath string, username string) (string, error){
	vPath, err := realpathToVirtualpath(rPath, username)
	if (err != nil){
		log.Println("Prase error. Given path: " + rPath)
		return "",err
	}
	pathInfo := strings.Split(vPath, "/")
	//Find the corrisponding name of the storage device using UUID
	targetUUID := pathInfo[0][:len(pathInfo[0]) -1]
	for _, dev := range storages{
		if (dev.Uuid == targetUUID){
			return dev.Name, nil
		}
	}
	//Not found in external storage. Maybe user:/?
	return "User", nil
}

//Get the storage size (free, total, avalible) in the given path. Example path: C:\\
func system_storage_getDriveCapacity(drive string) (uint64, uint64, uint64){
	usage := du.NewDiskUsage(drive)
	free := usage.Free();
	total := usage.Size();
	avi := usage.Available();
	return free, total, avi
}

//Check if the folder is mounted. Always return true on Windows
func system_storage_checkMounted(mountpoint string) bool{
	if (runtime.GOOS == "windows"){
		return true;
	}

	cmd := exec.Command("mountpoint", mountpoint)
	out, err := cmd.CombinedOutput()
	if (err != nil){
		return false;
	}
	outstring := strings.TrimSpace(string(out))
	if (strings.Contains(outstring, " is a mountpoint")){
		return true
	}else{
		return false
	}

}

//Get a list of directories that is privatly owned by this user. Always return realpath
func system_storage_getUserDirectory(username string) []string{
	//Add root dir into userpaths
	root, _ := virtualPathToRealPath("user:/", username)
	userpaths := []string{root}
	//Add other storage devices
	for _, storage := range storages{
		if storage.Hierarchy == "user"{
			//This is a user based folder structure
			vpath := storage.Uuid + ":/"
			rpath, _ := virtualPathToRealPath(vpath, username)
			userpaths = append(userpaths, rpath)
		}
	}
	return userpaths;
}
