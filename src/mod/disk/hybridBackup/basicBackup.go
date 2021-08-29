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
	Basic Backup

	This script handle basic backup process
*/

var autoDeleteTime int64 = 86400 * 30

func executeBackup(backupConfig *BackupTask, deepBackup bool) (string, error) {
	copiedFileList := []string{}

	rootPath := filepath.ToSlash(filepath.Clean(backupConfig.ParentPath))

	//Check if the backup parent root is identical / within backup disk
	parentRootAbs, err := filepath.Abs(backupConfig.ParentPath)
	if err != nil {
		backupConfig.PanicStopped = true
		return "", errors.New("Unable to resolve parent disk path")
	}

	backupRootAbs, err := filepath.Abs(filepath.Join(backupConfig.DiskPath, "/backup/"))
	if err != nil {
		backupConfig.PanicStopped = true
		return "", errors.New("Unable to resolve backup disk path")
	}

	if len(parentRootAbs) >= len(backupRootAbs) {
		if parentRootAbs[:len(backupRootAbs)] == backupRootAbs {
			//parent root is within backup root. Raise configuration error
			log.Println("[HyperBackup] Invalid backup cycle: Parent drive is located inside backup drive")
			backupConfig.PanicStopped = true
			return "", errors.New("Configuration Error. Skipping backup cycle.")
		}
	}

	backupConfig.PanicStopped = false

	//Add file cycles
	//log.Println("[Debug] Cycle 1: Adding files")
	fastWalk(rootPath, func(filename string) error {
		if filepath.Ext(filename) == ".db" || filepath.Ext(filename) == ".lock" {
			//Reserved filename, skipping
			return nil
		}
		//Get the target paste location
		rootAbs, _ := filepath.Abs(rootPath)
		fileAbs, _ := filepath.Abs(filename)

		rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
		fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

		relPath := strings.ReplaceAll(fileAbs, rootAbs, "")
		assumedTargetPosition := filepath.Join(backupConfig.DiskPath, "/backup/", relPath)

		if !deepBackup {
			//Shallow copy. Only do copy base on file exists or not
			//This is used to reduce the time for reading the file metatag
			if !fileExists(assumedTargetPosition) {
				//Target file not exists in backup disk. Make a copy
				if !fileExists(filepath.Dir(assumedTargetPosition)) {
					//Folder containing this file not exists. Create it
					os.MkdirAll(filepath.Dir(assumedTargetPosition), 0755)
				}

				//Copy the file to target
				err := BufferedLargeFileCopy(fileAbs, assumedTargetPosition, 1024)
				if err != nil {
					log.Println("[HybridBackup] Copy Failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
				} else {
					//No problem. Add this filepath into the list
					copiedFileList = append(copiedFileList, assumedTargetPosition)
				}

			}
		} else {
			//Deep copy. Check and match the modtime of each file
			if !fileExists(assumedTargetPosition) {
				if !fileExists(filepath.Dir(assumedTargetPosition)) {
					//Folder containing this file not exists. Create it
					os.MkdirAll(filepath.Dir(assumedTargetPosition), 0755)
				}

				//Copy the file to target
				err := BufferedLargeFileCopy(fileAbs, assumedTargetPosition, 1024)
				if err != nil {
					log.Println("[HybridBackup] Copy Failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
					return nil
				} else {
					//No problem. Add this filepath into the list
					copiedFileList = append(copiedFileList, assumedTargetPosition)
				}
			} else {
				//Target file already exists.
				//Check if it has been modified since the last cycle time
				lastModTime := lastModTime(fileAbs)
				if lastModTime > backupConfig.LastCycleTime {
					//Check if their hash matches
					srcHash, err := getFileHash(fileAbs)
					if err != nil {
						log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
						return nil
					}
					targetHash, err := getFileHash(assumedTargetPosition)
					if err != nil {
						log.Println("[HybridBackup] Hash calculation failed for file "+filepath.Base(assumedTargetPosition), err.Error(), " Skipping.")
						return nil
					}

					if srcHash != targetHash {
						//log.Println("[Debug] Hash mismatch. Copying ", fileAbs)
						//This file has been recently changed. Copy it to new location
						err = BufferedLargeFileCopy(fileAbs, assumedTargetPosition, 1024)
						if err != nil {
							log.Println("[HybridBackup] Copy Failed for file "+filepath.Base(fileAbs), err.Error(), " Skipping.")
						} else {
							//No problem. Add this filepath into the list
							copiedFileList = append(copiedFileList, assumedTargetPosition)
						}

						//Check if this file is in the remove marker list. If yes, pop it from the list
						_, ok := backupConfig.DeleteFileMarkers[relPath]
						if ok {
							//File exists. remove it from delete file amrker
							delete(backupConfig.DeleteFileMarkers, relPath)
							backupConfig.Database.Delete("DeleteMarkers", relPath)
							log.Println("Removing ", relPath, " from delete marker list")
						}
					}
				}

			}
		}

		return nil
	})

	///Remove file cycle
	//log.Println("[Debug] Cycle 2: Removing files")
	backupDriveRootPath := filepath.ToSlash(filepath.Clean(filepath.Join(backupConfig.DiskPath, "/backup/")))
	fastWalk(backupConfig.DiskPath, func(filename string) error {
		if filepath.Ext(filename) == ".db" || filepath.Ext(filename) == ".lock" {
			//Reserved filename, skipping
			return nil
		}
		//Get the target paste location
		rootAbs, _ := filepath.Abs(backupDriveRootPath)
		fileAbs, _ := filepath.Abs(filename)

		rootAbs = filepath.ToSlash(filepath.Clean(rootAbs))
		fileAbs = filepath.ToSlash(filepath.Clean(fileAbs))

		thisFileRel := filename[len(backupDriveRootPath):]
		originalFileOnDiskPath := filepath.ToSlash(filepath.Clean(filepath.Join(backupConfig.ParentPath, thisFileRel)))

		//Check if the taget file not exists and this file has been here for more than 24h
		if !fileExists(originalFileOnDiskPath) {
			//This file not exists. Check if it is in the delete file marker for more than 24 hours
			val, ok := backupConfig.DeleteFileMarkers[thisFileRel]
			if !ok {
				//This file is newly deleted. Push into the marker map
				deleteTime := time.Now().Unix()
				backupConfig.DeleteFileMarkers[thisFileRel] = deleteTime

				//Write the delete marker to database
				backupConfig.Database.Write("DeleteMarkers", thisFileRel, deleteTime)

				log.Println("[HybridBackup] Adding " + filename + " to delete marker")
			} else {
				//This file has been marked for 30 days. Check if it is time to delete
				if time.Now().Unix()-val > autoDeleteTime {
					//log.Println("[Debug] Deleting " + filename)

					//Remove the backup file
					os.RemoveAll(filename)

					//Remove file from delete file markers
					delete(backupConfig.DeleteFileMarkers, thisFileRel)

					//Remove file from database
					backupConfig.Database.Delete("DeleteMarkers", thisFileRel)
				}
			}
		}
		return nil
	})

	return "", nil
}

func listBasicRestorables(task *BackupTask) ([]*RestorableFile, error) {
	restorableFiles, err := task.compareRootPaths()
	return restorableFiles, err
}
