package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/disk/hybridBackup"
	user "imuslab.com/arozos/mod/user"

	prout "imuslab.com/arozos/mod/prouter"
)

func backup_init() {
	//Register HybridBackup storage restore endpoints
	router := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Register API endpoints
	router.HandleFunc("/system/backup/listRestorable", backup_listRestorable)
	router.HandleFunc("/system/backup/restoreFile", backup_restoreSelected)
	router.HandleFunc("/system/backup/snapshotSummary", backup_renderSnapshotSummary)
	router.HandleFunc("/system/backup/listAll", backup_listAllBackupDisk)

	//Register settings
	registerSetting(settingModule{
		Name:         "Backup Disks",
		Desc:         "All backup disk in the system",
		IconPath:     "img/system/backup.svg",
		Group:        "Disk",
		StartDir:     "SystemAO/disk/backup/backups.html",
		RequireAdmin: true,
	})
}

//List all backup disk info
func backup_listAllBackupDisk(w http.ResponseWriter, r *http.Request) {
	//Get all fsh from the system
	runningBackupTasks := []*hybridBackup.BackupTask{}

	//Render base storage pool
	for _, fsh := range baseStoragePool.Storages {
		if fsh.Hierarchy == "backup" {
			task, err := baseStoragePool.HyperBackupManager.GetTaskByBackupDiskID(fsh.UUID)
			if err != nil {
				continue
			}

			runningBackupTasks = append(runningBackupTasks, task)
		}
	}

	//Render group storage pool
	for _, pg := range permissionHandler.PermissionGroups {
		for _, fsh := range pg.StoragePool.Storages {
			task, err := pg.StoragePool.HyperBackupManager.GetTaskByBackupDiskID(fsh.UUID)
			if err != nil {
				continue
			}

			runningBackupTasks = append(runningBackupTasks, task)
		}
	}

	type backupDrive struct {
		DiskUID             string //The backup disk UUID
		DiskName            string // The Backup disk name
		ParentUID           string //Parent disk UID
		ParentName          string //Parent disk name
		BackupMode          string //The backup mode of the drive
		LastBackupCycleTime int64  //Last backup timestamp
		BackupCycleCount    int64  //How many backup cycle has proceeded since the system startup
		Error               bool   //If there are error occured in the last cycle
		ErrorMessage        string //If there are any error msg
	}

	backupDrives := []*backupDrive{}
	for _, task := range runningBackupTasks {
		diskFsh, diskErr := GetFsHandlerByUUID(task.DiskUID)
		parentFsh, parentErr := GetFsHandlerByUUID(task.ParentUID)

		//Check for error in getting FS Handler
		if diskErr != nil || parentErr != nil {
			sendErrorResponse(w, "Unable to get backup task info from backup disk: "+task.DiskUID)
			return
		}

		thisBackupDrive := backupDrive{
			DiskUID:             diskFsh.UUID,
			DiskName:            diskFsh.Name,
			ParentUID:           parentFsh.UUID,
			ParentName:          parentFsh.Name,
			BackupMode:          task.Mode,
			LastBackupCycleTime: task.LastCycleTime,
			BackupCycleCount:    task.CycleCounter,
			Error:               task.PanicStopped,
			ErrorMessage:        task.ErrorMessage,
		}

		backupDrives = append(backupDrives, &thisBackupDrive)
	}

	js, _ := json.Marshal(backupDrives)
	sendJSONResponse(w, string(js))
}

