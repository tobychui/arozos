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

func GetFileVersionData(fsh *filesystem.FileSystemHandler, realFilepath string) (*VersionList, error) {
	fshAbs := fsh.FileSystemAbstraction
	mtime, _ := fshAbs.GetModTime(realFilepath)
	versionList := VersionList{
		CurrentFile:   filepath.Base(realFilepath),
		LatestModtime: mtime,
		Versions:      []*FileSnapshot{},
	}
	//Example folder structure: ./.localver/{date_time}/{file}
	expectedVersionFiles := filepath.Join(filepath.Dir(realFilepath), ".metadata/.localver", "*", filepath.Base(realFilepath))
	versions, err := fshAbs.Glob(filepath.ToSlash(expectedVersionFiles))
	if err != nil {
		return &versionList, err
	}

	//Reverse the versions so latest version on top
	sort.Sort(sort.Reverse(sort.StringSlice(versions)))

	for _, version := range versions {
		historyID := filepath.Base(filepath.Dir(version))
		mtime, _ := fshAbs.GetModTime(version)
		overwriteDisplayTime := strings.ReplaceAll(strings.Replace(strings.Replace(historyID, "-", "/", 2), "-", ":", 2), "_", " ")
		versionList.Versions = append(versionList.Versions, &FileSnapshot{
			HistoryID:     historyID,
			Filename:      filepath.Base(version),
			ModTime:       mtime,
			OverwriteTime: overwriteDisplayTime,
			Filesize:      fshAbs.GetFileSize(version),
			Relpath:       ".metadata/.localver/" + historyID + "/" + filepath.Base(version),
		})
	}

	return &versionList, nil
}

func RestoreFileHistory(fsh *filesystem.FileSystemHandler, originalFilepath string, histroyID string) error {
	fshAbs := fsh.FileSystemAbstraction
	expectedVersionFile := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", filepath.Base(histroyID), filepath.Base(originalFilepath))
	if !fshAbs.FileExists(expectedVersionFile) {
		return errors.New("File version not exists")
	}

	//Restore it
	fshAbs.Rename(originalFilepath, originalFilepath+".backup")
	srcf, err := fshAbs.ReadStream(expectedVersionFile)
	if err != nil {
		return err
	}

	err = fshAbs.WriteStream(originalFilepath, srcf, 0775)
	if err != nil {
		srcf.Close()
		return err
	}

	srcf.Close()

	//Check if it has been restored correctly
	versionFileHash, _ := filesystem.GetFileMD5Sum(fsh, expectedVersionFile)
	copiedFileHash, _ := filesystem.GetFileMD5Sum(fsh, expectedVersionFile)
	if versionFileHash != copiedFileHash {
		//Rollback failed. Restore backup file
		fshAbs.Rename(originalFilepath+".backup", originalFilepath)
		return errors.New("Unable to restore file: file hash mismatch after restore")
	}

	//OK! Delete the backup file
	fshAbs.Remove(originalFilepath + ".backup")

	//Delete all history versions that is after the restored versions
	expectedVersionFiles := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", "*", filepath.Base(originalFilepath))
	versions, err := fshAbs.Glob(filepath.ToSlash(expectedVersionFiles))
	if err != nil {
		return err
	}

	enableRemoval := false
	for _, version := range versions {
		if enableRemoval {
			//Remove this version as this is after the restored version
			fshAbs.Remove(version)
			fileInVersion, _ := fshAbs.Glob(filepath.ToSlash(filepath.Dir(version) + "/*"))
			if len(fileInVersion) == 0 {
				fshAbs.RemoveAll(filepath.Dir(version))
			}
		} else {
			thisHistoryId := filepath.Base(filepath.Dir(version))
			if thisHistoryId == histroyID {
				//Match. Tag enable Removal
				enableRemoval = true
				//Remove this version
				fshAbs.Remove(version)
				fileInVersion, _ := fshAbs.Glob(filepath.ToSlash(filepath.Dir(version) + "/*"))
				if len(fileInVersion) == 0 {
					fshAbs.RemoveAll(filepath.Dir(version))
				}
			}
		}

	}

	return nil
}

func RemoveFileHistory(fsh *filesystem.FileSystemHandler, originalFilepath string, histroyID string) error {
	expectedVersionFile := filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", filepath.Base(histroyID), filepath.Base(originalFilepath))
	if !fsh.FileSystemAbstraction.FileExists(expectedVersionFile) {
		return errors.New("File version not exists")
	}

	return fsh.FileSystemAbstraction.Remove(expectedVersionFile)
}

func RemoveAllRelatedFileHistory(fsh *filesystem.FileSystemHandler, originalFilepath string) error {
	expectedVersionFiles, err := fsh.FileSystemAbstraction.Glob(filepath.Join(filepath.Dir(originalFilepath), ".metadata/.localver", "*", filepath.Base(originalFilepath)))
	if err != nil {
		return err
	}
	for _, version := range expectedVersionFiles {
		os.Remove(version)
	}
	return nil
}

func CreateFileSnapshot(fsh *filesystem.FileSystemHandler, realFilepath string) error {
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(realFilepath) {
		return errors.New("Source file not exists")
	}
	//Create the snapshot folder for this file
	snapshotID := time.Now().Format("2006-01-02_15-04-05")
	expectedSnapshotFolder := filepath.Join(filepath.Dir(realFilepath), ".metadata/.localver", snapshotID)
	err := fshAbs.MkdirAll(expectedSnapshotFolder, 0775)
	if err != nil {
		return err
	}
	//Copy the target file to snapshot dir
	targetVersionFilepath := filepath.Join(expectedSnapshotFolder, filepath.Base(realFilepath))
	srcf, err := fshAbs.ReadStream(realFilepath)
	if err != nil {
		return err
	}
	defer srcf.Close()
	return fshAbs.WriteStream(targetVersionFilepath, srcf, 0775)
}

//Clearn expired version backups that is older than maxReserveTime
func CleanExpiredVersionBackups(fsh *filesystem.FileSystemHandler, walkRoot string, maxReserveTime int64) {
	fshAbs := fsh.FileSystemAbstraction
	localVerFolders := []string{}
	fshAbs.Walk(walkRoot,
		func(path string, info os.FileInfo, err error) error {
			if err != nil {
				//Skip this file
				return nil
			}
			if !info.IsDir() && inLocalVersionFolder(path) {
				//This is a file inside the localver folder. Check its modtime
				mtime, _ := fshAbs.GetModTime(path)
				if time.Now().Unix()-mtime > maxReserveTime {
					//Too old! Remove this version history
					fshAbs.Remove(path)
				}

				//Check if the folder still contains files. If not, remove it
				files, _ := fshAbs.Glob(filepath.ToSlash(filepath.Dir(path)) + "/*")
				if len(files) == 0 {
					fshAbs.RemoveAll(filepath.Dir(path))
				}
			} else if info.IsDir() && filepath.Base(path) == ".localver" {
				localVerFolders = append(localVerFolders, path)

			}
			return nil
		})

	for _, path := range localVerFolders {
		//Check if a localver folder still contains folder. If not, delete this
		files, _ := fshAbs.Glob(filepath.ToSlash(path) + "/*")
		if len(files) == 0 {
			fshAbs.RemoveAll(path)
		}
	}
}

func inLocalVersionFolder(path string) bool {
	path = filepath.ToSlash(path)
	return strings.Contains(path, "/.localver/") || filepath.Base(path) == ".localver"
}
