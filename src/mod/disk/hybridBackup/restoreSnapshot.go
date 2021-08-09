package hybridBackup

import (
	"errors"
	"log"
	"os"
	"path/filepath"
)

/*
	restoreSnapshot.go

	Restore snapshot for a certain user in the snapshot
	The steps basically as follows.

	1. Check and validate the snapshot
	2. Iterate and restore all files contained in that snapshot to source drive if it is owned by the user
	3. Get the snapshot link file. Restore all files with pointer still exists and owned by the user

*/

//Restore a snapshot by task and name
func restoreSnapshotByName(backupTask *BackupTask, snapshotName string, username *string) error {
	//Step 1: Check and validate snapshot
	snapshotBaseFolder := filepath.Join(backupTask.DiskPath, "/version/", snapshotName)
	snapshotRestoreDirectory := filepath.ToSlash(filepath.Clean(backupTask.ParentPath))
	if !fileExists(snapshotBaseFolder) {
		return errors.New("Given snapshot ID not found")
	}

	if !fileExists(filepath.Join(snapshotBaseFolder, "snapshot.datalink")) {
		return errors.New("Snapshot corrupted. snapshot.datalink pointer file not found.")
	}

	log.Println("[HybridBackup] Restoring from snapshot ID: ", filepath.Base(snapshotBaseFolder))

	//Step 2: Restore all the files changed during that snapshot period
	fastWalk(snapshotBaseFolder, func(filename string) error {
		//Skip the datalink file
		if filepath.Base(filename) == "snapshot.datalink" {
			return nil
		}
		//Calculate the relative path of this file
		relPath, err := filepath.Rel(snapshotBaseFolder, filepath.ToSlash(filename))
		if err != nil {
			//Just skip this cycle
			return nil
		}

		assumedRestoreLocation := filepath.ToSlash(filepath.Join(snapshotRestoreDirectory, relPath))
		allowRestore := false
		if username == nil {
			//Restore all files
			allowRestore = true
		} else {
			//Restore only files owned by this user

			isOwnedByThisUser := snapshotFileBelongsToUser("/"+filepath.ToSlash(relPath), *username)
			if isOwnedByThisUser {
				allowRestore = true
			}

		}

		if allowRestore {
			//Check if the restore file parent folder exists.
			if !fileExists(filepath.Dir(assumedRestoreLocation)) {
				os.MkdirAll(filepath.Dir(assumedRestoreLocation), 0775)
			}
			//Copy this file from backup to source, overwriting source if exists
			err := BufferedLargeFileCopy(filepath.ToSlash(filename), filepath.ToSlash(assumedRestoreLocation), 0775)
			if err != nil {
				log.Println("[HybridBackup] Restore failed: " + err.Error())
			}
		}

		return nil
	})

	//Step 3: Restore files from datalinking file
	linkMap, err := readLinkFile(snapshotBaseFolder)
	if err != nil {
		return err
	}

	for relPath, restorePointer := range linkMap.UnchangedFile {
		//Get the assume restore position and source location
		sourceFileLocation := filepath.ToSlash(filepath.Join(backupTask.DiskPath, "/version/", "/"+restorePointer+"/", relPath))
		assumedRestoreLocation := filepath.ToSlash(filepath.Join(snapshotRestoreDirectory, relPath))

		//Check if the restore file parent folder exists.
		if snapshotFileBelongsToUser(filepath.ToSlash(relPath), *username) {
			if !fileExists(filepath.Dir(assumedRestoreLocation)) {
				os.MkdirAll(filepath.Dir(assumedRestoreLocation), 0775)
			}
			//Copy this file from backup to source, overwriting source if exists
			BufferedLargeFileCopy(filepath.ToSlash(sourceFileLocation), filepath.ToSlash(assumedRestoreLocation), 0775)
			log.Println("[HybridBackup] Restored " + assumedRestoreLocation + " for user " + *username)
		}
	}

	return nil
}
