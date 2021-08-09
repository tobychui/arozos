package hybridBackup

import (
	"encoding/json"
	"io/ioutil"
	"path/filepath"
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
	}

	return &result, nil
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
