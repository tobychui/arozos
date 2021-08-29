package hybridBackup

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

/*
	snapshotOpr.go

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

/*
	Merge Snapshot

	This function is used to merge old snapshots if the system is running out of space
	the two snapshot has to be sequential
*/

func mergeOldestSnapshots(backupTask *BackupTask) error {
	//Get all snapshot names from disk path
	files, err := filepath.Glob(filepath.ToSlash(filepath.Clean(filepath.Join(backupTask.DiskPath, "/version/"))) + "/*")
	if err != nil {
		return err
	}

	snapshots := []string{}
	for _, file := range files {
		if isDir(file) && fileExists(filepath.Join(file, "snapshot.datalink")) {
			//This is a snapshot file
			snapshots = append(snapshots, file)
		}
	}

	if len(snapshots) < 2 {
		return errors.New("Not enough snapshot to merge")
	}

	olderSnapshotDir := filepath.ToSlash(snapshots[0])
	newerSnapshitDir := filepath.ToSlash(snapshots[1])

	//Check if both snapshot exists
	if !fileExists(olderSnapshotDir) || !fileExists(newerSnapshitDir) {
		log.Println("[HybridBackup] Snapshot merge failed: Snapshot folder not found")
		return errors.New("Snapshot folder not found")
	}

	//Check if link file exists
	linkFileLocation := filepath.Join(newerSnapshitDir, "snapshot.datalink")
	if !fileExists(linkFileLocation) {
		log.Println("[HybridBackup] Snapshot link file not found.")
		return errors.New("Snapshot link file not found")
	}

	//Get linker file
	linkMap, err := readLinkFile(newerSnapshitDir)
	if err != nil {
		linkMap = &LinkFileMap{
			UnchangedFile: map[string]string{},
			DeletedFiles:  map[string]string{},
		}
	}

	log.Println("[HybridBackup] Merging two snapshots in background")

	//All file ready. Merge both snapshots
	rootAbs, _ := filepath.Abs(olderSnapshotDir)
	rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
	fastWalk(olderSnapshotDir, func(filename string) error {
		fileAbs, _ := filepath.Abs(filename)
		fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

		relPath := filepath.ToSlash(strings.ReplaceAll(fileAbs, rootAbs, ""))
		mergeAssumedLocation := filepath.Join(newerSnapshitDir, relPath)
		if !fileExists(mergeAssumedLocation) {
			//Check if this is in delete marker. If yes, skip this
			_, ok := linkMap.DeletedFiles[relPath]
			if !ok {
				//This is not in delete map. Move it
				//This must use rename instead of copy because of lack of space issue
				if !fileExists(filepath.Dir(mergeAssumedLocation)) {
					os.MkdirAll(filepath.Dir(mergeAssumedLocation), 0775)
				}
				err = os.Rename(filename, mergeAssumedLocation)
				if err != nil {
					return err
				}
			} else {
				fmt.Println("Disposing file: ", relPath)
			}
		}

		return nil
	})

	//Rewrite all other datalink file to make olderSnapshot name to new snapshot name
	oldLink := filepath.Base(olderSnapshotDir)
	newLink := filepath.Base(newerSnapshitDir)
	for i := 1; i < len(snapshots); i++ {
		err = updateLinkerPointer(snapshots[i], oldLink, newLink)
		if err != nil {
			log.Println("[HybridBackup] Link file update file: " + filepath.Base(snapshots[i]))
		}
		fmt.Println("Updating link file for " + filepath.Base(snapshots[i]))
	}

	//Remove the old snapshot folder structure
	err = os.RemoveAll(olderSnapshotDir)
	return err
}
