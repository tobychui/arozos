package hybridBackup

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"path/filepath"
	"strings"
)

/*
	Linker.go

	This script handle the linking file operations

*/

type LinkFileMap struct {
	UnchangedFile map[string]string
	DeletedFiles  map[string]string
}

//Generate and write link file to disk
func generateLinkFile(snapshotFolder string, lf LinkFileMap) error {
	js, err := json.MarshalIndent(lf, "", "\t")
	if err != nil {
		return err
	}

	return ioutil.WriteFile(filepath.Join(snapshotFolder, "snapshot.datalink"), js, 0755)
}

//Read link file and parse it into link file map
func readLinkFile(snapshotFolder string) (*LinkFileMap, error) {
	result := LinkFileMap{
		UnchangedFile: map[string]string{},
		DeletedFiles:  map[string]string{},
	}

	//Check if the link file exists
	expectedLinkFilePath := filepath.Join(snapshotFolder, "snapshot.datalink")
	if fileExists(expectedLinkFilePath) {
		//Read the content of the link file
		content, err := ioutil.ReadFile(expectedLinkFilePath)
		if err == nil {
			//No error. Read and parse the content
			lfContent := LinkFileMap{}
			err := json.Unmarshal(content, &lfContent)
			if err == nil {
				return &lfContent, nil
			}
		}
	} else {
		return &result, errors.New("Linker file not exists")
	}

	return &result, nil
}

//Update the linker by given a snapshot name to a new one
func updateLinkerPointer(snapshotFolder string, oldSnapshotLink string, newSnapshotLink string) error {
	oldSnapshotLink = strings.TrimSpace(oldSnapshotLink)
	newSnapshotLink = strings.TrimSpace(newSnapshotLink)

	//Load the old linker file
	oldlinkMap, err := readLinkFile(snapshotFolder)
	if err != nil {
		return err
	}

	//Iterate and replace all link that is pointing to the same snapshot
	newLinkMap := LinkFileMap{
		UnchangedFile: map[string]string{},
		DeletedFiles:  map[string]string{},
	}

	for rel, link := range oldlinkMap.UnchangedFile {
		if link == oldSnapshotLink {
			link = newSnapshotLink
		}
		newLinkMap.UnchangedFile[rel] = link
	}

	for rel, ts := range oldlinkMap.DeletedFiles {
		newLinkMap.DeletedFiles[rel] = ts
	}

	//Write it back to file
	return generateLinkFile(snapshotFolder, newLinkMap)
}

//Check if a file exists in a linkFileMap. return boolean and its linked to snapshot name
func (lfm *LinkFileMap) fileExists(fileRelPath string) (bool, string) {
	val, ok := lfm.UnchangedFile[filepath.ToSlash(fileRelPath)]
	if !ok {
		return false, ""
	} else {
		return true, val
	}
}