//Generate a snapshot summary for vroot
func backup_renderSnapshotSummary(w http.ResponseWriter, r *http.Request) {
	//Get user accessiable storage pools
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get Backup disk ID from request
	bdid, err := mv(r, "bdid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid backup disk ID given")
		return
	}

	//Get target snapshot name from request
	snapshot, err := mv(r, "snapshot", true)
	if err != nil {
		sendErrorResponse(w, "Invalid snapshot name given")
		return
	}

	//Get fsh from the id
	fsh, err := GetFsHandlerByUUID(bdid)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get parent disk hierarcy
	parentDiskID, err := userinfo.HomeDirectories.HyperBackupManager.GetParentDiskIDByRestoreDiskID(fsh.UUID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	parentFsh, err := GetFsHandlerByUUID(parentDiskID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get task by the backup disk id
	task, err := userinfo.HomeDirectories.HyperBackupManager.GetTaskByBackupDiskID(fsh.UUID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	if task.Mode == "version" {
		//Generate snapshot summary
		var summary *hybridBackup.SnapshotSummary
		if parentFsh.Hierarchy == "user" {
			s, err := task.GenerateSnapshotSummary(snapshot, &userinfo.Username)
			if err != nil {
				sendErrorResponse(w, err.Error())
				return
			}
			summary = s
		} else {
			s, err := task.GenerateSnapshotSummary(snapshot, nil)
			if err != nil {
				sendErrorResponse(w, err.Error())
				return
			}
			summary = s
		}

		js, _ := json.Marshal(summary)
		sendJSONResponse(w, string(js))
	} else {
		sendErrorResponse(w, "Unable to genreate snapshot summary: Backup mode is not snapshot")
		return
	}

}

//Restore a given file
func backup_restoreSelected(w http.ResponseWriter, r *http.Request) {
	//Get user accessiable storage pools
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get Backup disk ID from request
	bdid, err := mv(r, "bdid", true)
	if err != nil {
		sendErrorResponse(w, "Invalid backup disk ID given")
		return
	}

	//Get fsh from the id
	fsh, err := GetFsHandlerByUUID(bdid)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get the relative path for the restorable file
	relpath, err := mv(r, "relpath", true)
	if err != nil {
		sendErrorResponse(w, "Invalid relative path given")
		return
	}

	//Pick the correct HybridBackup Manager
	targetHybridBackupManager, err := backup_pickHybridBackupManager(userinfo, fsh.UUID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Handle restore of the file
	err = targetHybridBackupManager.HandleRestore(fsh.UUID, relpath, &userinfo.Username)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	type RestoreResult struct {
		RestoreDiskID       string
		TargetDiskID        string
		RestoredVirtualPath string
	}

	result := RestoreResult{
		RestoreDiskID: fsh.UUID,
	}

	//Get access path for this file
	parentDiskId, err := targetHybridBackupManager.GetParentDiskIDByRestoreDiskID(fsh.UUID)
	if err != nil {
		//Unable to get parent disk ID???

	} else {
		//Get the path of the parent disk
		parentDiskHandler, err := GetFsHandlerByUUID(parentDiskId)
		if err == nil {
			//Join the result to create a virtual path
			assumedRestoreRealPath := filepath.ToSlash(filepath.Join(parentDiskHandler.Path, relpath))
			restoreVpath, err := userinfo.RealPathToVirtualPath(assumedRestoreRealPath)
			if err == nil {
				result.RestoredVirtualPath = restoreVpath
			}
			result.TargetDiskID = parentDiskId
		}

	}

	js, _ := json.Marshal(result)
	sendJSONResponse(w, string(js))
}

//As one user might be belongs to multiple groups, check which storage pool is this disk ID owned by and return its corect backup maanger
func backup_pickHybridBackupManager(userinfo *user.User, diskID string) (*hybridBackup.Manager, error) {
	//Filter out the :/ if it exists in the disk ID
	if strings.Contains(diskID, ":") {
		diskID = strings.Split(diskID, ":")[0]
	}

	//Get all backup managers that this user ac can access
	userpg := userinfo.GetUserPermissionGroup()

	if userinfo.HomeDirectories.ContainDiskID(diskID) {
		return userinfo.HomeDirectories.HyperBackupManager, nil
	}

	//Extract the backup Managers
	for _, pg := range userpg {
		if pg.StoragePool.ContainDiskID(diskID) {
			return pg.StoragePool.HyperBackupManager, nil
		}

	}

	return nil, errors.New("Disk ID not found in any storage pool this user can access")
}

//Generate and return a restorable report
func backup_listRestorable(w http.ResponseWriter, r *http.Request) {
	//Get user accessiable storage pools
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	//Get Vroot ID from request
	vroot, err := mv(r, "vroot", true)
	if err != nil {
		sendErrorResponse(w, "Invalid vroot given")
		return
	}

	//Get fsh from the id
	fsh, err := GetFsHandlerByUUID(vroot)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get all backup managers that this user ac can access
	targetBackupManager, err := backup_pickHybridBackupManager(userinfo, vroot)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get the user's storage pool and list restorable by the user's storage pool access
	restorableReport, err := targetBackupManager.ListRestorable(fsh.UUID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Get and check if the parent disk has a user Hierarcy
	paretnfsh, err := GetFsHandlerByUUID(restorableReport.ParentUID)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	result := hybridBackup.RestorableReport{
		ParentUID:       restorableReport.ParentUID,
		RestorableFiles: []*hybridBackup.RestorableFile{},
	}

	if paretnfsh.Hierarchy == "user" {
		//The file system is user based. Filter out those file that is not belong to this user
		for _, restorableFile := range restorableReport.RestorableFiles {
			if restorableFile.IsSnapshot {
				//Is snapshot. Always allow access
				result.RestorableFiles = append(result.RestorableFiles, restorableFile)
			} else {
				//Is file
				fileAbsPath := filepath.Join(fsh.Path, restorableFile.RelpathOnDisk)
				_, err := userinfo.RealPathToVirtualPath(fileAbsPath)
				if err != nil {
					//Cannot translate this file. That means the file is not owned by this user
				} else {
					//Can translate the path.
					result.RestorableFiles = append(result.RestorableFiles, restorableFile)
				}
			}

		}
	} else {
		result = restorableReport
	}

	js, _ := json.Marshal(result)
	sendJSONResponse(w, string(js))
}
