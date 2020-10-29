package main

import (
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	
	fs "imuslab.com/aroz_online/mod/filesystem"
	storage "imuslab.com/aroz_online/mod/storage"
)


var (
	baseStoragePool *storage.StoragePool
	fsHandlers []*fs.FileSystemHandler
	//grpHandlers []*fs.FileSystemHandler			
)

func StorageInit(){
	//Load the default handler for the user storage root
	if !fileExists(filepath.Clean(*root_directory) + "/"){
		os.MkdirAll(filepath.Clean(*root_directory) + "/", 0755)
	}
	baseHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name: "User",
		Uuid: "user",
		Path: filepath.ToSlash(filepath.Clean(*root_directory)) + "/",
		Hierarchy: "user",
		Automount: false,
		Filesystem: "ext4",
	})

	if err != nil{
		log.Println("Failed to initiate user root storage directory: " + *root_directory)
		panic(err)
	}
	fsHandlers = append(fsHandlers, baseHandler);

	//Load the tmp folder as storage unit
	tmpHandler, err := fs.NewFileSystemHandler(fs.FileSystemOption{
		Name: "tmp",
		Uuid: "tmp",
		Path: filepath.ToSlash(filepath.Clean(*tmp_directory)) + "/",
		Hierarchy: "user",
		Automount: false,
		Filesystem: "ext4",
	})

	if err != nil{
		log.Println("Failed to initiate tmp storage directory: " + *tmp_directory)
		panic(err)
	}
	fsHandlers = append(fsHandlers, tmpHandler);

	//Load all the storage config from file
	rawConfig, err := ioutil.ReadFile(*storage_config_file)
	if (err != nil){
		//File not found. Use internal storage only
		log.Println("Storage configuration file not found. Using internal storage only.")
	}else{
		//Configuration loaded. Initializing handler
		externalHandlers, err := fs.NewFileSystemHandlersFromJSON(rawConfig);
		if err != nil{
			log.Println("Failed to load storage configuration: " + err.Error() + " -- Skipping")
		}else{
			for _, thisHandler := range externalHandlers{
				fsHandlers = append(fsHandlers, thisHandler);
				log.Println(thisHandler.Name + " Mounted as " + thisHandler.UUID + ":/")
			}
			
		}
	}

	

	//Create a base storage pool for all users
	sp, err := storage.NewStoragePool(fsHandlers, "system");
	if err != nil{
		log.Println("Failed to create base Storaeg Pool")
		panic(err.Error())
		return
	}
	//Update the storage pool permission to readwrite
	sp.OtherPermission = "readwrite"
	baseStoragePool = sp

	//Mount permission group's storage pool
	//WIP

}

func CloseAllStorages(){
	for _, fsh := range fsHandlers{
		fsh.FilesystemDatabase.Close();
	}
}
