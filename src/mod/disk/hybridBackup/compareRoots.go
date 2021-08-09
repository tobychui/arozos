package hybridBackup

import (
	"os"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/filesystem/hidden"
)

/*
	Compare roots

	This script compare the files between two folder recursively

*/

//This function check which file exists in backup but not source drive.
//Only usable for basic and nightly backup mode
func (t *BackupTask) compareRootPaths() ([]*RestorableFile, error) {
	results := []*RestorableFile{}

	//Check if the source and the backup disk exists
	for key, value := range t.DeleteFileMarkers {
		//Check if the source file exists
		assumedSourcePosition := filepath.Join(t.ParentPath, key)
		backupFilePosition := filepath.Join(t.DiskPath, "/backup/", key)
		if !fileExists(assumedSourcePosition) && fileExists(backupFilePosition) {
			//This is a restorable file
			var filesize int64 = 0
			fi, err := os.Stat(backupFilePosition)
			if err != nil {
				filesize = 0
			} else {
				filesize = fi.Size()
			}

			fileIsHidden, _ := hidden.IsHidden(backupFilePosition, true)

			//Create the Restorable File
			thisFile := RestorableFile{
				Filename:      filepath.Base(key),
				IsHidden:      fileIsHidden,
				Filesize:      filesize,
				RelpathOnDisk: filepath.ToSlash(key),
				RestorePoint:  filepath.ToSlash(assumedSourcePosition),
				BackupDiskUID: t.DiskUID,
				RemainingTime: 86400 - (time.Now().Unix() - value),
				DeleteTime:    value,
				IsSnapshot:    false,
			}
			results = append(results, &thisFile)
		}
	}

	return results, nil
}
