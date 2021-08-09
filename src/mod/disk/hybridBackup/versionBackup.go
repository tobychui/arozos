package hybridBackup

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/*
	VersionBackup.go

	This scirpt file backup the data in the system nightly and create a restore point
	for the day just like BRTFS
*/

func executeVersionBackup(backupConfig *BackupTask) (string, error) {
	//Check if the backup parent root is identical / within backup disk
	parentRootAbs, err := filepath.Abs(backupConfig.ParentPath)
	if err != nil {
		return "", errors.New("Unable to resolve parent disk path")
	}

	backupRootAbs, err := filepath.Abs(filepath.Join(backupConfig.DiskPath, "/version/"))
	if err != nil {
		return "", errors.New("Unable to resolve backup disk path")
	}

	if len(parentRootAbs) >= len(backupRootAbs) {
		if parentRootAbs[:len(backupRootAbs)] == backupRootAbs {
			//parent root is within backup root. Raise configuration error
			log.Println("*HyperBackup* Invalid backup cycle: Parent drive is located inside backup drive")
			return "", errors.New("Configuration Error. Skipping backup cycle.")
		}
	}

	todayFolderName := time.Now().Format("2006-01-02")
	previousSnapshotExists := true
	previousSnapshotName, err := getPreviousSnapshotName(backupConfig, todayFolderName)
	if err != nil {
		previousSnapshotExists = false
	}
	snapshotLocation := filepath.Join(backupConfig.DiskPath, "/version/", todayFolderName)
	previousSnapshotLocation := filepath.Join(backupConfig.DiskPath, "/version/", previousSnapshotName)

	//Create today folder if not exist
	if !fileExists(snapshotLocation) {
		os.MkdirAll(snapshotLocation, 0755)
	}

	//Read the previous snapshot datalink into a LinkFileMap and use binary search for higher performance
	previousSnapshotMap, _ := readLinkFile(previousSnapshotLocation)

	/*
		Run a three pass compare logic between
		1. source disk and new backup disk to check any new / modified files (created today)
		2. yesterday backup and today backup to check any deleted files (created before, deleted today)
		3. file in today backup disk no longer in the current source disk (created today, deleted today)
	*/
	copiedFileList := []string{}
	linkedFileList := map[string]string{}
	deletedFileList := map[string]string{}

	//First pass: Check if there are any updated file from source and backup it to backup drive
	fastWalk(parentRootAbs, func(filename string) error {
		if filepath.Base(filename) == "aofs.db" || filepath.Base(filename) == "aofs.db.lock" {
			//Reserved filename, skipping
			return nil
		}

		//Get the target paste location
		rootAbs, _ := filepath.Abs(backupConfig.ParentPath)
		fileAbs, _ := filepath.Abs(filename)

		rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
		fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

		relPath := strings.ReplaceAll(fileAbs, rootAbs, "")
		fileBackupLocation := filepath.Join(backupConfig.DiskPath, "/version/", todayFolderName, relPath)
		yesterdayBackupLocation := filepath.Join(previousSnapshotLocation, relPath)

		//Check if the file exists
		if !fileExists(yesterdayBackupLocation) {
			//This file not in last snapshot location.
			//Check if it is in previous snapshot map
			fileFoundInSnapshotLinkFile, nameOfSnapshot := previousSnapshotMap.fileExists(relPath)
			if fileFoundInSnapshotLinkFile {
				//File found in the snapshot link file. Compare the one in snapshot
				linkedSnapshotLocation := filepath.Join(backupConfig.DiskPath, "/version/", nameOfSnapshot)
				linkedSnapshotOriginalFile := filepath.Join(linkedSnapshotLocation, relPath)
				if fileExists(linkedSnapshotOriginalFile) {
					//Linked file exists. Compare hash
					fileHashMatch, err := fileHashIdentical(fileAbs, linkedSnapshotOriginalFile)
					if err != nil {
						return nil
					}

					if fileHashMatch {
						//append this record to this snapshot linkdata file
						linkedFileList[relPath] = nameOfSnapshot
					} else {
						//File hash mismatch. Do file copy to renew data
						copyFileToBackupLocation(filename, fileBackupLocation)
						copiedFileList = append(copiedFileList, fileBackupLocation)
					}
				} else {
					//Invalid snapshot linkage. Assume new and do copy
					log.Println("[HybridBackup] Link lost. Cloning source file to snapshot.")
					copyFileToBackupLocation(filename, fileBackupLocation)
					copiedFileList = append(copiedFileList, fileBackupLocation)
				}

			} else {
				//This file is not in snapshot link file.
				//This is new file. Copy it to backup
				copyFileToBackupLocation(filename, fileBackupLocation)
				copiedFileList = append(copiedFileList, fileBackupLocation)
			}

		} else if fileExists(yesterdayBackupLocation) {
			//The file exists in the last snapshot
			//Check if their hash is the same. If no, update it
			fileHashMatch, err := fileHashIdentical(fileAbs, yesterdayBackupLocation)
			if err != nil {
				return nil
			}

			if !fileHashMatch {
				//Hash mismatch. Overwrite the file
				if !fileExists(filepath.Dir(fileBackupLocation)) {
					os.MkdirAll(filepath.Dir(fileBackupLocation), 0755)
				}

				err = BufferedLargeFileCopy(filename, fileBackupLocation, 4096)
				if err != nil {
					log.Println("[HybridBackup] Copy Failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
				} else {
					//No problem. Add this filepath into the list
					copiedFileList = append(copiedFileList, fileBackupLocation)
				}
			} else {
				//Create a link file for this relative path
				linkedFileList[relPath] = previousSnapshotName
			}
		} else {
			//Default case
			lastModTime := lastModTime(fileAbs)
			if lastModTime > backupConfig.LastCycleTime {
				//Check if hash the same
				srcHash, err := getFileHash(fileAbs)
				if err != nil {
					log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
					return nil
				}
				targetHash, err := getFileHash(fileBackupLocation)
				if err != nil {
					log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(fileBackupLocation), err.Error(), " Skipping.")
					return nil
				}

				if srcHash != targetHash {
					//Hash mismatch. Overwrite the file
					if !fileExists(filepath.Dir(fileBackupLocation)) {
						os.MkdirAll(filepath.Dir(fileBackupLocation), 0755)
					}

					err = BufferedLargeFileCopy(filename, fileBackupLocation, 4096)
					if err != nil {
						log.Println("[HybridBackup] Copy Failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
					} else {
						//No problem. Add this filepath into the list
						copiedFileList = append(copiedFileList, fileBackupLocation)
					}
				}
			}
		}

		return nil
	})

	//2nd pass: Check if there are anything exists in the previous backup but no longer exists in the source now
	//For case where the file is backed up in previous snapshot but now the file has been removed
	if previousSnapshotExists {
		fastWalk(previousSnapshotLocation, func(filename string) error {
			if filepath.Base(filename) == "snapshot.datalink" {
				//System reserved file. Skip this
				return nil
			}
			//Get the target paste location
			rootAbs, _ := filepath.Abs(previousSnapshotLocation)
			fileAbs, _ := filepath.Abs(filename)

			rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
			fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

			relPath := strings.ReplaceAll(fileAbs, rootAbs, "")
			sourcAssumeLocation := filepath.Join(parentRootAbs, relPath)
			//todaySnapshotLocation := filepath.Join(snapshotLocation, relPath)

			if !fileExists(sourcAssumeLocation) {
				//File exists in yesterday snapshot but not in the current source
				//Assume it has been deleted, create a dummy indicator file
				//ioutil.WriteFile(todaySnapshotLocation+".deleted", []byte(""), 0755)
				deletedFileList[relPath] = todayFolderName
			}
			return nil
		})

		//Check for deleting of unchanged file as well
		for relPath, _ := range previousSnapshotMap.UnchangedFile {
			sourcAssumeLocation := filepath.Join(parentRootAbs, relPath)
			if !fileExists(sourcAssumeLocation) {
				//The source file no longer exists
				deletedFileList[relPath] = todayFolderName
			}
		}
	}

	//3rd pass: Check if there are anything (except file with .deleted) in today backup drive that didn't exists in the source drive
	//For cases where the backup is applied to overwrite an eariler backup of the same day
	fastWalk(snapshotLocation, func(filename string) error {
		if filepath.Base(filename) == "aofs.db" || filepath.Base(filename) == "aofs.db.lock" {
			//Reserved filename, skipping
			return nil
		}

		if filepath.Ext(filename) == ".datalink" {
			//Deleted file marker. Skip this
			return nil
		}

		//Get the target paste location
		rootAbs, _ := filepath.Abs(snapshotLocation)
		fileAbs, _ := filepath.Abs(filename)

		rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
		fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

		relPath := strings.ReplaceAll(fileAbs, rootAbs, "")
		sourceAssumedLocation := filepath.Join(parentRootAbs, relPath)

		if !fileExists(sourceAssumedLocation) {
			//File removed from the source. Delete it from backup as well
			os.Remove(filename)
		}
		return nil
	})

	//Generate linkfile for this snapshot
	generateLinkFile(snapshotLocation, LinkFileMap{
		UnchangedFile: linkedFileList,
		DeletedFiles:  deletedFileList,
	})

	if err != nil {
		return "", err
	}

	return "", nil
}

//Return the previous snapshot for the currentSnspashot
func getPreviousSnapshotName(backupConfig *BackupTask, currentSnapshotName string) (string, error) {
	//Resolve the backup root folder
	backupRootAbs, err := filepath.Abs(filepath.Join(backupConfig.DiskPath, "/version/"))
	if err != nil {
		return "", errors.New("Unable to get the previous snapshot directory")
	}

	//Get the snapshot list and extract the snapshot date from foldername
	existingSnapshots := []string{}
	files, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(backupRootAbs)) + "/*")
	for _, file := range files {
		if isDir(file) && fileExists(filepath.Join(file, "snapshot.datalink")) {
			existingSnapshots = append(existingSnapshots, filepath.Base(file))
		}
	}

	if len(existingSnapshots) == 0 {
		return "", errors.New("No snapshot found")
	}

	//Check if the current snapshot exists, if not, return the latest one
	previousSnapshotName := ""
	if fileExists(filepath.Join(backupRootAbs, currentSnapshotName)) {
		//Current snapshot exists. Find the one just above it
		lastSnapshotName := existingSnapshots[0]
		for _, snapshotName := range existingSnapshots {
			if snapshotName == currentSnapshotName {
				//This is the correct snapshot name. Get the last one as previous snapshot
				previousSnapshotName = lastSnapshotName
			} else {
				lastSnapshotName = snapshotName
			}
		}
	} else {
		//Current snapshot not exists. Use the last item in snapshots list
		previousSnapshotName = existingSnapshots[len(existingSnapshots)-1]
	}

	return previousSnapshotName, nil
}

