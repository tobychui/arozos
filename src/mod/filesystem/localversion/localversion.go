package localversion

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem"
)

/*
	localversion.go

	This is a local version management module for arozos files
	Author: tobychui

*/

type FileSnapshot struct {
	HistoryID     string
	Filename      string
	ModTime       int64
	OverwriteTime string
	Filesize      int64
	Relpath       string
}

type VersionList struct {
	CurrentFile   string
	LatestModtime int64
	Versions      []*FileSnapshot
}

func GetFileVersionData(realFilepath string) (*VersionList, error) {
	mtime, _ := filesystem.GetModTime(realFilepath)
	versionList := VersionList{
		CurrentFile:   filepath.Base(realFilepath),
		LatestModtime: mtime,
		Versions:      []*FileSnapshot{},
	}
	//Example folder structure: ./.localver/{date_time}/{file}
	expectedVersionFiles := filepath.Join(filepath.Dir(realFilepath), ".metadata/.localver", "*", filepath.Base(realFilepath))
	versions, err := filepath.Glob(filepath.ToSlash(expectedVersionFiles))
	if err != nil {
		return &versionList, err
	}

	//Reverse the versions so latest version on top
	sort.Sort(sort.Reverse(sort.StringSlice(versions)))

	for _, version := range versions {
		historyID := filepath.Base(filepath.Dir(version))
		mtime, _ := filesystem.GetModTime(version)
		overwriteDisplayTime := strings.ReplaceAll(strings.Replace(strings.Replace(historyID, "-", "/", 2), "-", ":", 2), "_", " ")
		versionList.Versions = append(versionList.Versions, &FileSnapshot{
			HistoryID:     historyID,
			Filename:      filepath.Base(version),
			ModTime:       mtime,
			OverwriteTime: overwriteDisplayTime,
			Filesize:      filesystem.GetFileSize(version),
			Relpath:       ".metadata/.localver/" + historyID + "/" + filepath.Base(version),
		})
	}

	return &versionList, nil
}

func RestoreFileHistory(originalFilepath string, histroyID string) error {
	expectedVersionFile := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", filepath.Base(histroyID), filepath.Base(originalFilepath))
	if !filesystem.FileExists(expectedVersionFile) {
		return errors.New("File version not exists")
	}

	//Restore it
	os.Rename(originalFilepath, originalFilepath+".backup")
	filesystem.BasicFileCopy(expectedVersionFile, originalFilepath)

	//Check if it has been restored correctly
	versionFileHash, _ := filesystem.GetFileMD5Sum(expectedVersionFile)
	copiedFileHash, _ := filesystem.GetFileMD5Sum(expectedVersionFile)
	if versionFileHash != copiedFileHash {
		//Rollback failed. Restore backup file
		os.Rename(originalFilepath+".backup", originalFilepath)
		return errors.New("Unable to restore file: file hash mismatch after restore")
	}

	//OK! Delete the backup file
	os.Remove(originalFilepath + ".backup")

	//Delete all history versions that is after the restored versions
	expectedVersionFiles := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", "*", filepath.Base(originalFilepath))
	versions, err := filepath.Glob(filepath.ToSlash(expectedVersionFiles))
	if err != nil {
		return err
	}

	enableRemoval := false
	for _, version := range versions {
		if enableRemoval {
			//Remove this version as this is after the restored version
			os.Remove(version)
		} else {
			thisHistoryId := filepath.Base(filepath.Dir(version))
			if thisHistoryId == histroyID {
				//Match. Tag enable Removal
				enableRemoval = true

				//Remove this version
				os.Remove(version)
			}
		}

	}

	return nil
}

func RemoveFileHistory(originalFilepath string, histroyID string) error {
	expectedVersionFile := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", filepath.Base(histroyID), filepath.Base(originalFilepath))
	if !filesystem.FileExists(expectedVersionFile) {
		return errors.New("File version not exists")
	}

	return os.Remove(expectedVersionFile)
}

func RemoveAllRelatedFileHistory(originalFilepath string) error {
	expectedVersionFiles, err := filepath.Glob(filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", "*", filepath.Base(originalFilepath)))
	if err != nil {
		return err
	}
	for _, version := range expectedVersionFiles {
		os.Remove(version)
	}
	return nil
}

func CreateFileSnapshot(realFilepath string) error {
	if !filesystem.FileExists(realFilepath) {
		return errors.New("Source file not exists")
	}
	//Create the snapshot folder for this file
	snapshotID := time.Now().Format("2006-01-02_15-04-05")
	expectedSnapshotFolder := filepath.Join(filepath.Dir(realFilepath), ".metadata/.localver", snapshotID)
	err := os.MkdirAll(expectedSnapshotFolder, 0775)
	if err != nil {
		return err
	}
	//Copy the target file to snapshot dir
	targetVersionFilepath := filepath.Join(expectedSnapshotFolder, filepath.Base(realFilepath))
	return filesystem.BasicFileCopy(realFilepath, targetVersionFilepath)
}

//Clearn expired version backups that is older than maxReserveTime
func CleanExpiredVersionBackups(walkRoot string, maxReserveTime int64) {
	localVerFolders := []string{}
	filepath.Walk(walkRoot,
		func(path string, info os.FileInfo, err error) error {
			if err != nil {
				//Skip this file
				return nil
			}
			if !info.IsDir() && inLocalVersionFolder(path) {
				//This is a file inside the localver folder. Check its modtime
				mtime, _ := filesystem.GetModTime(path)
				if time.Now().Unix()-mtime > maxReserveTime {
					//Too old! Remove this version history
					os.Remove(path)
				}

				//Check if the folder still contains files. If not, remove it
				files, _ := filepath.Glob(filepath.ToSlash(filepath.Dir(path)) + "/*")
				if len(files) == 0 {
					os.RemoveAll(filepath.Dir(path))
				}
			} else if info.IsDir() && filepath.Base(path) == ".localver" {
				localVerFolders = append(localVerFolders, path)

			}
			return nil
		})

	for _, path := range localVerFolders {
		//Check if a localver folder still contains folder. If not, delete this
		files, _ := filepath.Glob(filepath.ToSlash(path) + "/*")
		if len(files) == 0 {
			os.RemoveAll(path)
		}
	}
}

func inLocalVersionFolder(path string) bool {
	path = filepath.ToSlash(path)
	return strings.Contains(path, "/.localver/") || filepath.Base(path) == ".localver"
}