func copyFileToBackupLocation(filename string, fileBackupLocation string) error {
	if !fileExists(filepath.Dir(fileBackupLocation)) {
		os.MkdirAll(filepath.Dir(fileBackupLocation), 0755)
	}

	err := BufferedLargeFileCopy(filename, fileBackupLocation, 4096)
	if err != nil {
		log.Println("[HybridBackup] Failed to copy file: ", filepath.Base(filename)+". "+err.Error())
		return err
	}
	return nil
}

func fileHashIdentical(srcFile string, matchingFile string) (bool, error) {
	srcHash, err := getFileHash(srcFile)
	if err != nil {
		log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(srcFile), err.Error(), " Skipping.")
		return false, nil
	}
	targetHash, err := getFileHash(matchingFile)
	if err != nil {
		log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(matchingFile), err.Error(), " Skipping.")
		return false, nil
	}

	if srcHash != targetHash {
		return false, nil
	} else {
		return true, nil
	}
}

//List all restorable for version backup
func listVersionRestorables(task *BackupTask) ([]*RestorableFile, error) {
	//Check if mode is set correctly
	restorableFiles := []*RestorableFile{}
	if task.Mode != "version" {
		return restorableFiles, errors.New("This task mode is not supported by this list function")
	}

	//List directories of the restorable snapshots
	snapshotPath := filepath.ToSlash(filepath.Clean(filepath.Join(task.DiskPath, "/version/")))
	filesInSnapshotFolder, err := filepath.Glob(snapshotPath + "/*")
	if err != nil {
		return restorableFiles, err
	}

	//Check if the foler is actually a snapshot
	avaibleSnapshot := []string{}
	for _, fileObject := range filesInSnapshotFolder {
		possibleSnapshotDatalinkFile := filepath.Join(fileObject, "snapshot.datalink")
		if fileExists(possibleSnapshotDatalinkFile) {
			//This is a snapshot
			avaibleSnapshot = append(avaibleSnapshot, fileObject)
		}
	}

	//Build restorabe file struct for returning
	for _, snapshot := range avaibleSnapshot {
		thisFile := RestorableFile{
			Filename:      filepath.Base(snapshot),
			IsHidden:      false,
			Filesize:      0,
			RelpathOnDisk: filepath.Base(snapshot),
			RestorePoint:  task.ParentUID,
			BackupDiskUID: task.DiskUID,
			RemainingTime: -1,
			DeleteTime:    -1,
			IsSnapshot:    true,
		}

		restorableFiles = append(restorableFiles, &thisFile)
	}

	return restorableFiles, nil

}

//Check if a file in snapshot relPath (start with /) belongs to a user
func snapshotFileBelongsToUser(relPath string, username string) bool {
	relPath = filepath.ToSlash(filepath.Clean(relPath))
	userPath := "/users/" + username + "/"
	if len(relPath) > len(userPath) && relPath[:len(userPath)] == userPath {
		return true
	} else {
		return false
	}
}

//This function generate and return a snapshot summary. For public drive, leave username as nil
func (task *BackupTask) GenerateSnapshotSummary(snapshotName string, username *string) (*SnapshotSummary, error) {
	//Check if the task is version
	if task.Mode != "version" {
		return nil, errors.New("Invalid backup mode. This function only support snapshot mode backup task.")
	}

	userSumamryMode := false
	targetUserName := ""
	if username != nil {
		targetUserName = *username
		userSumamryMode = true
	}

	//Check if the snapshot folder exists
	targetSnapshotFolder := filepath.Join(task.DiskPath, "/version/", snapshotName)
	if !fileExists(targetSnapshotFolder) {
		return nil, errors.New("Snapshot not exists")
	}

	if !fileExists(filepath.Join(targetSnapshotFolder, "snapshot.datalink")) {
		return nil, errors.New("Snapshot datalink file not exists")
	}

	summary := SnapshotSummary{
		ChangedFiles:   map[string]string{},
		UnchangedFiles: map[string]string{},
		DeletedFiles:   map[string]string{},
	}

	fastWalk(targetSnapshotFolder, func(filename string) error {
		if filepath.Base(filename) == "snapshot.datalink" {
			//Exceptional
			return nil
		}
		relPath, err := filepath.Rel(targetSnapshotFolder, filename)
		if err != nil {
			return err
		}

		//Check if user mode, check if folder owned by them
		if userSumamryMode == true {
			if snapshotFileBelongsToUser("/"+filepath.ToSlash(relPath), targetUserName) {
				summary.ChangedFiles["/"+filepath.ToSlash(relPath)] = snapshotName
			}
		} else {
			summary.ChangedFiles["/"+filepath.ToSlash(relPath)] = snapshotName
		}

		return nil
	})

	//Generate the summary
	linkFileMap, err := readLinkFile(targetSnapshotFolder)
	if err != nil {
		return nil, err
	}

	//Move the file map into result
	if userSumamryMode {
		//Only show the files that belongs to this user
		for relPath, linkTarget := range linkFileMap.UnchangedFile {
			if snapshotFileBelongsToUser(filepath.ToSlash(relPath), targetUserName) {
				summary.UnchangedFiles[filepath.ToSlash(relPath)] = linkTarget
			}
		}

		for relPath, linkTarget := range linkFileMap.DeletedFiles {
			if snapshotFileBelongsToUser(filepath.ToSlash(relPath), targetUserName) {
				summary.DeletedFiles[filepath.ToSlash(relPath)] = linkTarget
			}
		}

	} else {
		//Show all files (public mode)
		summary.UnchangedFiles = linkFileMap.UnchangedFile
		summary.DeletedFiles = linkFileMap.DeletedFiles
	}

	return &summary, nil
}
